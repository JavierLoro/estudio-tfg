// Núcleo compartido por el worker Docker y el motor local. Sin dependencias npm.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { parseLog, parseBlg, finalize, dropRerunNoise } from './parse-log.mjs';
import { MAX_SVG_BYTES, checkSvg } from './svg.mjs';
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const BUILD_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

/** Entorno propio por trabajo: ningún ajuste del usuario/proyecto llega a las herramientas. */
export function compileEnvironment(runtimeDir, { tools = {}, platform = process.platform, windowsRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows' } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  for (const tool of Object.values(tools)) {
    if (!paths.isAbsolute(tool) || /[\0\r\n]/.test(tool)) throw new Error('Las herramientas deben tener rutas absolutas');
    if (platform === 'win32' && /[%!"]/.test(tool)) throw new Error('Las rutas de herramientas no pueden contener expansiones de cmd');
  }
  if (platform === 'win32' && (!path.win32.isAbsolute(windowsRoot) || /[\0\r\n]/.test(windowsRoot))) throw new Error('Directorio de Windows inválido');
  const systemDirs = platform === 'win32'
    ? [path.win32.join(windowsRoot, 'System32'), windowsRoot]
    : ['/usr/local/bin', '/usr/bin', '/bin'];
  const join = (...parts) => paths.join(...parts);
  return {
    PATH: [...new Set([...Object.values(tools).map((tool) => paths.dirname(tool)), ...systemDirs])].join(paths.delimiter),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    HOME: join(runtimeDir, 'home'),
    TMPDIR: join(runtimeDir, 'tmp'),
    ...(Object.keys(tools).length || platform === 'win32' ? { USERPROFILE: join(runtimeDir, 'home'), TMP: join(runtimeDir, 'tmp'), TEMP: join(runtimeDir, 'tmp') } : {}),
    TEXMFHOME: join(runtimeDir, 'texmf-home'),
    TEXMFVAR: join(runtimeDir, 'texmf-var'),
    TEXMFCONFIG: join(runtimeDir, 'texmf-config'),
    TEXMFCACHE: join(runtimeDir, 'texmf-cache'),
    // Shell/Xpdf resuelve AppData desde USERPROFILE; conservar la estructura del perfil privado.
    ...(platform === 'win32' ? { SystemRoot: windowsRoot, WINDIR: windowsRoot, APPDATA: join(runtimeDir, 'home', 'AppData', 'Roaming'), LOCALAPPDATA: join(runtimeDir, 'home', 'AppData', 'Local') } : {}),
    // Kpathsea limita escrituras; openin_any ya no protege lecturas en TeX Live 2026.
    openout_any: 'p', shell_escape: '0',
    max_print_line: '10000', error_line: '254', half_error_line: '238',
  };
}

/** Valida `main`: relativa, sin "..", sin opciones disfrazadas, .tex. Devuelve la ruta normalizada o null. */
export function validateMain(main) {
  if (typeof main !== 'string' || !main || main.length > 255) return null;
  if (/[\0\\\n\r]/.test(main)) return null;
  if (main.startsWith('/') || main.startsWith('-') || /^[A-Za-z]:/.test(main)) return null;
  const norm = path.posix.normalize(main);
  if (norm !== main.replace(/^\.\//, '')) return null;
  if (norm.split('/').some((seg) => seg === '..' || seg === '' || seg.startsWith('-'))) return null;
  if (!/\.tex$/i.test(norm)) return null;
  return norm;
}

export function newBuildId() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

/** Ejecuta un comando en su propio grupo de procesos; mata el grupo entero al agotar el tiempo. */
export function run(cmd, args, { cwd, timeoutMs, env, input, signal, platform = process.platform }) {
  if (signal?.aborted) return Promise.resolve({ code: -1, timedOut: false, cancelled: true, output: '' });
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, detached: platform !== 'win32', windowsHide: true, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
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
    let timedOut = false, cancelled = false;
    let killTimer;
    const killGroup = (sig) => {
      if (!child.pid) return;
      if (platform === 'win32') {
        const killer = spawn(path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { env, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill(); });
        return;
      }
      try { process.kill(-child.pid, sig); } catch { /* ya terminó */ }
    };
    const stop = () => {
      killGroup('SIGTERM');
      if (platform !== 'win32') {
        killTimer = setTimeout(() => killGroup('SIGKILL'), 2000);
        killTimer.unref();
      }
    };
    const abort = () => { cancelled = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); };
    child.on('error', (err) => {
      cleanup();
      resolve({ code: -1, timedOut, cancelled, output: output + `\n${err.message}` });
    });
    child.on('close', (code, exitSignal) => {
      cleanup();
      if (platform !== 'win32') killGroup('SIGKILL'); // por si quedó algún nieto
      resolve({ code: code ?? (exitSignal ? 128 : -1), timedOut, cancelled, output });
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
  const root = workDir.replaceAll('\\', '/');
  const fixed = raw.replaceAll('\\', '/').split(`${root}/./`).join('').split(`${root}/`).join('');
  await fs.writeFile(to, await gzip(Buffer.from(fixed, 'utf8')));
}

function latexmkArgs(main, tools) {
  const args = ['-norc', '-e'];
  // Dos niveles de comillas: constante Perl y comando del auxiliar, nunca fuentes del proyecto.
  const perl = (value) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('@', '\\@');
  const command = (tool) => {
    const name = process.platform === 'win32' ? tool.replaceAll('\\', '/') : tool;
    return process.platform === 'win32' ? `"${name}"` : `'${name.replaceAll("'", "'\\''")}'`;
  };
  const biber = tools.biber ? command(tools.biber) : 'biber';
  args.push(`$biber = "${perl(biber)} --noconf %O %B";`);
  if (tools.pdflatex) args.push('-e', `$pdflatex = "${perl(command(tools.pdflatex))} %O %S";`);
  return [...args, '-pdf', '-interaction=nonstopmode', '-file-line-error', '-synctex=1', '-no-shell-escape', main];
}

export async function pruneBuilds(root, keep = 10) {
  const dirs = (await fs.readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && BUILD_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    await fs.rm(path.join(root, name), { recursive: true, force: true });
  }
}

/** Compila `main` dentro de `workDir` (fuentes ya extraídas). */
export async function compile({ main, workDir, outDir, buildId, started = Date.now(), timeoutMs = 120_000, tools = {}, toolchain = '', runtimeDir = path.join(path.dirname(workDir), 'runtime'), signal }) {
  if (!validateMain(main)) throw new Error('Archivo principal inválido');
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

    const env = compileEnvironment(runtimeDir, { tools });
    await Promise.all(Object.values(env).filter((value) => value.startsWith(runtimeDir + path.sep)).map((dir) => fs.mkdir(dir, { recursive: true })));
    const res = await run(
      tools.latexmk || 'latexmk',
      latexmkArgs(main, tools),
      {
        cwd: workDir,
        timeoutMs,
        signal,
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

    if (res.cancelled) {
      diagnostics.unshift({ severity: 'error', file: main, line: null, message: 'Compilación cancelada por el usuario' });
    } else if (res.timedOut) {
      diagnostics.unshift({ severity: 'error', file: main, line: null, message: `Compilación cancelada: superó ${Math.round(timeoutMs / 1000)} s` });
    } else if (res.code !== 0 && !diagnostics.some((d) => d.severity === 'error')) {
      const tail = res.output.trim().split('\n').slice(-3).join(' ').slice(0, 400);
      diagnostics.unshift({ severity: 'error', file: main, line: null, message: `latexmk terminó con código ${res.code}: ${tail}` });
    }

    ok = !res.cancelled && !res.timedOut && res.code === 0 && (await exists(pdfPath)) && !diagnostics.some((d) => d.severity === 'error');
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

/**
 * SVG → PDF con rsvg-convert. El SVG entra por stdin (sin URL base: rsvg no puede
 * cargar archivos relativos) y el PDF sale a un temporal en /tmp que se borra al acabar.
 * Devuelve { pdf } o { status, error }.
 */
export async function svgToPdf(svg, { tool, timeoutMs = 20_000, signal } = {}) {
  if (svg instanceof Uint8Array && !Buffer.isBuffer(svg)) svg = Buffer.from(svg);
  const problem = checkSvg(Buffer.isBuffer(svg) ? svg.toString('utf8') : svg);
  if (problem) return { status: (typeof svg === 'string' || Buffer.isBuffer(svg)) && Buffer.byteLength(svg) > MAX_SVG_BYTES ? 413 : 400, error: problem };
  if (tool && !path.isAbsolute(tool)) throw new Error('La herramienta SVG debe tener ruta absoluta');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'svg2pdf-'));
  const out = path.join(dir, 'out.pdf');
  try {
    const env = compileEnvironment(path.join(dir, 'runtime'), { tools: tool ? { rsvg: tool } : {} });
    await Promise.all(Object.values(env).filter((value) => value.startsWith(dir + path.sep)).map((folder) => fs.mkdir(folder, { recursive: true })));
    const res = await run(tool || 'rsvg-convert', ['--format=pdf', `--output=${out}`], {
      cwd: dir,
      timeoutMs,
      signal,
      env,
      input: svg,
    });
    if (res.cancelled) return { status: 499, error: 'Conversión cancelada por el usuario' };
    if (res.timedOut) return { status: 504, error: `La conversión superó ${Math.round(timeoutMs / 1000)} s` };
    if (res.code !== 0) {
      const msg = res.output.trim().split('\n').slice(-3).join(' ').slice(0, 300) || `código ${res.code}`;
      return { status: 400, error: `rsvg-convert no pudo convertir el SVG: ${msg}` };
    }
    const st = await fs.stat(out).catch(() => null);
    if (!st || st.size === 0) return { status: 500, error: 'rsvg-convert no generó el PDF' };
    if (st.size > MAX_PDF_BYTES) return { status: 413, error: 'El PDF resultante es demasiado grande' };
    const pdf = await fs.readFile(out);
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return { status: 500, error: 'rsvg-convert no generó un PDF válido' };
    return { pdf };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
