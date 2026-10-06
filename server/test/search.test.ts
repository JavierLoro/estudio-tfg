import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fold } from '../src/search.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => t.close());

const s = (q: string, root = 'all') => t.app.inject({ url: `/api/search?q=${encodeURIComponent(q)}&root=${root}` });

describe('GET /api/search', () => {
  it('is case- and accent-insensitive in both directions', async () => {
    await fs.writeFile(path.join(t.cfg.notesDir, 'acentos.md'), 'Línea uno\nla EVALUACIÓN del sistema\nnada\n');
    for (const q of ['evaluacion', 'EVALUACIÓN', 'evaluación', 'EvAlUaCiOn']) {
      const items = (await s(q, 'notes')).json().items;
      expect(items, q).toContainEqual({ root: 'notes', path: 'acentos.md', line: 2, snippet: 'la EVALUACIÓN del sistema' });
    }
    const items = (await s('linea', 'notes')).json().items;
    expect(items).toContainEqual({ root: 'notes', path: 'acentos.md', line: 1, snippet: 'Línea uno' });
  });

  it('matches file names too', async () => {
    const items = (await s('arquitectura', 'notes')).json().items;
    expect(items[0]).toEqual({ root: 'notes', path: 'Sistema/Arquitectura.md', line: 1, snippet: 'Arquitectura.md' });
    expect(items.some((i: any) => i.path === 'Roadmap/TFG — hitos y memoria.md')).toBe(true);
  });

  it('filters by root and ignores sync-conflicts / aux files', async () => {
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'main.log'), 'arquitectura en el log');
    await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema', 'z.sync-conflict-1-2-X.md'), 'arquitectura');
    const mem = (await s('arquitectura', 'memoria')).json().items;
    expect(mem.every((i: any) => i.root === 'memoria')).toBe(true);
    expect(mem.some((i: any) => i.path === 'main.log')).toBe(false);
    const all = (await s('arquitectura')).json().items;
    expect(all.some((i: any) => i.path.includes('sync-conflict'))).toBe(false);
    expect(new Set(all.map((i: any) => i.root)).has('notes')).toBe(true);
  });

  it('caps results at 200 and handles empty query / bad root', async () => {
    await fs.writeFile(path.join(t.cfg.notesDir, 'muchas.md'), Array.from({ length: 500 }, () => 'repetido').join('\n'));
    expect((await s('repetido', 'notes')).json().items).toHaveLength(200);
    expect((await s('')).json().items).toEqual([]);
    expect((await s('x', 'nope')).statusCode).toBe(400);
  });

  it('fold keeps index mapping', () => {
    const f = fold('Ñandú Á');
    expect(f.text).toBe('nandu a');
    expect(f.map[6]).toBe(6);
  });
});
