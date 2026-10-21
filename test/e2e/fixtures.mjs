import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

export { expect };
const repo = fileURLToPath(new URL('../../', import.meta.url));
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGPwd3tKU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAE0y6EwonOyyAAAAAElFTkSuQmCC', 'base64');

async function start(root, restored, logs, withWorker, noTools, withContext) {
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(repo, 'test/e2e/server.mts'), root, restored ? 'restored' : 'new'], {
    cwd: path.join(repo, 'server'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ...(noTools ? { PATH: '' } : {}), E2E_WORKER_URL: withWorker ? process.env.E2E_WORKER_URL : '', E2E_CONTEXT: withContext ? '1' : '' },
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const exited = once(child, 'exit');
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.send('close');
    else child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  try {
    const ready = await Promise.race([
      once(child, 'message').then(([message]) => message),
      exited.then(() => { throw new Error(`No arrancó la API E2E:\n${logs.join('')}`); }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('La API E2E no arrancó en 15 s')), 15_000);
        child.once('message', () => clearTimeout(timer));
        child.once('exit', () => clearTimeout(timer));
      }),
    ]);
    return { url: ready.url, stop };
  } catch (error) { await stop(); throw error; }
}

export const test = base.extend({
  studio: async ({ context, page }, use, info) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-e2e-')));
    const servers = [], logs = [];
    async function launch(dir = root, restored = false) {
      const server = await start(dir, restored, logs, info.title.includes('@worker'), info.title.includes('@sin-herramientas'), info.title.includes('@contexto'));
      servers.push(server);
      await context.addCookies([{ name: 'et_token', value: 'e2e-solo-ficticio', url: server.url }]);
      return server;
    }
    try {
      const server = await launch();
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return servers.some((s) => url.origin === s.url) || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
      });
      await use({ root, server, launch, page,
        async json(endpoint, options) {
          const response = await context.request.fetch(server.url + endpoint, options);
          expect(response.ok(), await response.text()).toBeTruthy();
          return response.json();
        },
        async biblioteca(url = server.url) {
          await page.goto(url);
          await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
          await expect(page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('heading', { name: 'Biblioteca', level: 1, exact: true })).toBeVisible();
          await expect(page.getByText(/\d+ de \d+ recursos/)).toBeVisible();
        },
      });
    } finally {
      if (info.status !== info.expectedStatus && !page.isClosed())
        await info.attach('pantalla-ficticia.png', { body: await page.screenshot(), contentType: 'image/png' }).catch((e) => logs.push(String(e)));
      await page.goto('about:blank').catch((e) => logs.push(String(e)));
      const stopped = await Promise.allSettled(servers.reverse().map((server) => server.stop()));
      if (info.status !== info.expectedStatus) await info.attach('api-ficticia.log', { body: logs.join(''), contentType: 'text/plain' });
      await fs.rm(root, { recursive: true, force: true });
      const failed = stopped.filter((result) => result.status === 'rejected');
      if (failed.length) throw new AggregateError(failed.map((r) => r.reason), 'No se detuvo una API E2E');
    }
  },
});

export async function add(page, title, files = [], url = '') {
  await page.getByRole('button', { name: 'Añadir', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Añadir a Biblioteca' });
  await dialog.getByLabel('Título', { exact: true }).fill(title);
  if (url) await dialog.getByLabel('URL', { exact: true }).fill(url);
  if (files.length) await dialog.getByLabel('Seleccionar archivos para Biblioteca').setInputFiles(files);
  await dialog.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled();
  return dialog;
}

export async function pending(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('et:captures', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction('items').objectStore('items').getAll();
        req.onsuccess = () => resolve(req.result.map((item) => ({ id: item.id, libraryId: item.libraryId,
          files: item.files?.map((f) => ({ name: f.name, size: f.blob.size })), blocked: item.blocked })));
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  });
}
