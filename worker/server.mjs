// Worker de compilación LaTeX de Estudio TFG. Sin dependencias npm.
//
//   GET  /health                → { ok: true }
//   POST /compile               → { ok, buildId, durationMs, pdf, log, diagnostics }
//        Content-Type: application/x-tar, X-Main: main.tex, cuerpo = tar de las fuentes (máx. 200 MB)
//   POST /svg2pdf               → application/pdf (v0.8, diagramas)
//        Content-Type: image/svg+xml, cuerpo = SVG (máx. 5 MB); rsvg-convert sin shell, sin red
//
// Extrae el tar (validando cada entrada: sin rutas absolutas, `..`, enlaces ni
// dispositivos) en un temporal, ejecuta latexmk y deja
// main.pdf / main.log / main.synctex.gz en OUT_DIR/<buildId>/.

import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parseLog, parseBlg, finalize, dropRerunNoise } from './parse-log.mjs';
import { extractTar } from './untar.mjs';
import { MAX_SVG_BYTES, checkSvg } from './svg.mjs';

const PORT = Number(process.env.PORT || 8090);
const OUT_DIR = path.resolve(process.env.OUT_DIR || '/out');
const TIMEOUT_MS = Number(process.env.COMPILE_TIMEOUT_MS || 120_000);
const KEEP_BUILDS = Number(process.env.KEEP_BUILDS || 10);
export const MAX_TAR_BYTES = Number(process.env.MAX_TAR_BYTES || 200 * 1024 * 1024);

const SVG_TIMEOUT_MS = Number(process.env.SVG_TIMEOUT_MS || 20_000);
const MAX_PDF_BYTES = 50 * 1024 * 1024;

const BUILD_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const toolchain = await fs.readFile(new URL('./toolchain.txt', import.meta.url), 'utf8').catch((err) => {
  if (err.code !== 'ENOENT') throw err;
  return 'Sin inventario de imagen (ejecución fuera de Docker).\n';
});

/** Entorno propio por trabajo: ningún ajuste del usuario/proyecto llega a las herramientas. */
export function compileEnvironment(runtimeDir) {
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    HOME: path.join(runtimeDir, 'home'),
    TMPDIR: path.join(runtimeDir, 'tmp'),
    TEXMFHOME: path.join(runtimeDir, 'texmf-home'),
    TEXMFVAR: path.join(runtimeDir, 'texmf-var'),
    TEXMFCONFIG: path.join(runtimeDir, 'texmf-config'),
    TEXMFCACHE: path.join(runtimeDir, 'texmf-cache'),
    // Kpathsea limita escrituras; openin_any ya no protege lecturas en TeX Live 2026.
    openout_any: 'p', shell_escape: '0',
    max_print_line: '10000', error_line: '254', half_error_line: '238',
  };
}

