import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMeta, withMeta } from '../src/diagramas.ts';
import { rev } from '../src/fsutil.ts';
import { setup, type TestEnv } from './helpers.ts';

interface FakeWorker {
  url: string;
  server: http.Server;
  calls: number;
  lastBody: string;
  lastType: string;
  mode: 'ok' | 'bad' | 'notpdf';
}

/** Worker falso: POST /svg2pdf devuelve un «PDF» con el tamaño del SVG recibido. */
async function fakeWorker(): Promise<FakeWorker> {
  const f: FakeWorker = { url: '', server: null as any, calls: 0, lastBody: '', lastType: '', mode: 'ok' };
  f.server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/svg2pdf') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      f.calls++;
      f.lastBody = Buffer.concat(chunks).toString('utf8');
      f.lastType = String(req.headers['content-type']);
      if (f.mode === 'bad') {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ error: 'Referencia externa no permitida' }));
      }
      res.setHeader('content-type', 'application/pdf');
      return res.end(f.mode === 'notpdf' ? 'hola' : `%PDF-1.5 svg de ${f.lastBody.length} bytes`);
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', r));
  f.url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  return f;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 100 40"><text x="5" y="20">Hola &amp; adiós</text></svg>';
const SRC = 'flowchart TD\n  A[Inicio] --> B[Fin]\n';

