import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createManifest, inventory, verifyManifest } from './respaldo-manifest.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'respaldo-test-'));
  const root = path.join(dir, 'original');
  await fs.mkdir(path.join(root, '.oculto'), { recursive: true });
  await fs.writeFile(path.join(root, 'Nota con ñ.md'), 'Ficticio\r\n');
  await fs.writeFile(path.join(root, '.oculto', 'binario'), Buffer.from([0, 128, 255]));
  const manifest = path.join(dir, 'inventario.json');
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return { dir, root, manifest };
}

test('el manifiesto incluye ocultos, binarios y carpetas, sin guardar rutas absolutas', async (t) => {
  const { root, manifest } = await fixture(t);
  const expected = await createManifest(root, manifest);
  const copy = `${root}-copia`;
  await fs.cp(root, copy, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(await verifyManifest(copy, manifest), expected);
  assert.deepEqual(expected.entries.map((entry) => entry.path), ['', '.oculto', '.oculto/binario', 'Nota con ñ.md']);
  assert.ok(expected.entries.filter((entry) => entry.type === 'file').every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
  assert.ok(!(await fs.readFile(manifest, 'utf8')).includes(root));
});

test('detecta copia interrumpida, bytes cambiados y archivos o carpetas sobrantes', async (t) => {
  const { root, manifest } = await fixture(t);
  await createManifest(root, manifest);
  const partial = `${root}-parcial`;
  await fs.mkdir(partial);
  await fs.copyFile(path.join(root, 'Nota con ñ.md'), path.join(partial, 'Nota con ñ.md'));
  await assert.rejects(verifyManifest(partial, manifest), /no coincide/);
  await fs.cp(root, partial, { recursive: true });
  await verifyManifest(partial, manifest);
  await fs.writeFile(path.join(partial, 'Nota con ñ.md'), 'Alterado\r\n');
  await assert.rejects(verifyManifest(partial, manifest), /no coincide/);
  await fs.copyFile(path.join(root, 'Nota con ñ.md'), path.join(partial, 'Nota con ñ.md'));
  await fs.mkdir(path.join(partial, 'sobrante'));
  await assert.rejects(verifyManifest(partial, manifest), /no coincide/);
  await verifyManifest(root, manifest);
});

test('no escribe en el origen ni sobrescribe un manifiesto existente', async (t) => {
  const { root, manifest } = await fixture(t);
  const before = await inventory(root);
  await assert.rejects(createManifest(root, path.join(root, 'inventario.json')), /fuera del origen/);
  await createManifest(root, manifest);
  const bytes = await fs.readFile(manifest);
  await assert.rejects(createManifest(root, manifest), { code: 'EEXIST' });
  assert.deepEqual(await fs.readFile(manifest), bytes);
  assert.deepEqual(await inventory(root), before);
});

test('un manifiesto truncado o incompatible no valida una copia', async (t) => {
  const { root, manifest } = await fixture(t);
  for (const content of ['{"version":1,"entries":[', '{}', '{"version":2,"entries":[]}']) {
    await fs.writeFile(manifest, content);
    await assert.rejects(verifyManifest(root, manifest), /manifiesto|Manifiesto/);
  }
});

test('rechaza enlaces sin seguirlos y propaga archivos ausentes', async (t) => {
  const { dir, root, manifest } = await fixture(t);
  await assert.rejects(inventory(path.join(dir, 'no-existe')), { code: 'ENOENT' });
  // Junctions permiten comprobar el rechazo en Windows sin privilegios de symlink.
  await fs.symlink(root, path.join(dir, 'enlace'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createManifest(path.join(dir, 'enlace'), manifest), /enlaces/);
  await fs.symlink(dir, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inventory(root), /enlaces/);
});

test('la CLI sirve también para archivos privados y comunica errores con código 1', async (t) => {
  const { root, manifest } = await fixture(t);
  const file = path.join(root, 'Nota con ñ.md');
  const cli = path.join(import.meta.dirname, 'respaldo-manifest.mjs');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(run('crear', file, manifest).status, 0);
  assert.equal(run('verificar', file, manifest).status, 0);
  assert.equal(run('crear', file, manifest).status, 1);
  assert.equal(run('inventar').status, 1);
  await fs.writeFile(file, 'Cambio ficticio');
  const changed = run('verificar', file, manifest);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /no coincide/);
});

test('los comandos de la guía copian y verifican todas las partes sin sobrescribir', async (t) => {
  const { dir, root } = await fixture(t);
  const memoria = path.join(dir, 'memoria'), datos = path.join(dir, 'datos'), copia = path.join(dir, 'respaldo');
  await fs.mkdir(memoria); await fs.mkdir(datos);
  await fs.writeFile(path.join(memoria, 'tfg.tex'), 'Memoria ficticia\n');
  await fs.writeFile(path.join(datos, 'settings.json'), '{}\n');
  await fs.writeFile(path.join(dir, '.env'), 'AUTH_TOKEN=solo-ficticio\n');
  const guide = await fs.readFile(path.join(import.meta.dirname, '../docs/RESPALDO.md'), 'utf8');
  const windows = process.platform === 'win32';
  const language = windows ? 'powershell' : 'sh';
  const block = guide.match(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```'))[1];
  const quote = (s) => windows ? `'${s.replaceAll("'", "''")}'` : `'${s.replaceAll("'", "'\\''")}'`;
  let code = block.replaceAll('node scripts/respaldo-manifest.mjs', `${windows ? '& ' : ''}${quote(process.execPath)} ${quote(path.join(import.meta.dirname, 'respaldo-manifest.mjs'))}`);
  const paths = windows
    ? [['E:/Respaldos/TFG-AAAAMMDD', copia], ['C:/TFG/Vault', root], ['C:/TFG/Memoria', memoria], ['C:/Herramientas/estudio-tfg/data', datos]]
    : [['/ruta/disco/respaldo-AAAAMMDD', copia], ['/ruta/Vault', root], ['/ruta/Memoria', memoria], ['/ruta/estudio-tfg/data', datos]];
  for (const [from, to] of paths) code = code.replace(quote(from), quote(to));
  const run = () => spawnSync(windows ? 'powershell.exe' : '/bin/sh', windows ? ['-NoProfile', '-NonInteractive', '-Command', code] : ['-c', code], { cwd: dir, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  for (const name of ['notas', 'memoria', 'datos', 'entorno']) {
    await verifyManifest(path.join(copia, name), path.join(copia, `${name}.manifest.json`));
  }
  assert.match(await fs.readFile(path.join(copia, 'COPIA-VERIFICADA.txt'), 'utf8'), /Todas las partes verificadas/);
  assert.notEqual(run().status, 0, 'una carpeta de respaldo existente no se reutiliza');
  await verifyManifest(root, path.join(copia, 'notas.manifest.json'));
});
