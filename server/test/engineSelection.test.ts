import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.ts';
import { createEngine } from '../src/engine/index.ts';

const local = vi.hoisted(() => ({ health: vi.fn(), compile: vi.fn(), svg2pdf: vi.fn(), type: 'local' as const }));
vi.mock('../src/engine/local.ts', () => ({ localEngine: () => local }));
const cfg = { workerUrl: 'http://worker-ficticio.invalid', compileEngine: 'auto' } as Config;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

it('automático prefiere Docker disponible sin lanzar detección local', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
  expect((await createEngine(cfg)).type).toBe('docker');
  expect(local.health).not.toHaveBeenCalled();
});

it('automático selecciona local cuando Docker no responde', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Worker ficticio ausente'); }));
  expect(await createEngine(cfg)).toBe(local);
});

it('la selección explícita respeta el motor sin consultar otro', async () => {
  vi.stubGlobal('fetch', vi.fn());
  expect(await createEngine({ ...cfg, compileEngine: 'local' })).toBe(local);
  expect((await createEngine({ ...cfg, compileEngine: 'docker' })).type).toBe('docker');
  expect(fetch).not.toHaveBeenCalled();
  expect(local.health).not.toHaveBeenCalled();
});

it('un fallo de compilación Docker no repite las fuentes con el motor local', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url) => String(url).endsWith('/health')
    ? Response.json({ ok: true }) : Response.json({ error: 'Error ficticio' }, { status: 500 })));
  const engine = await createEngine(cfg);
  await expect(engine.compile(Readable.from([]), 'main.tex')).rejects.toThrow('Error ficticio');
  expect(local.compile).not.toHaveBeenCalled();
});
