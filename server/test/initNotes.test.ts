import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setup } from './helpers.ts';

test('crear notas selecciona la carpeta nueva; no sobrescribe existentes ni sale de raíces', async () => {
  const env = await setup();
  try {
    const dir = path.join(env.dir, 'Notas nuevas');
    const result = await env.app.inject({ method: 'POST', url: '/api/settings/init-notes', payload: { dir }, remoteAddress: '127.0.0.1' });
    expect(result.statusCode).toBe(200); expect(result.json().values.notesDir).toBe(dir);
    expect((await fs.stat(path.join(dir, 'Recursos'))).isDirectory()).toBe(true);
    await fs.writeFile(path.join(dir, 'Nota.md'), 'Contenido ficticio');
    const repeated = await env.app.inject({ method: 'POST', url: '/api/settings/init-notes', payload: { dir }, remoteAddress: '127.0.0.1' });
    expect(repeated.statusCode).toBe(409); expect(await fs.readFile(path.join(dir, 'Nota.md'), 'utf8')).toBe('Contenido ficticio');
    expect((await env.app.inject({ method: 'POST', url: '/api/settings/init-notes', payload: { dir: '/fuera' }, remoteAddress: '127.0.0.1' })).statusCode).toBe(400);
    expect((await env.app.inject({ method: 'POST', url: '/api/settings/init-notes', payload: { dir: path.join(env.dir, 'Otra') }, remoteAddress: '203.0.113.1' })).statusCode).toBe(403);
  } finally { await env.close(); }
});

test('notas y memoria no pueden solaparse con datos privados de escritorio', async () => {
  const env = await setup();
  try {
    env.cfg.desktopDataDir = path.join(env.dir, 'data');
    for (const dir of [env.dir, env.cfg.desktopDataDir, path.join(env.cfg.desktopDataDir, 'notes')])
      expect((await env.app.inject({ method: 'POST', url: '/api/settings/init-notes', payload: { dir }, remoteAddress: '127.0.0.1' })).statusCode).toBe(400);
  } finally { await env.close(); }
});