describe('diagramas', () => {
  let env: TestEnv;
  let worker: FakeWorker;

  beforeEach(async () => {
    worker = await fakeWorker();
    env = await setup({ WORKER_URL: worker.url });
    await fs.mkdir(path.join(env.cfg.memoriaDir, 'diagramas'), { recursive: true });
    await fs.writeFile(path.join(env.cfg.memoriaDir, 'diagramas', 'flujo.mmd'), SRC);
  });
  afterEach(async () => {
    await env.close();
    await new Promise((r) => worker.server.close(r));
  });

  const exportar = (body: Record<string, unknown>) => env.app.inject({ method: 'POST', url: '/api/diagramas/exportar', payload: body });
  const estado = (p: string) => env.app.inject({ method: 'GET', url: `/api/diagramas/estado?path=${encodeURIComponent(p)}` });
  const fig = (name: string) => path.join(env.cfg.memoriaDir, 'figuras', 'diagramas', name);

  it('withMeta/readMeta: registro en <metadata> que sobrevive a caracteres especiales y se sustituye', () => {
    const meta = { fuente: 'diagramas/a & <b>.mmd', rev: 'abc', exportadoEn: '2026-10-06T10:00:00.000Z' };
    const out = withMeta(SVG, meta);
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 100 40"><metadata id="estudio-tfg-diagrama">')).toBe(true);
    expect(readMeta(out)).toEqual(meta);
    const again = withMeta(out, { ...meta, rev: 'def' });
    expect(again.match(/<metadata/g)).toHaveLength(1);
    expect(readMeta(again)?.rev).toBe('def');
    expect(readMeta(SVG)).toBeNull();
  });

  it('sin exportar → exportar escribe PDF y SVG con el registro → exportado → desactualizado al cambiar la fuente', async () => {
    let res = await estado('diagramas/flujo.mmd');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ estado: 'sin-exportar', pdf: null, svg: null, exportadoEn: null });

    res = await exportar({ path: 'diagramas/flujo.mmd', svg: SVG, rev: rev(SRC) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pdf).toBe('figuras/diagramas/flujo.pdf');
    expect(body.svg).toBe('figuras/diagramas/flujo.svg');
    expect(Number.isNaN(Date.parse(body.exportadoEn))).toBe(false);
    // El worker recibe el SVG (ya con el registro) como image/svg+xml.
    expect(worker.lastType).toBe('image/svg+xml');
    expect(readMeta(worker.lastBody)?.rev).toBe(rev(SRC));
    expect((await fs.readFile(fig('flujo.pdf'), 'utf8')).startsWith('%PDF-')).toBe(true);
    const saved = await fs.readFile(fig('flujo.svg'), 'utf8');
    expect(readMeta(saved)).toEqual({ fuente: 'diagramas/flujo.mmd', rev: rev(SRC), exportadoEn: body.exportadoEn });

    res = await estado('diagramas/flujo.mmd');
    expect(res.json()).toEqual({ estado: 'exportado', pdf: 'figuras/diagramas/flujo.pdf', svg: 'figuras/diagramas/flujo.svg', exportadoEn: body.exportadoEn });

    await fs.writeFile(path.join(env.cfg.memoriaDir, 'diagramas', 'flujo.mmd'), SRC + '  B --> C\n');
    res = await estado('diagramas/flujo.mmd');
    expect(res.json().estado).toBe('desactualizado');
    // Cambiar la fuente no toca la figura exportada.
    expect(await fs.readFile(fig('flujo.svg'), 'utf8')).toBe(saved);
  });

  it('409 si la fuente cambió (rev distinto); no escribe nada ni llama al worker', async () => {
    const res = await exportar({ path: 'diagramas/flujo.mmd', svg: SVG, rev: '0000000000000000' });
    expect(res.statusCode).toBe(409);
    expect(res.json().rev).toBe(rev(SRC));
    expect(worker.calls).toBe(0);
    await expect(fs.stat(fig('flujo.pdf'))).rejects.toThrow();
  });

  it('volver a exportar copia la versión anterior al historial', async () => {
    expect((await exportar({ path: 'diagramas/flujo.mmd', svg: SVG, rev: rev(SRC) })).statusCode).toBe(200);
    const src2 = SRC + '  B --> C\n';
    await fs.writeFile(path.join(env.cfg.memoriaDir, 'diagramas', 'flujo.mmd'), src2);
    expect((await exportar({ path: 'diagramas/flujo.mmd', svg: SVG.replace('Hola', 'Adiós'), rev: rev(src2) })).statusCode).toBe(200);
    const hist = await fs.readdir(path.join(env.cfg.historyDir, 'memoria', 'figuras', 'diagramas', 'flujo.svg'));
    expect(hist.filter((f) => f.endsWith('.bak'))).toHaveLength(1);
    expect((await estado('diagramas/flujo.mmd')).json().estado).toBe('exportado');
  });

  it('400: SVG no válido, demasiado grande, con foreignObject, ruta fuera de diagramas/ o rechazado por el worker', async () => {
    const r = rev(SRC);
    const cases: Record<string, unknown>[] = [
      { path: 'diagramas/flujo.mmd', svg: '<html></html>', rev: r },
      { path: 'diagramas/flujo.mmd', svg: '', rev: r },
      { path: 'diagramas/flujo.mmd', svg: SVG.replace('</svg>', `<!--${'x'.repeat(5 * 1024 * 1024)}--></svg>`), rev: r },
      { path: 'diagramas/flujo.mmd', svg: SVG.replace('</svg>', '<foreignObject><div>x</div></foreignObject></svg>'), rev: r },
      { path: 'diagramas/flujo.mmd', svg: SVG },
      { path: 'tfg.tex', svg: SVG, rev: r },
      { path: 'diagramas/../tfg.tex', svg: SVG, rev: r },
    ];
    for (const c of cases) expect((await exportar(c)).statusCode, JSON.stringify(c).slice(0, 80)).toBe(400);
    expect(worker.calls).toBe(0);
    worker.mode = 'bad';
    const res = await exportar({ path: 'diagramas/flujo.mmd', svg: SVG, rev: r });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/externa/);
    worker.mode = 'notpdf';
    expect((await exportar({ path: 'diagramas/flujo.mmd', svg: SVG, rev: r })).statusCode).toBe(502);
    await expect(fs.stat(fig('flujo.pdf'))).rejects.toThrow();
    expect((await estado('diagramas/nada.mmd')).statusCode).toBe(404);
    expect((await estado('tfg.tex')).statusCode).toBe(400);
  });

  it('503 si el worker no está', async () => {
    await new Promise((r) => worker.server.close(r));
    worker.server = http.createServer();
    await new Promise<void>((r) => worker.server.listen(0, '127.0.0.1', r));
    env.cfg.workerUrl = 'http://127.0.0.1:1';
    const res = await exportar({ path: 'diagramas/flujo.mmd', svg: SVG, rev: rev(SRC) });
    expect(res.statusCode).toBe(503);
  });

  it('lista sin path: estado de cada .mmd y dónde se incluye su figura (sin comentarios)', async () => {
    await fs.mkdir(path.join(env.cfg.memoriaDir, 'diagramas', 'sub'), { recursive: true });
    await fs.writeFile(path.join(env.cfg.memoriaDir, 'diagramas', 'sub', 'er.mmd'), 'erDiagram\n');
    await exportar({ path: 'diagramas/flujo.mmd', svg: SVG, rev: rev(SRC) });
    const tex = [
      '\\chapter{Prueba}',
      '\\includegraphics[width=0.8\\textwidth]{diagramas/flujo}',
      '% \\includegraphics{diagramas/sub/er}',
      '\\includegraphics{figuras/diagramas/sub/er.pdf}',
    ].join('\n');
    await fs.writeFile(path.join(env.cfg.memoriaDir, 'prueba.tex'), tex);
    const res = await env.app.inject({ method: 'GET', url: '/api/diagramas/estado' });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as any[];
    expect(items.map((i) => [i.path, i.nombre, i.estado])).toEqual([
      ['diagramas/flujo.mmd', 'diagramas/flujo', 'exportado'],
      ['diagramas/sub/er.mmd', 'diagramas/sub/er', 'sin-exportar'],
    ]);
    expect(items[0].usos).toEqual([{ file: 'prueba.tex', line: 2 }]);
    expect(items[1].usos).toEqual([{ file: 'prueba.tex', line: 4 }]);
  });
});
