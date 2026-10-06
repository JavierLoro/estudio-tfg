import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startWatcher } from '../src/events.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

describe('auth', () => {
  it('requires bearer token or et_token cookie when AUTH_TOKEN is set', async () => {
    t = await setup({ AUTH_TOKEN: 's3cret' });
    const r0 = await t.app.inject({ url: '/api/status' });
    expect(r0.statusCode).toBe(401);
    expect(r0.json().error).toBeTruthy();
    expect((await t.app.inject({ url: '/api/status', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/status', headers: { authorization: 'Bearer s3cret' } })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/status', headers: { cookie: 'a=b; et_token=s3cret' } })).statusCode).toBe(200);
  });

  it('no auth when AUTH_TOKEN is empty', async () => {
    t = await setup();
    expect((await t.app.inject({ url: '/api/status' })).statusCode).toBe(200);
  });

  it('unknown /api route → JSON 404', async () => {
    t = await setup();
    const r = await t.app.inject({ url: '/api/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'No encontrado' });
  });
});

describe('SSE /api/events', () => {
  it('streams change events from the watcher and compile events', async () => {
    t = await setup();
    const watcher = startWatcher(t.cfg, t.ctx.bus);
    await new Promise<void>((r) => watcher.once('ready', () => r()));
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (t.app.server.address() as AddressInfo).port;
    let buf = '';
    const req = http.get(`http://127.0.0.1:${port}/api/events`);
    const res = await new Promise<http.IncomingMessage>((r) => req.on('response', r));
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    res.setEncoding('utf8');
    res.on('data', (c) => (buf += c));
    try {
      await new Promise((r) => setTimeout(r, 100));
      await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema', 'nueva.md'), 'hola');
      await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema', 'ignorada.md.lock'), '');
      const deadline = Date.now() + 5000;
      while (!buf.includes('nueva.md') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(buf).toContain('event: change\ndata: {"root":"notes","path":"Sistema/nueva.md","kind":"add"}');
      t.ctx.bus.emit('compile', { ok: true, buildId: 'x' });
      await new Promise((r) => setTimeout(r, 50));
      expect(buf).toContain('event: compile\ndata: {"ok":true,"buildId":"x"}');
      expect(buf).not.toContain('.lock');
    } finally {
      req.destroy();
      await watcher.close();
    }
  });
});