/** Valida `main`: relativa, sin "..", sin opciones disfrazadas, .tex. Devuelve la ruta normalizada o null. */
export function validateMain(main) {
  if (typeof main !== 'string' || !main || main.length > 255) return null;
  if (/[\0\\\n\r]/.test(main)) return null;
  if (main.startsWith('/') || main.startsWith('-')) return null;
  const norm = path.posix.normalize(main);
  if (norm !== main.replace(/^\.\//, '')) return null;
  if (norm.split('/').some((seg) => seg === '..' || seg === '' || seg.startsWith('-'))) return null;
  if (!/\.tex$/i.test(norm)) return null;
  return norm;
}

function newBuildId() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

/** Ejecuta un comando en su propio grupo de procesos; mata el grupo entero al agotar el tiempo. */
function run(cmd, args, { cwd, timeoutMs, env, input }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, detached: true, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input != null) {
      child.stdin.on('error', () => {}); // EPIPE si el proceso muere antes de leerlo todo
      child.stdin.end(input);
    }
    let output = '';
    const onData = (b) => {
      output += b.toString('utf8');
      if (output.length > 2_000_000) output = output.slice(-1_000_000);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    let timedOut = false;
    let killTimer;
    const killGroup = (sig) => {
      try { process.kill(-child.pid, sig); } catch { /* ya terminó */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), 2000);
      killTimer.unref();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, timedOut, output: output + `\n${err.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      killGroup('SIGKILL'); // por si quedó algún nieto
      resolve({ code: code ?? (signal ? 128 : -1), timedOut, output });
    });
  });
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function isFile(p) {
  try { return (await fs.lstat(p)).isFile(); } catch { return false; }
}

/** Reescribe las rutas del temporal en el synctex para que queden relativas al proyecto. */
async function copySynctex(from, to, workDir) {
  const gunzip = promisify(zlib.gunzip);
  const gzip = promisify(zlib.gzip);
  const raw = (await gunzip(await fs.readFile(from))).toString('utf8');
  const fixed = raw.split(`${workDir}/./`).join('').split(`${workDir}/`).join('');
  await fs.writeFile(to, await gzip(Buffer.from(fixed, 'utf8')));
}

async function pruneBuilds() {
  const dirs = (await fs.readdir(OUT_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && BUILD_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of dirs.slice(0, Math.max(0, dirs.length - KEEP_BUILDS))) {
    await fs.rm(path.join(OUT_DIR, name), { recursive: true, force: true });
  }
}

/** Compila `main` dentro de `workDir` (fuentes ya extraídas). */
async function compile(main, workDir, started = Date.now()) {
  const buildId = newBuildId();
  const outDir = path.join(OUT_DIR, buildId);
  // latexmk (sin -cd) deja los resultados en el cwd: <raíz>/<nombre>.{pdf,log,…}
  const base = path.posix.basename(main).replace(/\.tex$/i, '');
  const diagnostics = [];
  let ok = false;
  let pdf = null;

  try {
    await fs.mkdir(outDir, { recursive: true });
    if (!(await isFile(path.join(workDir, main)))) {
      diagnostics.push({ severity: 'error', file: main, line: null, message: `No existe el archivo principal ${main}` });
      await fs.writeFile(path.join(outDir, 'main.log'), `No existe ${main} en el proyecto.\n`);
      return { ok, buildId, durationMs: Date.now() - started, pdf, log: `${buildId}/main.log`, diagnostics };
    }

    const env = compileEnvironment(path.join(path.dirname(workDir), 'runtime'));
    await Promise.all(['HOME', 'TMPDIR', 'TEXMFHOME', 'TEXMFVAR', 'TEXMFCONFIG', 'TEXMFCACHE']
      .map((key) => fs.mkdir(env[key], { recursive: true })));
    const res = await run(
      'latexmk',
      ['-norc', '-e', '$biber = "biber --noconf %O %B";', '-pdf', '-interaction=nonstopmode', '-file-line-error', '-synctex=1', '-no-shell-escape', main],
      {
        cwd: workDir,
        timeoutMs: TIMEOUT_MS,
        env,
      },
    );

    const logPath = path.join(workDir, `${base}.log`);
    const pdfPath = path.join(workDir, `${base}.pdf`);
    const logText = (await exists(logPath)) ? await fs.readFile(logPath, 'utf8') : '';
    await fs.writeFile(
      path.join(outDir, 'main.log'),
      logText || `latexmk no produjo log.\n\n${res.output}`,
    );

    // Salida de latexmk (qué reglas corrió, bibtex/biber…), útil para depurar.
    await fs.writeFile(path.join(outDir, 'latexmk.txt'), `Herramientas de esta imagen:\n${toolchain}\n${res.output.split(workDir + '/').join('')}`);

    const opts = { rootDir: workDir, mainFile: main };
    diagnostics.push(...parseLog(logText, opts));
    const blgPath = path.join(workDir, `${base}.blg`);
    if (await exists(blgPath)) diagnostics.push(...parseBlg(await fs.readFile(blgPath, 'utf8'), opts));

    if (res.timedOut) {
      diagnostics.unshift({ severity: 'error', file: main, line: null, message: `Compilación cancelada: superó ${Math.round(TIMEOUT_MS / 1000)} s` });
    } else if (res.code !== 0 && !diagnostics.some((d) => d.severity === 'error')) {
      const tail = res.output.trim().split('\n').slice(-3).join(' ').slice(0, 400);
      diagnostics.unshift({ severity: 'error', file: main, line: null, message: `latexmk terminó con código ${res.code}: ${tail}` });
    }

    ok = !res.timedOut && res.code === 0 && (await exists(pdfPath)) && !diagnostics.some((d) => d.severity === 'error');
    if (!ok && !diagnostics.some((d) => d.severity === 'error')) {
      diagnostics.unshift({ severity: 'error', file: main, line: null, message: 'La compilación no generó el PDF (ver log)' });
    }
    if (ok) {
      await fs.copyFile(pdfPath, path.join(outDir, 'main.pdf'));
      pdf = `${buildId}/main.pdf`;
      const syn = path.join(workDir, `${base}.synctex.gz`);
      if (await exists(syn)) {
        await copySynctex(syn, path.join(outDir, 'main.synctex.gz'), workDir).catch((e) =>
          console.error(`[worker] synctex: ${e.message}`),
        );
      }
    }
  } catch (err) {
    diagnostics.unshift({ severity: 'error', file: main, line: null, message: `Error interno del worker: ${err.message}` });
    await fs.writeFile(path.join(outDir, 'main.log'), String(err.stack || err)).catch(() => {});
  } finally {
    await pruneBuilds().catch((e) => console.error(`[worker] prune: ${e.message}`));
  }

  return {
    ok,
    buildId,
    durationMs: Date.now() - started,
    pdf,
    log: `${buildId}/main.log`,
    diagnostics: dropRerunNoise(finalize(diagnostics)),
  };
}

// Cola: una compilación a la vez.
let queue = Promise.resolve();
let pendingCompiles = 0;
const MAX_PENDING_COMPILES = 4;
function enqueue(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

/** Respuesta de error que además corta la subida pendiente. */
function reject(req, res, status, error) {
  res.setHeader('connection', 'close');
  res.on('finish', () => req.destroy());
  send(res, status, { error });
}

export async function handleCompile(req, res) {
  const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ctype !== 'application/x-tar') {
    return reject(req, res, 415, 'Se espera Content-Type: application/x-tar (tar de las fuentes)');
  }
  let mainRaw = req.headers['x-main'] ?? 'main.tex';
  try { mainRaw = decodeURIComponent(String(mainRaw)); } catch { mainRaw = null; }
  const main = validateMain(mainRaw);
  if (!main) return reject(req, res, 400, 'Cabecera "X-Main" inválida');
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > MAX_TAR_BYTES) {
    return reject(req, res, 413, `El tar supera el máximo de ${Math.round(MAX_TAR_BYTES / 1024 / 1024)} MB`);
  }
  if (pendingCompiles >= MAX_PENDING_COMPILES) return reject(req, res, 503, 'El worker está ocupado; vuelve a intentarlo');
  pendingCompiles++;
  const started = Date.now();
  let jobDir;
  let result;
  try {
    jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'build-'));
    const workDir = path.join(jobDir, 'sources');
    await fs.mkdir(workDir);
    await extractTar(req, workDir, { maxBytes: MAX_TAR_BYTES });
    result = await enqueue(() => compile(main, workDir, started));
  } catch (err) {
    if (err?.status) return reject(req, res, err.status, err.message);
    throw err;
  } finally {
    if (jobDir) await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    pendingCompiles--;
  }
  console.log(`[worker] ${result.buildId} ok=${result.ok} ${result.durationMs} ms, ${result.diagnostics.length} diagnósticos`);
  return send(res, 200, result);
}

/** Lee el cuerpo entero con límite; null si lo supera. */
async function readBody(req, max) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// Conversiones SVG → PDF: de una en una (son cortas) y aparte de la cola de compilación.
let svgQueue = Promise.resolve();
function enqueueSvg(fn) {
  const p = svgQueue.then(fn, fn);
  svgQueue = p.catch(() => {});
  return p;
}

/**
 * SVG → PDF con rsvg-convert. El SVG entra por stdin (sin URL base: rsvg no puede
 * cargar archivos relativos) y el PDF sale a un temporal en /tmp que se borra al acabar.
 * Devuelve { pdf } o { status, error }.
 */
export async function svgToPdf(svg) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'svg2pdf-'));
  const out = path.join(dir, 'out.pdf');
  try {
    const res = await run('rsvg-convert', ['--format=pdf', `--output=${out}`], {
      cwd: dir,
      timeoutMs: SVG_TIMEOUT_MS,
      env: { PATH: process.env.PATH, HOME: process.env.HOME || '/tmp/home', LANG: 'C.UTF-8' },
      input: svg,
    });
    if (res.timedOut) return { status: 504, error: `La conversión superó ${Math.round(SVG_TIMEOUT_MS / 1000)} s` };
    if (res.code !== 0) {
      const msg = res.output.trim().split('\n').slice(-3).join(' ').slice(0, 300) || `código ${res.code}`;
      return { status: 400, error: `rsvg-convert no pudo convertir el SVG: ${msg}` };
    }
    const st = await fs.stat(out).catch(() => null);
    if (!st || st.size === 0) return { status: 500, error: 'rsvg-convert no generó el PDF' };
    if (st.size > MAX_PDF_BYTES) return { status: 413, error: 'El PDF resultante es demasiado grande' };
    return { pdf: await fs.readFile(out) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function handleSvg2pdf(req, res) {
  const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ctype !== 'image/svg+xml') return reject(req, res, 415, 'Se espera Content-Type: image/svg+xml');
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > MAX_SVG_BYTES) {
    return reject(req, res, 413, `El SVG supera el máximo de ${MAX_SVG_BYTES / 1024 / 1024} MB`);
  }
  const body = await readBody(req, MAX_SVG_BYTES);
  if (!body) return reject(req, res, 413, `El SVG supera el máximo de ${MAX_SVG_BYTES / 1024 / 1024} MB`);
  const text = body.toString('utf8');
  const problem = checkSvg(text);
  if (problem) return send(res, 400, { error: problem });
  const started = Date.now();
  const r = await enqueueSvg(() => svgToPdf(body));
  if (!r.pdf) {
    console.log(`[worker] svg2pdf error ${r.status}: ${r.error}`);
    return send(res, r.status, { error: r.error });
  }
  console.log(`[worker] svg2pdf ${body.length} B → ${r.pdf.length} B en ${Date.now() - started} ms`);
  res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': r.pdf.length });
  res.end(r.pdf);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://worker');
  try {
    if (url.pathname === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/compile') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
      return await handleCompile(req, res);
    }
    if (url.pathname === '/svg2pdf') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
      return await handleSvg2pdf(req, res);
    }
    send(res, 404, { error: 'No encontrado' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: err.message });
  }
});

// Solo arrancar si se ejecuta directamente (permite importar validateMain en tests).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!fss.existsSync(OUT_DIR)) fss.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[worker] herramientas:\n${toolchain.trim()}`);
  server.requestTimeout = TIMEOUT_MS + 60_000;
  server.listen(PORT, '0.0.0.0', () => console.log(`[worker] escuchando en :${PORT} (out=${OUT_DIR}, tar máx. ${Math.round(MAX_TAR_BYTES / 1024 / 1024)} MB)`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}
