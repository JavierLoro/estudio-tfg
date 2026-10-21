import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEngine } from '../src/engine/index.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await t.close(); });

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

it.each([
  ['conexión', () => { throw new Error('http://usuario:secreto@worker-interno'); }, 'El servidor no pudo conectar con el servicio de compilación de Docker.'],
  ['tiempo de espera', () => { throw new DOMException('Timeout', 'TimeoutError'); }, 'El servicio de compilación de Docker no respondió en el tiempo de espera (1,5 segundos).'],
  ['error HTTP', () => new Response('Detalle privado', { status: 503 }), 'El servicio de compilación de Docker respondió con un error HTTP 503.'],
  ['JSON no válido', () => new Response('Sin JSON'), 'El servicio de compilación de Docker devolvió una respuesta no válida.'],
  ['estado no válido', () => Response.json({ ok: 'true' }), 'El servicio de compilación de Docker devolvió una respuesta no válida.'],
  ['servicio no listo', () => Response.json({ ok: false }), 'El servicio de compilación de Docker respondió, pero no está listo para compilar.'],
] as const)('el estado explica el fallo de Docker: %s', async (_name, response, message) => {
  vi.stubGlobal('fetch', vi.fn(async () => response()));
  const status = (await t.app.inject('/api/status')).json();
  expect(status.worker).toBe('down');
  expect(status.motor).toMatchObject({ estado: 'down', mensaje: message, capacidades: { compile: false, svg2pdf: false } });
  expect((await t.app.inject('/api/engines')).json().docker.message).toBe(message);
});

it.each(['local', 'auto'] as const)('el estado explica las herramientas ausentes con selección %s', async (selection) => {
  vi.stubEnv('PATH', '');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Sin conexión'); }));
  t.cfg.compileEngine = selection;
  const status = (await t.app.inject('/api/status')).json();
  expect(status.motor).toMatchObject({ seleccion: selection, tipo: 'local', estado: 'down' });
  expect(status.motor.mensaje).toContain('No están disponibles latexmk, biber, pdflatex en PATH');
  if (selection === 'auto') expect(status.motor.mensaje).toContain('El servidor no pudo conectar con el servicio de compilación de Docker.');
  else expect(status.motor.mensaje).not.toContain('El servidor no pudo conectar');
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
