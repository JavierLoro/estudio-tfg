import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { computeSourceRev } from '../src/compile.ts';
import { canSymlink, setup, type TestEnv } from './helpers.ts';

interface Fake {
  url: string;
  server: http.Server;
  calls: number;
  maxConcurrent: number;
  mode: 'ok' | 'fail';
  delayMs: number;
  /** Entries of the last tar received: path → { type, content }. */
  lastTar: Map<string, { type: string; content: string }>;
  lastHeaders: http.IncomingHttpHeaders;
}

/** Parse a tar request body with node-tar (as the fake worker). */
async function readTar(req: http.IncomingMessage) {
  const out = new Map<string, { type: string; content: string }>();
  const parser = new tar.Parser({
    onReadEntry: (e) => {
      const chunks: Buffer[] = [];
      e.on('data', (c: Buffer) => chunks.push(c));
      e.on('end', () => out.set(e.path, { type: e.type, content: Buffer.concat(chunks).toString('utf8') }));
    },
  });
  await pipeline(req, parser as any);
  return out;
}

async function fakeWorker(buildDir: () => string): Promise<Fake> {
  let active = 0;
  const f: Fake = { url: '', server: null as any, calls: 0, maxConcurrent: 0, mode: 'ok', delayMs: 50, lastTar: new Map(), lastHeaders: {} };
  f.server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === 'POST' && req.url === '/compile') {
      f.lastHeaders = req.headers;
      f.lastTar = await readTar(req);
      const main = decodeURIComponent(String(req.headers['x-main']));
      f.calls++;
      active++;
      f.maxConcurrent = Math.max(f.maxConcurrent, active);
      await new Promise((r) => setTimeout(r, f.delayMs));
      const buildId = `b${f.calls}-${Date.now()}`;
      const dir = path.join(buildDir(), buildId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'main.log'), `log de ${main} #${f.calls}`);
      const ok = f.mode === 'ok';
      if (ok) await fs.writeFile(path.join(dir, 'main.pdf'), `%PDF-1.5 build ${f.calls}`);
      active--;
      res.setHeader('content-type', 'application/json');
      return res.end(
        JSON.stringify({
          ok,
          buildId,
          durationMs: 1234,
          pdf: ok ? `${buildId}/main.pdf` : null,
          log: `${buildId}/main.log`,
          diagnostics: ok
            ? [{ severity: 'warning', file: 'intro.tex', line: 3, message: 'Citation `x` undefined' }]
            : [{ severity: 'error', file: 'intro.tex', line: 12, message: 'Undefined control sequence.' }],
        }),
      );
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', r));
  f.url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  return f;
}

const supportsFileSymlink = await canSymlink();

let t: TestEnv;
let w: Fake;
beforeEach(async () => {
  let bd = '';
  w = await fakeWorker(() => bd);
  t = await setup({ WORKER_URL: w.url });
  bd = t.cfg.buildDir;
});
afterEach(async () => {
  await t.close();
  w.server.closeAllConnections();
  await new Promise((r) => w.server.close(r));
});

