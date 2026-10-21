import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/dist/server.mjs';
import { setupRoutes } from './setup.mjs';
import { developmentEnv } from '../scripts/desktop-dev.mjs';

test('las rutas de escritorio exigen token y no permiten finalizar sin PDF actual', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-setup-')));
  const dataDir = path.join(root, 'data');
  let server;
  try {
    await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'setup.json'), '{incompleto');
    await fs.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ notesDir: root }));
    server = await startServer({ DATA_DIR: dataDir, NOTES_DIR: path.join(root, 'Notas'), MEMORIA_DIR: path.join(root, 'Memoria'),
      ALLOWED_ROOTS: root, PORT: '0', HOST: '127.0.0.1', AUTH_TOKEN: 'token-ficticio', WORKER_URL: 'http://127.0.0.1:1' },
    { logger: false, watch: false, serveWeb: false, desktopDataDir: dataDir, configure: (app, ctx) => setupRoutes(app, ctx, { dataDir }) });
    const request = (url, method = 'GET', auth = true) => fetch(server.url + url, { method, headers: auth ? { authorization: 'Bearer token-ficticio' } : {} });
    assert.equal((await request('/api/desktop/setup', 'GET', false)).status, 401);
    assert.equal((await (await request('/api/desktop/setup')).json()).needsSetup, true);
    assert.equal((await (await request('/api/settings')).json()).values.notesDir, path.join(root, 'Notas'));
    assert.equal((await request('/api/desktop/setup/complete', 'POST')).status, 409);
    assert.equal((await request('/api/desktop/engine/prepare', 'POST')).status, 409);
    assert.equal((await request('/api/desktop/engine/cancel', 'POST', false)).status, 401);
    assert.equal((await request('/api/desktop/engine/cancel', 'POST')).status, 200);
    assert.equal(await fs.readFile(path.join(dataDir, 'setup.json'), 'utf8'), '{incompleto');
  } finally { await server?.app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('el perfil de desarrollo selecciona carpetas externas y confina sus archivos', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-folders-')));
  const env = developmentEnv(path.join(root, 'repo'), {});
  const notes = path.join(root, 'Notas externas'), memoria = path.join(root, 'Memoria externa');
  let server;
  try {
    for (const dir of [env.DATA_DIR, env.NOTES_DIR, env.MEMORIA_DIR, notes, memoria]) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(notes, 'Nota.md'), 'Nota ficticia');
    await fs.writeFile(path.join(memoria, 'tfg.tex'), 'Memoria ficticia');
    await fs.writeFile(path.join(root, 'fuera.md'), 'No seleccionado');
    let link = true;
    try { await fs.symlink(root, path.join(notes, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error; link = false; }
    const start = () => startServer({ ...env, PORT: '0', HOST: '127.0.0.1', AUTH_TOKEN: 'token-ficticio' },
      { logger: false, watch: false, serveWeb: false, desktopDataDir: env.DATA_DIR,
        configure: (app, ctx) => setupRoutes(app, ctx, { dataDir: env.DATA_DIR }) });
    server = await start();
    const request = (url, method = 'GET', body, auth = true) => fetch(server.url + url, { method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer token-ficticio' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await request('/api/settings', 'PUT', { notesDir: notes }, false)).status, 401);
    assert.equal((await request('/api/fs/dirs?path=' + encodeURIComponent(notes), 'GET', undefined, false)).status, 401);
    const updated = await request('/api/settings', 'PUT', { notesDir: notes, memoriaDir: memoria });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).values.notesDir, notes);
    assert.equal((await request('/api/fs/dirs?path=' + encodeURIComponent(path.dirname(notes)))).status, 200);
    const note = await request('/api/file?root=notes&path=Nota.md');
    assert.equal(note.status, 200); assert.equal((await note.json()).content, 'Nota ficticia');
    for (const escaped of ['../fuera.md', ...(link ? ['escape/fuera.md'] : [])])
      assert.equal((await request('/api/file?root=notes&path=' + encodeURIComponent(escaped))).status, 400);
    const internal = await request('/api/settings', 'PUT', { notesDir: env.DATA_DIR });
    assert.equal(internal.status, 400); assert.match((await internal.json()).error, /datos internos/);
    assert.equal(await fs.readFile(path.join(root, 'fuera.md'), 'utf8'), 'No seleccionado');
    await server.app.close(); server = await start();
    const stored = await (await request('/api/settings')).json();
    assert.equal(stored.values.notesDir, notes); assert.equal(stored.values.memoriaDir, memoria);
    assert.equal(stored.sources.notesDir, 'settings');
  } finally { await server?.app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
