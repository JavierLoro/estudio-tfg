import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/dist/server.mjs';
import { setupRoutes } from './setup.mjs';

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
