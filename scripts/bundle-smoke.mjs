// Humo del servidor reubicado: sin fuentes TypeScript ni tsx. Solo usa datos ficticios temporales.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const repo = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
const workerUrl = args.includes('--worker-url') ? arg('--worker-url') : null;
assert(!workerUrl || /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(workerUrl), 'El worker de pruebas debe ser loopback y propio');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-bundle-')));
const appRoot = path.join(root, 'aplicacion');
const dataDir = path.join(root, 'datos');
let builds = path.join(dataDir, 'builds');
let child, fakeWorker;
let logs = '';
try {
  if (workerUrl) {
    assert(args.includes('--output-dir'), 'El worker real necesita su carpeta /out compartida temporal');
    builds = await fs.realpath(arg('--output-dir'));
    const allowed = [await fs.realpath(os.tmpdir()), ...(process.env.RUNNER_TEMP ? [await fs.realpath(process.env.RUNNER_TEMP)] : [])];
    assert(allowed.some(p => builds.startsWith(p + path.sep)), 'Los builds deben estar en un temporal propio');
  }
  const dist = path.join(appRoot, 'server/dist');
  await fs.mkdir(dist, { recursive: true });
  await fs.copyFile(path.join(repo, 'server/dist/server.mjs'), path.join(dist, 'server.mjs'));
  const dependencies = path.join(appRoot, 'server/node_modules');
  await fs.mkdir(dependencies);
  for (const ent of await fs.readdir(path.join(repo, 'server/node_modules'), { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ['tsx', 'typescript', 'esbuild', '@esbuild', 'vitest', '@vitest', 'vite'].includes(ent.name)) continue;
    await fs.symlink(path.join(repo, 'server/node_modules', ent.name), path.join(dependencies, ent.name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  for (const dir of ['scripts', 'worker']) {
    await fs.mkdir(path.join(appRoot, dir));
    for (const name of await fs.readdir(path.join(repo, dir))) if (name.endsWith('.mjs') && !name.includes('.test.'))
      await fs.copyFile(path.join(repo, dir, name), path.join(appRoot, dir, name));
  }
  const templates = path.join(root, 'plantillas');
  await fs.cp(path.join(repo, 'templates'), templates, { recursive: true });
  const web = path.join(root, 'web');
  await fs.mkdir(web);
  await fs.writeFile(path.join(web, 'index.html'), '<!doctype html><p>Interfaz ficticia del bundle</p>');
  await fs.writeFile(path.join(appRoot, '.env'), 'RESOURCES_SUBDIR=../valor-no-permitido\n');
  const notes = path.join(root, 'notas');
  const memoria = path.join(root, 'memoria');
  await fs.mkdir(notes);
  await fs.mkdir(memoria);
  await fs.writeFile(path.join(notes, 'Nota.md'), '# Nota ficticia del bundle\n');
  await fs.writeFile(path.join(memoria, 'tfg.tex'), '\\documentclass{article}\n\\begin{document}Prueba ficticia del bundle.\\end{document}\n');
  let worker = workerUrl;
  if (!worker) {
    fakeWorker = http.createServer(async (req, res) => {
      if (req.url === '/health') return res.end(JSON.stringify({ ok: true, version: 'TeX ficticio' }));
      assert.equal(req.url, '/compile');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      assert(Buffer.concat(chunks).includes(Buffer.from('Prueba ficticia del bundle.')));
      const id = '20261013-000000-aaaaaa';
      await fs.mkdir(path.join(builds, id), { recursive: true });
      await fs.writeFile(path.join(builds, id, 'main.pdf'), '%PDF-1.7\nFigura ficticia\n%%EOF\n');
      res.end(JSON.stringify({ ok: true, buildId: id, durationMs: 1, pdf: `${id}/main.pdf`, diagnostics: [] }));
    });
    await new Promise(resolve => fakeWorker.listen(0, '127.0.0.1', resolve));
    worker = `http://127.0.0.1:${fakeWorker.address().port}`;
  }
  child = spawn(process.execPath, [path.join(dist, 'server.mjs')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
    PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    DATA_DIR: dataDir, BUILD_DIR: builds, TEMPLATES_DIR: templates, WEB_DIST: web, NOTES_DIR: notes, MEMORIA_DIR: memoria,
    ALLOWED_ROOTS: root, PORT: '0', HOST: '127.0.0.1', AUTH_TOKEN: 'token-ficticio-bundle', WORKER_URL: worker,
  } });
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  let url;
  for (let i = 0; i < 200; i++) {
    const m = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(logs);
    if (m) { url = m[1]; break; }
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(url, `No arrancó el bundle: ${logs}`);
  const request = (endpoint, options = {}) => fetch(url + endpoint, { ...options, headers: { authorization: 'Bearer token-ficticio-bundle', 'content-type': 'application/json', ...options.headers } });
  assert.equal((await fetch(url + '/api/status')).status, 401);
  assert.equal((await request('/api/status')).status, 200);
  assert((await (await fetch(url)).text()).includes('Interfaz ficticia del bundle'));
  assert.equal((await (await request('/api/file?root=notes&path=Nota.md')).json()).content, '# Nota ficticia del bundle\n');
  const compilation = await request('/api/compile', { method: 'POST', body: '{}' });
  const result = await compilation.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.diagnostics, []);
  assert((await (await request(result.pdfUrl)).arrayBuffer()).byteLength > 0);
  const target = path.join(root, 'memoria-desde-plantilla');
  const created = await request('/api/settings/init-memoria', { method: 'POST', body: JSON.stringify({ dir: target, perfil: 'generico' }) });
  assert.equal(created.status, 200, await created.text());
  assert((await fs.readFile(path.join(target, 'tfg.tex'), 'utf8')).includes('memoria'));
  await assert.rejects(fs.access(path.join(appRoot, 'server/src')));
  await assert.rejects(fs.access(path.join(dependencies, 'tsx')));
  console.log(`✓ Bundle reubicado sin TypeScript/tsx: autenticación, status, archivo, web, plantilla y compilación (${workerUrl ? 'TeX real' : 'worker ficticio'})`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  if (fakeWorker) await new Promise(resolve => fakeWorker.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
