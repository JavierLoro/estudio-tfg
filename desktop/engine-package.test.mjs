import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { EnginePackage, validatePackage } from './engine-package.mjs';

function tarEntry(name, { content = '#!/bin/sh\nexit 0\n', type = '0', link = '' } = {}) {
  const h = Buffer.alloc(512); const data = Buffer.from(content);
  h.write(name); h.write('0000755\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136);
  h.fill(32, 148, 156); h.write(type, 156); h.write(link, 157); h.write('ustar\0', 257); h.write('00', 263);
  h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}
const tar = (...entries) => Buffer.concat([...entries, Buffer.alloc(1024)]);
const valid = () => tar(...['latexmk', 'biber', 'pdflatex', 'perl'].map(name => tarEntry(`bin/${name}`)));
function manifest(bytes, raw, extra = {}) {
  return { schema: 1, id: 'texlive-2026-test', platform: 'darwin-arm64', url: 'https://example.invalid/engine.tar.gz',
    bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), unpackedBytes: raw.length,
    binDir: 'bin', perlDir: 'bin', ...extra };
}
async function fixture(fn) {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-package-')));
  try { await fn(dataDir); } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}
async function install(dataDir, raw = valid(), extra = {}) {
  const bytes = gzipSync(raw);
  const engine = new EnginePackage({ dataDir, platform: 'darwin-arm64', manifest: manifest(bytes, raw, extra), fetchPackage: async () => new Response(bytes) });
  await engine.load(); engine.prepare(); await engine.operation;
  return engine;
}

test('publica un paquete verificado y conserva permisos y rutas al reiniciar sin red', () => fixture(async dataDir => {
  const engine = await install(dataDir);
  assert.equal(engine.view().phase, 'ready'); assert.equal(engine.view().current, true);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(engine.paths.binDir, 'latexmk'))).mode & 0o777, 0o755);
  let fetched = false;
  const restarted = new EnginePackage({ dataDir, platform: 'darwin-arm64', manifest: engine.manifest, fetchPackage: async () => { fetched = true; throw new Error('Sin red'); } });
  await restarted.load(); restarted.prepare();
  assert.deepEqual(restarted.paths, engine.paths); assert.equal(fetched, false);
}));

test('rechaza hash, tamaño, rutas escapadas, enlaces y tar truncado; deja reintentar', () => fixture(async dataDir => {
  for (const [raw, extra] of [[valid(), { sha256: '0'.repeat(64) }], [valid(), { bytes: 1 }],
    [tar(tarEntry('../escape')), {}], [tar(tarEntry('bin/nul.txt')), {}], [tar(tarEntry('bin/a:stream')), {}],
    [tar(tarEntry('bin/link', { type: '2', link: '../../escape' })), {}],
    [valid().subarray(0, 700), {}], [valid(), { unpackedBytes: 100 }]]) {
    const engine = await install(dataDir, raw, extra);
    assert.equal(engine.view().phase, 'error'); assert.equal(engine.paths, null);
    assert.equal((await fs.readdir(engine.root)).some(name => !name.startsWith('.')), false);
  }
  assert.equal((await install(dataDir)).view().current, true);
}));

test('descarga interrumpida y cancelación no publican un motor parcial', () => fixture(async dataDir => {
  const raw = valid(); const bytes = gzipSync(raw);
  const broken = new EnginePackage({ dataDir, platform: 'darwin-arm64', manifest: manifest(bytes, raw),
    fetchPackage: async () => new Response(bytes.subarray(0, 20)) });
  await broken.load(); broken.prepare(); await broken.operation; assert.equal(broken.view().phase, 'error');
  const cancelled = new EnginePackage({ dataDir, platform: 'darwin-arm64', manifest: broken.manifest,
    fetchPackage: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  await cancelled.load(); cancelled.prepare(); await cancelled.cancel();
  assert.equal(cancelled.view().phase, 'cancelled');
  assert.deepEqual(await fs.readdir(cancelled.root), []);
  assert.equal((await install(dataDir)).view().current, true);
}));

test('un cambio de release fallido conserva el motor válido anterior y sus documentos', () => fixture(async dataDir => {
  const previous = await install(dataDir);
  await fs.writeFile(path.join(dataDir, 'nota-ficticia.md'), 'Texto intacto');
  const raw = valid(); const bytes = gzipSync(raw);
  const next = new EnginePackage({ dataDir, platform: 'darwin-arm64', manifest: manifest(bytes, raw, { id: 'texlive-next', sha256: '1'.repeat(64) }), fetchPackage: async () => new Response(bytes) });
  await next.load(); assert.deepEqual(next.paths, previous.paths);
  next.prepare(); await next.operation;
  assert.equal(next.view().phase, 'error'); assert.deepEqual(next.paths, previous.paths);
  assert.equal(await fs.readFile(path.join(dataDir, 'nota-ficticia.md'), 'utf8'), 'Texto intacto');
  const restart = new EnginePackage({ dataDir, platform: 'darwin-arm64', manifest: next.manifest });
  await restart.load(); assert.deepEqual(restart.paths, previous.paths);
}));

test('el manifiesto fija plataforma, HTTPS y rutas relativas', () => {
  const raw = valid(); const bytes = gzipSync(raw); const entry = manifest(bytes, raw);
  for (const change of [{ platform: 'win32-x64' }, { binDir: '../bin' }, { perlDir: '/usr/bin' }, { url: 'http://example.invalid/' }, { sha256: 'x' }])
    assert.throws(() => validatePackage({ ...entry, ...change }, 'darwin-arm64'));
});

test('espacio insuficiente se informa sin descargar ni publicar', () => fixture(async dataDir => {
  const raw = valid(); const bytes = gzipSync(raw); let fetched = false;
  const engine = new EnginePackage({ dataDir, platform: 'darwin-arm64', manifest: manifest(bytes, raw), fetchPackage: async () => { fetched = true; return new Response(bytes); } });
  await engine.load();
  const statfs = fs.statfs;
  try {
    fs.statfs = async () => ({ bavail: 0, bsize: 4096 });
    engine.prepare(); await engine.operation;
    assert.equal(engine.view().phase, 'error'); assert.match(engine.view().message, /espacio/); assert.equal(fetched, false);
  } finally { fs.statfs = statfs; }
}));

test('un paquete que declara LuaLaTeX debe contener su ejecutable; los anteriores siguen válidos', () => fixture(async dataDir => {
  const missing = await install(dataDir, valid(), {capabilities:{lualatex:true}});
  assert.equal(missing.view().phase, 'error');assert.equal(missing.paths,null);
  const raw = tar(...['latexmk','biber','pdflatex','lualatex','perl'].map(name => tarEntry('bin/'+name)));
  const full = await install(dataDir, raw, {capabilities:{lualatex:true}});
  assert.equal(full.view().phase, 'ready');assert.equal(full.view().current,true);
}));
