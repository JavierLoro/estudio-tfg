// Worker de compilación LaTeX de Estudio TFG. Sin dependencias npm.
//
//   GET  /health                → { ok: true }
//   POST /compile { main }      → { ok, buildId, durationMs, pdf, log, diagnostics }
//
// Copia SRC_DIR (solo lectura) a un temporal, ejecuta latexmk y deja
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

const PORT = Number(process.env.PORT || 8090);
const SRC_DIR = path.resolve(process.env.SRC_DIR || '/src');
const OUT_DIR = path.resolve(process.env.OUT_DIR || '/out');
const TIMEOUT_MS = Number(process.env.COMPILE_TIMEOUT_MS || 120_000);
const KEEP_BUILDS = Number(process.env.KEEP_BUILDS || 10);
const MAX_BODY = 64 * 1024;

// Auxiliares/derivados que no se copian (contrato: "Ignorar siempre" + algunos más).
const AUX_EXT = new Set([
  'aux', 'log', 'out', 'toc', 'lof', 'lot', 'lol', 'bbl', 'blg', 'fls', 'fdb_latexmk',
  'acn', 'acr', 'alg', 'bcf', 'xdv', 'nav', 'snm', 'vrb', 'idx', 'ilg', 'ind',
  'glo', 'gls', 'glg', 'synctex',
]);
const SKIP_DIRS = new Set(['build', 'node_modules', '_minted']);
const BUILD_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

function isAux(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.run.xml') || lower.endsWith('.synctex.gz') || lower.endsWith('.synctex(busy)')) return true;
  if (lower.endsWith('.lock')) return true;
  const dot = lower.lastIndexOf('.');
  return dot > 0 && AUX_EXT.has(lower.slice(dot + 1));
}

function skipEntry(name, isDir) {
  if (name.startsWith('.')) return true;
  if (name.includes('.sync-conflict-')) return true;
  if (isDir) return SKIP_DIRS.has(name) || name.startsWith('_minted');
  return isAux(name);
}

/** Copia recursiva src→dst omitiendo auxiliares. Symlinks solo si apuntan dentro de SRC_DIR. */
async function copyTree(src, dst, realRoot) {
  await fs.mkdir(dst, { recursive: true });
  for (const ent of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dst, ent.name);
    let isDir = ent.isDirectory();
    let isFile = ent.isFile();
    if (ent.isSymbolicLink()) {
      let real;
      try { real = await fs.realpath(from); } catch { continue; }
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) continue;
      const st = await fs.stat(real);
      isDir = st.isDirectory();
      isFile = st.isFile();
    }
    if (skipEntry(ent.name, isDir)) continue;
    if (isDir) await copyTree(from, to, realRoot);
    else if (isFile) await fs.copyFile(from, to);
  }
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
function run(cmd, args, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = (b) => {
      output += b.toString('utf8');
      if (output.length > 2_000_000) output = output.slice(-1_000_000);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    let timedOut = false;
    const killGroup = (sig) => {
      try { process.kill(-child.pid, sig); } catch { /* ya terminó */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 2000).unref();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, timedOut, output: output + `\n${err.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      killGroup('SIGKILL'); // por si quedó algún nieto
      resolve({ code: code ?? (signal ? 128 : -1), timedOut, output });
    });
  });
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
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

async function compile(main) {
  const started = Date.now();
  const buildId = newBuildId();
  const outDir = path.join(OUT_DIR, buildId);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'build-'));
  // latexmk (sin -cd) deja los resultados en el cwd: <raíz>/<nombre>.{pdf,log,…}
  const base = path.posix.basename(main).replace(/\.tex$/i, '');
  const diagnostics = [];
  let ok = false;
  let pdf = null;

  try {
    await fs.mkdir(outDir, { recursive: true });
    const realRoot = await fs.realpath(SRC_DIR);
    if (!(await exists(path.join(SRC_DIR, main)))) {
      diagnostics.push({ severity: 'error', file: main, line: null, message: `No existe el archivo principal ${main}` });
      await fs.writeFile(path.join(outDir, 'main.log'), `No existe ${main} en el proyecto.\n`);
      return { ok, buildId, durationMs: Date.now() - started, pdf, log: `${buildId}/main.log`, diagnostics };
    }
    await copyTree(SRC_DIR, workDir, realRoot);

    const res = await run(
      'latexmk',
      ['-pdf', '-interaction=nonstopmode', '-file-line-error', '-synctex=1', '-no-shell-escape', main],
      {
        cwd: workDir,
        timeoutMs: TIMEOUT_MS,
        env: {
          ...process.env,
          // Logs sin cortar a 79 columnas: parseo más fiable.
          max_print_line: '10000',
          error_line: '254',
          half_error_line: '238',
        },
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
    await fs.writeFile(path.join(outDir, 'latexmk.txt'), res.output.split(workDir + '/').join(''));

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
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://worker');
  try {
    if (url.pathname === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/compile') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
      let body;
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        return send(res, e.status || 400, { error: e.status ? e.message : 'JSON inválido' });
      }
      const main = validateMain(body?.main ?? 'main.tex');
      if (!main) return send(res, 400, { error: 'Parámetro "main" inválido' });
      const result = await enqueue(() => compile(main));
      console.log(`[worker] ${result.buildId} ok=${result.ok} ${result.durationMs} ms, ${result.diagnostics.length} diagnósticos`);
      return send(res, 200, result);
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
  server.requestTimeout = TIMEOUT_MS + 60_000;
  server.listen(PORT, '0.0.0.0', () => console.log(`[worker] escuchando en :${PORT} (src=${SRC_DIR}, out=${OUT_DIR})`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}
