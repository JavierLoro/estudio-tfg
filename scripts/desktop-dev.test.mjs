import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { developmentEnv, prepareDevelopment, changedPart } from './desktop-dev.mjs';
import { platformId } from '../desktop/engine-package.mjs';
import { RELEASES_URL } from '../desktop/distribution.mjs';
import { desktopAllowedRoots } from '../desktop/folders.mjs';

async function fixture(t) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio desktop dev '));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await fs.mkdir(path.join(repo, 'templates/base'), { recursive: true });
  await fs.mkdir(path.join(repo, 'templates/perfiles/generico'), { recursive: true });
  await fs.writeFile(path.join(repo, 'templates/base/tfg.tex'), 'Plantilla ficticia');
  await fs.writeFile(path.join(repo, 'templates/perfiles/generico/perfil.json'), '{"nombre":"Ficticio"}');
  const manifest = { schema: 1, platform: platformId(), id: 'tex-ficticio', sha256: 'a'.repeat(64), bytes: 123,
    unpackedBytes: 456, url: `${RELEASES_URL}/download/distribucion-v0.2.0/tex.tar.gz`, binDir: 'bin', perlDir: 'perl' };
  const bytes = Buffer.from(JSON.stringify(manifest));
  const asset = { name: `engine-${platformId()}.json`, bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), url: `${RELEASES_URL}/download/distribucion-v0.2.0/engine.json` };
  const calls = [];
  const fetchPackage = async url => {
    calls.push(url);
    if (url === `${RELEASES_URL}/latest/download/manifest.json`) return Response.json({ assets: [asset] });
    assert.equal(url, asset.url); return new Response(bytes);
  };
  return { repo, env: developmentEnv(repo), manifest, asset, fetchPackage, calls };
}

test('el perfil ignora rutas y motor heredados y no comparte los datos de la app instalada', () => {
  const env = developmentEnv(path.resolve('repo-ficticio'), { DATA_DIR: '/datos-ficticios', NOTES_DIR: '/notas-ficticias',
    MEMORIA_DIR: '/memoria-ficticia', BUILD_DIR: '/builds-ficticios', ALLOWED_ROOTS: '/externo', TEX_BIN_DIR: '/tex-externo',
    ELECTRON_RUN_AS_NODE: '1', PATH: 'herramientas-ficticias' });
  const root = path.join(path.resolve('repo-ficticio'), 'workspace/desktop-dev');
  assert.equal(env.DATA_DIR, path.join(root, 'data'));
  assert.equal(env.NOTES_DIR, path.join(root, 'Notas'));
  assert.equal(env.MEMORIA_DIR, path.join(root, 'Memoria'));
  assert.equal(env.BUILD_DIR, path.join(root, 'data/builds'));
  assert.equal(env.ALLOWED_ROOTS, '/externo');
  assert.equal(developmentEnv(path.resolve('repo-ficticio'), {}).ALLOWED_ROOTS, desktopAllowedRoots());
  assert.equal(env.TEX_BIN_DIR, ''); assert.equal(env.TEX_PERL_DIR, '');
  assert.equal(env.COMPILE_ENGINE, 'local'); assert.equal(env.PATH, 'herramientas-ficticias');
  assert.ok(!('ELECTRON_RUN_AS_NODE' in env));
});

test('prepara fixtures una vez y reutiliza el manifiesto sin red ni sobrescrituras', async t => {
  const f = await fixture(t);
  assert.deepEqual(await prepareDevelopment(f.repo, f.env, f.fetchPackage), f.manifest);
  assert.equal(f.calls.length, 2);
  const tex = path.join(f.env.MEMORIA_DIR, 'tfg.tex');
  await fs.writeFile(tex, 'Cambios ficticios conservados');
  await fs.writeFile(path.join(f.env.DATA_DIR, 'settings.json'), '{"ficticio":true}');
  assert.deepEqual(await prepareDevelopment(f.repo, f.env, () => assert.fail('No debe consultar la red')), f.manifest);
  assert.equal(await fs.readFile(tex, 'utf8'), 'Cambios ficticios conservados');
  assert.equal(await fs.readFile(path.join(f.env.DATA_DIR, 'settings.json'), 'utf8'), '{"ficticio":true}');
  assert.match(await fs.readFile(path.join(f.env.NOTES_DIR, 'Nota de pruebas.md'), 'utf8'), /ficticio/);
});

test('rechaza hash, tamaño y URL incorrectos sin cachear un manifiesto no verificado', async t => {
  for (const field of ['sha256', 'bytes', 'url']) {
    const f = await fixture(t);
    f.asset[field] = field === 'bytes' ? 999 : field === 'url' ? 'https://ejemplo.invalid/engine.json' : 'b'.repeat(64);
    await assert.rejects(prepareDevelopment(f.repo, f.env, f.fetchPackage), /válido|hash y tamaño/);
    await assert.rejects(fs.access(path.join(f.env.DATA_DIR, 'engine-manifest.json')), { code: 'ENOENT' });
  }
});

test('un error remoto o un manifiesto cacheado corrupto no se ocultan ni reemplazan', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareDevelopment(f.repo, f.env, async () => new Response('fallo', { status: 503 })), /HTTP 503/);
  const file = path.join(f.env.DATA_DIR, 'engine-manifest.json');
  await fs.writeFile(file, '{truncado');
  await assert.rejects(prepareDevelopment(f.repo, f.env, () => assert.fail('No debe reemplazar la caché corrupta')));
  assert.equal(await fs.readFile(file, 'utf8'), '{truncado');
});

test('limita los manifiestos remotos antes de interpretarlos o guardarlos', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareDevelopment(f.repo, f.env, async () => new Response(Buffer.alloc(1024 * 1024 + 1))), /tamaño permitido/);
  await assert.rejects(fs.access(path.join(f.env.DATA_DIR, 'engine-manifest.json')), { code: 'ENOENT' });
});

test('distingue recarga de interfaz y reinicio de servidor o escritorio', () => {
  const repo = path.resolve('repo-ficticio');
  assert.equal(changedPart(repo, path.join(repo, 'web/src/App.tsx')), 'web');
  assert.equal(changedPart(repo, path.join(repo, 'server/src/app.ts')), 'server');
  for (const file of ['desktop/main.mjs', 'desktop/icons/macos.png', 'worker/engine.mjs', 'scripts/memoria-template.mjs', 'templates/base/tfg.tex'])
    assert.equal(changedPart(repo, path.join(repo, file)), 'desktop');
});
