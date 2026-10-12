import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEngine } from '../src/engine/index.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { vi.unstubAllGlobals(); await t.close(); });

it('el estado describe el motor y conserva worker para clientes anteriores', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, version: 'TeX ficticio', capacidades: { svg2pdf: false } })));
  const status = (await t.app.inject('/api/status')).json();
  expect(status.worker).toBe('up');
  expect(status.motor).toEqual({ tipo: 'docker', estado: 'up', version: 'TeX ficticio', capacidades: { compile: true, svg2pdf: false } });
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
  const result = await createEngine(t.cfg).compile(Readable.from([Buffer.from('Fuentes ficticias')]), 'capitulos/primer apartado.tex');
  expect(received).toBe('Fuentes ficticias');
  expect(result).toMatchObject({ ok: true, buildId: 'build-ficticio', durationMs: 12, pdf: 'build-ficticio/main.pdf' });
  expect(result.diagnostics).toEqual([
    { severity: 'warning', file: 'capitulo.tex', line: 4, message: 'Aviso ficticio' },
    { severity: 'error', file: '', line: null, message: '' },
  ]);
});

it('la interfaz mantiene errores del worker y valida la salida PDF de los diagramas', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Ocupado' }, { status: 503 })));
  await expect(createEngine(t.cfg).compile(Readable.from([]), 'main.tex')).rejects.toThrow('Error del worker (HTTP 503): Ocupado');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('No es un PDF')));
  await expect(createEngine(t.cfg).svg2pdf('<svg/>')).rejects.toThrow('El worker no devolvió un PDF');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No disponible'); }));
  expect(await createEngine(t.cfg).health()).toMatchObject({ ok: false, capabilities: { compile: false, svg2pdf: false } });
});
