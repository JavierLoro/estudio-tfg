import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEngine } from '../src/engine/index.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { vi.unstubAllGlobals(); await t.close(); });

it('la detección exige administración y no acepta loopback falsificado por cabecera', async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  const denied = await t.app.inject({ url: '/api/engines', remoteAddress: '198.51.100.3', headers: { 'x-forwarded-for': '127.0.0.1' } });
  expect(denied.statusCode).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});

it('el estado describe el motor y conserva worker para clientes anteriores', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, version: 'TeX ficticio', capacidades: { svg2pdf: false } })));
  const status = (await t.app.inject('/api/status')).json();
  expect(status.worker).toBe('up');
  expect(status.motor).toEqual({ seleccion: 'docker', tipo: 'docker', estado: 'up', version: 'TeX ficticio', capacidades: { compile: true, svg2pdf: false } });
});

it('la interfaz Docker transporta las fuentes y normaliza el resultado sin alterar diagnósticos válidos', async () => {
  let received = '';
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    expect(url).toBe(`${t.cfg.workerUrl}/compile`);
    expect(init.headers['x-main']).toBe('capitulos%2Fprimer%20apartado.tex');
    received = await new Response(init.body).text();
    return Response.json({ ok: true, buildId: 'build-ficticio', durationMs: 12, pdf: 'build-ficticio/main.pdf',
      diagnostics: [{ severity: 'warning', file: 'capitulo.tex', line: 4, message: 'Aviso ficticio' }, {}] });
  }));
  const result = await (await createEngine(t.cfg)).compile(Readable.from([Buffer.from('Fuentes ficticias')]), 'capitulos/primer apartado.tex');
  expect(received).toBe('Fuentes ficticias');
  expect(result).toMatchObject({ ok: true, buildId: 'build-ficticio', durationMs: 12, pdf: 'build-ficticio/main.pdf' });
  expect(result.diagnostics).toEqual([
    { severity: 'warning', file: 'capitulo.tex', line: 4, message: 'Aviso ficticio' },
    { severity: 'error', file: '', line: null, message: '' },
  ]);
});

it('la interfaz mantiene errores del worker y valida la salida PDF de los diagramas', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Ocupado' }, { status: 503 })));
  await expect((await createEngine(t.cfg)).compile(Readable.from([]), 'main.tex')).rejects.toThrow('Error del worker (HTTP 503): Ocupado');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('No es un PDF')));
  await expect((await createEngine(t.cfg)).svg2pdf('<svg/>')).rejects.toThrow('El worker no devolvió un PDF');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No disponible'); }));
  expect(await (await createEngine(t.cfg)).health()).toMatchObject({ ok: false, capabilities: { compile: false, svg2pdf: false } });
});

it('el estado no mezcla carpetas o motor nuevos si Ajustes cambia durante health', async () => {
  const previous = { ...t.cfg };
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async () => { started(); await gate; return Response.json({ ok: true }); }));
  const pending = t.app.inject('/api/status');
  await entered;
  const notesDir = path.join(t.dir, 'otras-notas');
  await fs.mkdir(notesDir);
  const changed = await t.app.inject({ method: 'PUT', url: '/api/settings', payload: { notesDir, compileEngine: 'local' } });
  release();
  expect(changed.statusCode).toBe(200);
  const status = (await pending).json();
  expect(status.notesDir).toBe(previous.notesDir);
  expect(status.motor).toMatchObject({ seleccion: 'docker', tipo: 'docker', estado: 'up' });
  expect(t.cfg.compileEngine).toBe('local');
  expect(t.cfg.notesDir).toBe(notesDir);
});