describe('compile', () => {
  it('404 on /api/compile/last before any compile; status reports worker up', async () => {
    expect((await t.app.inject({ url: '/api/compile/last' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/api/status' })).json().worker).toBe('up');
  });

  it('successful compile returns result, serves pdf and log, persists last.json', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/compile' });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.ok).toBe(true);
    expect(r.buildId).toMatch(/^b1-/);
    expect(r.pdfUrl).toBe(`/api/pdf/${r.buildId}.pdf`);
    expect(r.durationMs).toBe(1234);
    expect(new Date(r.startedAt).toString()).not.toBe('Invalid Date');
    expect(r.sourceRev).toBe(await computeSourceRev(t.cfg));
    expect(r.diagnostics).toEqual([{ severity: 'warning', file: 'intro.tex', line: 3, message: 'Citation `x` undefined' }]);

    const pdf = await t.app.inject({ url: r.pdfUrl });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body).toBe('%PDF-1.5 build 1');
    const log = await t.app.inject({ url: `/api/compile/log/${r.buildId}` });
    expect(log.body).toBe('log de tfg.tex #1');
    expect(log.headers['content-type']).toMatch(/^text\/plain/);

    expect((await t.app.inject({ url: '/api/compile/last' })).json()).toEqual(r);
    const persisted = JSON.parse(await fs.readFile(path.join(t.cfg.buildDir, 'last.json'), 'utf8'));
    expect(persisted.last).toEqual(r);

    // a new server instance reads last.json
    const { app: app2 } = await buildApp(t.cfg, { serveWeb: false });
    expect((await app2.inject({ url: '/api/compile/last' })).json()).toEqual(r);
    await app2.close();
  });

  it('failed compile keeps pointing to the last good PDF', async () => {
    const good = (await t.app.inject({ method: 'POST', url: '/api/compile' })).json();
    w.mode = 'fail';
    const bad = (await t.app.inject({ method: 'POST', url: '/api/compile' })).json();
    expect(bad.ok).toBe(false);
    expect(bad.buildId).not.toBe(good.buildId);
    expect(bad.pdfUrl).toBe(good.pdfUrl);
    expect(bad.diagnostics[0]).toEqual({ severity: 'error', file: 'intro.tex', line: 12, message: 'Undefined control sequence.' });
    expect((await t.app.inject({ url: `/api/compile/log/${bad.buildId}` })).statusCode).toBe(200);
  });

  it('last good PDF pruned by the worker → pdfUrl null', async () => {
    const good = (await t.app.inject({ method: 'POST', url: '/api/compile' })).json();
    await fs.rm(path.join(t.cfg.buildDir, good.buildId), { recursive: true });
    w.mode = 'fail';
    expect((await t.app.inject({ method: 'POST', url: '/api/compile' })).json().pdfUrl).toBeNull();
  });

  it('failed first compile has pdfUrl null', async () => {
    w.mode = 'fail';
    const bad = (await t.app.inject({ method: 'POST', url: '/api/compile' })).json();
    expect(bad.pdfUrl).toBeNull();
  });

  it('serialises compiles (never two at once in the worker)', async () => {
    w.delayMs = 150;
    const results = await Promise.all([1, 2, 3, 4].map(() => t.app.inject({ method: 'POST', url: '/api/compile' })));
    expect(results.every((r) => r.statusCode === 200 && r.json().ok)).toBe(true);
    expect(w.maxConcurrent).toBe(1);
    // first runs, the rest coalesce into one queued compile
    expect(w.calls).toBe(2);
  });

  it('sourceRev changes when a memoria source changes, not when aux files change', async () => {
    const r1 = (await t.app.inject({ method: 'POST', url: '/api/compile' })).json();
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'main.aux'), 'aux');
    expect(await computeSourceRev(t.cfg)).toBe(r1.sourceRev);
    await fs.appendFile(path.join(t.cfg.memoriaDir, '1-capitulos', '01-introduccion.tex'), '\n% cambio\n');
    const r2 = (await t.app.inject({ method: 'POST', url: '/api/compile' })).json();
    expect(r2.sourceRev).not.toBe(r1.sourceRev);
  });

  it('emits a compile event on the bus', async () => {
    const got: any[] = [];
    t.ctx.bus.on('compile', (r) => got.push(r));
    const r = (await t.app.inject({ method: 'POST', url: '/api/compile' })).json();
    expect(got).toEqual([r]);
  });

  it.skipIf(!supportsFileSymlink)('sends a tar of the memoria sources (same filter as sourceRev) with X-Main', async () => {
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'main.aux'), 'aux');
    await fs.writeFile(path.join(t.cfg.memoriaDir, '.oculto.tex'), 'x');
    await fs.mkdir(path.join(t.cfg.memoriaDir, 'build'), { recursive: true });
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'build', 'x.tex'), 'x');
    await fs.writeFile(path.join(t.dir, 'secreto.tex'), 'secreto');
    await fs.symlink(path.join(t.dir, 'secreto.tex'), path.join(t.cfg.memoriaDir, 'fuera.tex'));
    await fs.symlink(path.join(t.cfg.memoriaDir, 'datos.tex'), path.join(t.cfg.memoriaDir, 'enlace.tex'));
    const r = (await t.app.inject({ method: 'POST', url: '/api/compile' })).json();
    expect(r.ok).toBe(true);
    expect(w.lastHeaders['content-type']).toBe('application/x-tar');
    expect(w.lastHeaders['x-main']).toBe('tfg.tex');
    const names = [...w.lastTar.keys()].sort();
    expect(names).toContain('tfg.tex');
    expect(names).toContain('1-capitulos/01-introduccion.tex');
    expect(names.some((n) => n.startsWith('figuras/'))).toBe(true);
    for (const bad of ['main.aux', '.oculto.tex', 'build/x.tex', 'fuera.tex', '.gitignore']) expect(names).not.toContain(bad);
    // in-root symlink is sent as a regular file; no links at all in the tar
    expect(w.lastTar.get('enlace.tex')).toEqual({ type: 'File', content: await fs.readFile(path.join(t.cfg.memoriaDir, 'datos.tex'), 'utf8') });
    expect([...w.lastTar.values()].every((e) => e.type === 'File')).toBe(true);
    expect(w.lastTar.get('tfg.tex')!.content).toBe(await fs.readFile(path.join(t.cfg.memoriaDir, 'tfg.tex'), 'utf8'));
  });

  it('uses the current memoriaDir after a settings change (hot-apply)', async () => {
    const other = path.join(t.dir, 'otra-memoria');
    await fs.mkdir(other);
    await fs.writeFile(path.join(other, 'tesis.tex'), '\\documentclass{article}');
    const put = await t.app.inject({ method: 'PUT', url: '/api/settings', payload: { memoriaDir: other, memoriaMain: 'tesis.tex' } });
    expect(put.statusCode).toBe(200);
    const r = (await t.app.inject({ method: 'POST', url: '/api/compile' })).json();
    expect(r.ok).toBe(true);
    expect(w.lastHeaders['x-main']).toBe('tesis.tex');
    expect([...w.lastTar.keys()]).toEqual(['tesis.tex']);
  });

  it('rejects bad build ids', async () => {
    expect((await t.app.inject({ url: '/api/pdf/..%2F..%2Fsecret.pdf' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/api/compile/log/..' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/api/pdf/nope.pdf' })).statusCode).toBe(404);
  });
});

describe('compile with worker down', () => {
  it('returns ok:false with a clear diagnostic and keeps last good pdf', async () => {
    const down = await setup({ WORKER_URL: 'http://127.0.0.1:1' });
    try {
      const r = (await down.app.inject({ method: 'POST', url: '/api/compile' })).json();
      expect(r.ok).toBe(false);
      expect(r.pdfUrl).toBeNull();
      expect(r.diagnostics).toEqual([{ severity: 'error', file: 'tfg.tex', line: null, message: 'Worker de compilación no disponible' }]);
      expect(r.sourceRev).toMatch(/^[0-9a-f]{16}$/);
      expect((await down.app.inject({ url: '/api/compile/last' })).json()).toEqual(r);
    } finally {
      await down.close();
    }
  });
});
