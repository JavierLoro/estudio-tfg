import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildConfig } from './electron-builder.mjs';

test('el runtime incluye los paquetes externos de producción del servidor y su lockfile', async () => {
  const read = async file => JSON.parse(await fs.readFile(new URL(file, import.meta.url), 'utf8'));
  const server = await read('../server/package.json');
  const runtime = await read('./runtime-package.json');
  const lock = await read('./runtime-package-lock.json');
  assert.deepEqual(lock.packages[''].dependencies, runtime.dependencies);
  for (const name of Object.keys(server.dependencies)) {
    if (name === 'tsx') continue; // El bundle ya no ejecuta TypeScript.
    assert.ok(Object.hasOwn(runtime.dependencies, name), `Falta ${name} en el runtime de escritorio`);
    assert.equal(lock.packages[`node_modules/${name}`]?.version, runtime.dependencies[name], `Revisar el lockfile de ${name}`);
  }
});

test('ambas variantes usan iconos con transparencia y un formato específico para macOS', async () => {
  const windows = fileURLToPath(new URL('./icons/windows.png', import.meta.url));
  const macos = fileURLToPath(new URL('./icons/macos.png', import.meta.url));
  for (const variant of ['offline', 'online']) {
    const config = buildConfig('/runtime', '/output', variant, '0.2.0');
    assert.equal(config.icon, windows);
    assert.equal(config.mac.icon, macos);
  }
  for (const file of [windows, macos]) {
    const png = await fs.readFile(file);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png[25], 6, 'El PNG debe incluir canal alfa (RGBA)');
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
    assert.ok(png.readUInt32BE(16) >= 512, 'El icono debe ser cuadrado y de al menos 512 píxeles');
  }
});
