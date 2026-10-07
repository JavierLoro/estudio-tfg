import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { EventBus, WatchManager, useWatchPolling } from '../src/events.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

describe('WATCH_POLLING', () => {
  it.each([
    ['auto', ['/home/notas'], false, false],
    ['auto', ['/home/notas'], true, true],
    ['auto', ['\\\\servidor\\vault'], false, true],
    ['auto', ['//servidor/vault'], false, true],
    ['auto', ['/mnt/c/vault'], false, true],
    ['auto', ['/mnt/D'], false, true],
    ['auto', ['/mnt/datos/vault'], false, false],
    ['auto', ['C:\\Users\\Ana\\Vault'], false, false],
    ['auto', ['/home/notas', '/mnt/z/memoria'], false, true],
    ['on', ['/home/notas'], false, true],
    ['off', ['\\\\servidor\\vault', '/mnt/c'], true, false],
  ] as const)('%s %j Docker=%s → %s', (mode, roots, docker, expected) => {
    expect(useWatchPolling(mode, [...roots], docker)).toBe(expected);
  });

  it('auto por defecto; rechaza valores desconocidos', () => {
    expect(loadConfig({}).watchPolling).toBe('auto');
    expect(loadConfig({ WATCH_POLLING: 'on' }).watchPolling).toBe('on');
    expect(() => loadConfig({ WATCH_POLLING: 'yes' })).toThrow('WATCH_POLLING');
  });

  it('registra el error, lo publica en status y SSE, y lo limpia al reiniciar', async () => {
    t = await setup({}, { watch: true });
    const log = vi.fn();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.on('watcher', (s) => events.push(s));
    const w = new WatchManager(t.cfg, bus, log);
    await w.start();
    // Usar el manager probado para consultar la ruta, cerrando ambos al terminar.
    const original = t.ctx.watcher;
    t.ctx.watcher = w;
    try {
      const error = Object.assign(new Error('ENOSPC: límite de inotify'), { code: 'ENOSPC' });
      w.current!.emit('error', error);
      expect(log).toHaveBeenCalledWith(error);
      const status = (await t.app.inject('/api/status')).json();
      expect(status).toMatchObject({ watcher: 'error', watcherMessage: expect.stringContaining('ENOSPC') });
      expect(events.at(-1)).toEqual(w.status);
      await w.restart();
      expect((await t.app.inject('/api/status')).json()).toMatchObject({ watcher: 'ok' });
      expect(w.status).not.toHaveProperty('watcherMessage');
    } finally {
      t.ctx.watcher = original;
      await w.close();
    }
  });

  it('un cambio externo con sondeo llega por SSE en menos de 2 s', { timeout: 10_000 }, async () => {
    t = await setup({ WATCH_POLLING: 'on' }, { watch: true });
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (t.app.server.address() as AddressInfo).port;
    const req = http.get(`http://127.0.0.1:${port}/api/events`);
    const res = await new Promise<http.IncomingMessage>((resolve) => req.on('response', resolve));
    res.setEncoding('utf8');
    let buf = '';
    let elapsed = Infinity;
    let started = 0;
    res.on('data', (chunk) => {
      buf += chunk;
      if (buf.includes('sondeo.md') && !Number.isFinite(elapsed)) elapsed = performance.now() - started;
    });
    try {
      started = performance.now();
      await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema/sondeo.md'), 'Cambio externo ficticio');
      const deadline = performance.now() + 3000;
      while (!Number.isFinite(elapsed) && performance.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      expect(buf).toContain('event: change');
      expect(elapsed).toBeLessThan(2000);
      t.ctx.watcher!.current!.emit('error', new Error('EPERM ficticio'));
      await new Promise((r) => setTimeout(r, 50));
      expect(buf).toContain('event: watcher');
      expect(buf).toContain('EPERM ficticio');
    } finally {
      req.destroy();
    }
  });
});
