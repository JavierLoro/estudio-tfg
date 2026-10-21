import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/src/app.ts';
import { loadConfig, REPO_ROOT } from '../../server/src/config.ts';

const root = await fs.realpath(process.argv[2]);
const temporary = [await fs.realpath(os.tmpdir()), ...(process.platform !== 'win32' ? [await fs.realpath('/tmp')] : []),
  ...(process.env.RUNNER_TEMP ? [await fs.realpath(process.env.RUNNER_TEMP)] : [])];
const insideTemporary = (dir: string) => temporary.some((p) => dir.startsWith(p + path.sep));
assert(insideTemporary(root), 'El servidor E2E solo acepta carpetas temporales propias');
const notes = path.join(root, 'notes'), memoria = path.join(root, 'memoria');
await fs.mkdir(path.join(notes, 'Recursos'), { recursive: true });
await fs.mkdir(memoria, { recursive: true });
if (process.argv[3] !== 'restored') {
  await fs.writeFile(path.join(notes, 'Nota.md'), '# Nota ficticia\nTexto para verificar la restauración.\n');
  await fs.writeFile(path.join(memoria, 'capitulo.tex'), 'Texto ficticio del apartado.\n');
  await fs.writeFile(path.join(memoria, 'bibliografia.bib'), '@book{Manual2026,title={Manual ficticio},author={Ejemplo, Ana},year={2026},publisher={Editorial ficticia}}\n');
  await fs.writeFile(path.join(memoria, 'tfg.tex'), String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
% Solo PNG/PDF en este fixture; evitar conversión EPS con shell escape desactivado.
\expandafter\def\csname ver@epstopdf-base.sty\endcsname{2099/01/01 desactivado por fixture}
\usepackage{graphicx}
\usepackage[backend=biber]{biblatex}
\addbibresource{bibliografia.bib}
\begin{document}
\input{capitulo.tex}
\printbibliography
\end{document}
`);
}
const worker = process.env.E2E_WORKER_URL;
let builds = path.join(root, 'data/builds');
if (worker) {
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(worker), 'Usa un worker E2E loopback propio');
  assert(process.env.E2E_WORKER_OUT, 'Indica la carpeta temporal montada en /out del worker E2E');
  builds = await fs.realpath(process.env.E2E_WORKER_OUT!);
  assert(insideTemporary(builds), 'La salida del worker E2E debe ser temporal');
}
const cfg = loadConfig({ NOTES_DIR: notes, MEMORIA_DIR: memoria, BUILD_DIR: builds,
  WORKER_URL: worker || 'http://127.0.0.1:1', ALLOWED_ROOTS: root, AUTH_TOKEN: 'e2e-solo-ficticio',
  RESOURCES_SUBDIR: 'Recursos', MEMORIA_MAIN: 'tfg.tex', WATCH_POLLING: 'off' }, REPO_ROOT);
// Ajustes e historial propios; los recibos compartidos del worker se separan por ID de biblioteca.
cfg.settingsFile = path.join(root, 'data/settings.json');
cfg.historyDir = path.join(root, 'data/history');
await fs.access(path.join(cfg.webDist, 'index.html'));
const { app } = await buildApp(cfg, { logger: true, watch: true, fetchMetadata: async (url) => {
  assert(new URL(url).hostname === 'ejemplo.invalid', 'Los metadatos E2E deben ser ficticios');
  return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<title>Web ficticia E2E</title>') };
} });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  process.exit(0);
}
process.on('message', (message) => { if (message === 'close') void close(); });
process.on('disconnect', () => void close());
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
const url = await app.listen({ host: '127.0.0.1', port: 0 });
process.send?.({ url });
