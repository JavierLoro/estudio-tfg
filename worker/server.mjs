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
import { pathToFileURL } from 'node:url';
import { extractTar } from './untar.mjs';
import { MAX_SVG_BYTES, checkSvg } from './svg.mjs';
import { compile, newBuildId, pruneBuilds, validateMain, svgToPdf } from './engine.mjs';
export { validateMain, compileEnvironment, svgToPdf } from './engine.mjs';

const PORT = Number(process.env.PORT || 8090);
const OUT_DIR = path.resolve(process.env.OUT_DIR || '/out');
const TIMEOUT_MS = Number(process.env.COMPILE_TIMEOUT_MS || 120_000);
const KEEP_BUILDS = Number(process.env.KEEP_BUILDS || 10);
export const MAX_TAR_BYTES = Number(process.env.MAX_TAR_BYTES || 200 * 1024 * 1024);

const SVG_TIMEOUT_MS = Number(process.env.SVG_TIMEOUT_MS || 20_000);

const toolchain = await fs.readFile(new URL('./toolchain.txt', import.meta.url), 'utf8').catch((err) => {
  if (err.code !== 'ENOENT') throw err;
  return 'Sin inventario de imagen (ejecución fuera de Docker).\n';
});

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
  const preview = req.headers['x-preview'];
  if (preview !== undefined && preview !== '1') return reject(req,res,400,'Cabecera X-Preview inválida');
  const outputRoot = preview === '1' ? path.join(OUT_DIR,'previews') : OUT_DIR;
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > MAX_TAR_BYTES) {
    return reject(req, res, 413, `El tar supera el máximo de ${Math.round(MAX_TAR_BYTES / 1024 / 1024)} MB`);
  }
  if (pendingCompiles >= MAX_PENDING_COMPILES) return reject(req, res, 503, 'El worker está ocupado; vuelve a intentarlo');
  pendingCompiles++;
  const started = Date.now();
  const controller = new AbortController();
  const disconnected = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close',disconnected);
  let jobDir;
  let result;
  try {
    jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'build-'));
    const workDir = path.join(jobDir, 'sources');
    await fs.mkdir(workDir);
    await extractTar(req, workDir, { maxBytes: MAX_TAR_BYTES });
    result = await enqueue(async () => {
      const buildId = newBuildId();
      const result = await compile({ main, workDir, outDir: path.join(outputRoot, buildId), buildId, started, timeoutMs: TIMEOUT_MS, toolchain, signal: controller.signal });
      await pruneBuilds(outputRoot, KEEP_BUILDS, buildId).catch((e) => console.error(`[worker] prune: ${e.message}`));
      return result;
    });
  } catch (err) {
    if (err?.status) return reject(req, res, err.status, err.message);
    throw err;
  } finally {
    if (jobDir) await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    pendingCompiles--;
    res.off('close',disconnected);
  }
  console.log(`[worker] ${result.buildId} ok=${result.ok} ${result.durationMs} ms, ${result.diagnostics.length} diagnósticos`);
  if (!res.destroyed) return send(res, 200, result);
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
  const r = await enqueueSvg(() => svgToPdf(body, { timeoutMs: SVG_TIMEOUT_MS }));
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
      return send(res, 200, { ok: true, version: toolchain.trim(), capacidades: { compile: true, svg2pdf: true, comparacion: true, lualatex: true } });
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
