import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { generarPortadas, PORTADAS_REL, validarPortadas } from '../src/portadas.ts';
import { portadasIniciales } from '../../shared/portadas.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv | null = null;
afterEach(async () => { await t?.close(); t = null; });
async function boot() {
  t = await setup();
  const dir = path.join(t.cfg.memoriaDir, 'estilo');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(t.cfg.memoriaDir, PORTADAS_REL), generarPortadas(portadasIniciales()));
  return t;
}

it('genera portadas por zonas con texto escapado y datos dinámicos', () => {
  const cfg = portadasIniciales();
  cfg.exterior = [
    { id: 'texto', tipo: 'texto', zona: 'inferior', texto: 'Curso 2026 & 2027\n\\input{ajeno}' },
    { id: 'titulo', tipo: 'titulo', zona: 'superior' },
  ];
  const src = generarPortadas(cfg);
  expect(src.indexOf('\\dato{titulo}')).toBeLessThan(src.indexOf('Curso 2026 \\&'));
  expect(src).toContain(String.raw`Curso 2026 \& 2027\\\textbackslash{}input\{ajeno\}`);
  expect(src).toContain('\\portadaInteriorPersonalizada');
  expect(src).toContain('\\dato{tutortexto}');
  const reparsed = JSON.parse(src.split('\n')[0].slice('% et:portadas '.length));
  expect(validarPortadas(reparsed)).toEqual(cfg);
});

it('rechaza bloques desconocidos, IDs repetidos, zonas inválidas y texto excesivo', () => {
  for (const block of [
    { tipo: 'titulo', zona: 'central' },
    { id: '../ajeno', tipo: 'titulo', zona: 'central' },
    { id: 'titulo', tipo: 'input', zona: 'central' },
    { id: 'titulo', tipo: 'titulo', zona: 'libre' },
    { id: 'texto', tipo: 'texto', zona: 'central', texto: '' },
    { id: 'texto', tipo: 'texto', zona: 'central', texto: 'a'.repeat(501) },
  ]) expect(() => validarPortadas({ exterior: [block], interior: [] })).toThrow();
  expect(() => validarPortadas({ exterior: [portadasIniciales().exterior[0], portadasIniciales().exterior[0]], interior: [] })).toThrow();
});

it('guarda con revisión, copia al historial y rechaza revisiones antiguas sin sobrescribir', async () => {
  const env = await boot();
  const before = (await env.app.inject('/api/memoria/portadas')).json();
  const config = before.config;
  config.exterior[0].zona = 'inferior';
  const response = await env.app.inject({ method: 'PUT', url: '/api/memoria/portadas', payload: { config, baseRev: before.baseRev } });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().baseRev).not.toBe(before.baseRev);
  expect(response.json().config.exterior[0].zona).toBe('inferior');
  const stale = await env.app.inject({ method: 'PUT', url: '/api/memoria/portadas', payload: { config: portadasIniciales(), baseRev: before.baseRev } });
  expect(stale.statusCode).toBe(409);
  expect((await env.app.inject('/api/memoria/portadas')).json().config).toEqual(config);
  expect((await fs.readdir(env.cfg.historyDir)).length).toBeGreaterThan(0);
  expect((await env.app.inject({ method: 'PUT', url: '/api/memoria/portadas', payload: { config } })).statusCode).toBe(400);
});

it('conserva las ediciones de código y no crea composición al abrir una memoria ajena', async () => {
  const env = await boot();
  const file = path.join(env.cfg.memoriaDir, PORTADAS_REL);
  const before = (await env.app.inject('/api/memoria/portadas')).json();
  await fs.appendFile(file, '% Cambio manual que se debe conservar.\n');
  expect((await env.app.inject('/api/memoria/portadas')).statusCode).toBe(409);
  expect((await env.app.inject({ method: 'PUT', url: '/api/memoria/portadas', payload: before })).statusCode).toBe(409);
  expect(await fs.readFile(file, 'utf8')).toContain('Cambio manual que se debe conservar.');
  await fs.rm(file);
  expect((await env.app.inject('/api/memoria/portadas')).statusCode).toBe(404);
});
