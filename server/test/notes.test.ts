import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWikilink } from '../src/notes.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => t.close());

const resolve = (target: string) => t.app.inject({ url: `/api/notes/resolve?target=${encodeURIComponent(target)}` });

describe('GET /api/notes/resolve', () => {
  it('resolves exact paths with or without .md', async () => {
    expect((await resolve('Sistema/Arquitectura')).json()).toEqual({ path: 'Sistema/Arquitectura.md' });
    expect((await resolve('Sistema/Arquitectura.md')).json()).toEqual({ path: 'Sistema/Arquitectura.md' });
  });

  it('resolves by file name anywhere, case-insensitive, with alias/heading', async () => {
    expect((await resolve('Arquitectura')).json().path).toBe('Sistema/Arquitectura.md');
    expect((await resolve('arquitectura')).json().path).toBe('Sistema/Arquitectura.md');
    expect((await resolve('TFG — hitos y memoria')).json().path).toBe('Roadmap/TFG — hitos y memoria.md');
    expect((await resolve('[[Arquitectura#Sección|alias]]')).json().path).toBe('Sistema/Arquitectura.md');
  });

  it('404 when not found, 400 without target', async () => {
    const r = await resolve('PLAN-ROADMAP');
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBeTruthy();
    expect((await t.app.inject({ url: '/api/notes/resolve' })).statusCode).toBe(400);
  });

  it('prefers exact path over name match, shortest path on ties', () => {
    const files = ['a/Nota.md', 'Nota.md', 'b/c/nota.md', 'img/foto.png'];
    expect(resolveWikilink('Nota', files)).toBe('Nota.md');
    expect(resolveWikilink('c/nota', files)).toBe('b/c/nota.md');
    expect(resolveWikilink('foto.png', files)).toBe('img/foto.png');
    expect(resolveWikilink('a/Nota', files)).toBe('a/Nota.md');
  });

  it('ignores sync-conflict and lock files', async () => {
    expect((await resolve('x.sync-conflict-20260930-134509-2SOC3CR')).statusCode).toBe(404);
  });
});

describe('GET /api/notes/backlinks', () => {
  it('finds notes linking via wikilinks (path and name forms)', async () => {
    const r1 = await t.app.inject({ url: `/api/notes/backlinks?path=${encodeURIComponent('Sistema/Arquitectura.md')}` });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().items).toEqual([
      { path: 'Roadmap/TFG — hitos y memoria.md', title: 'TFG — hitos y memoria', snippet: 'Ver [[Sistema/Arquitectura]] y [[PLAN-ROADMAP|el roadmap]].' },
    ]);
    const r2 = await t.app.inject({ url: `/api/notes/backlinks?path=${encodeURIComponent('Roadmap/TFG — hitos y memoria.md')}` });
    expect(r2.json().items).toEqual([
      { path: 'Sistema/Arquitectura.md', title: 'Arquitectura', snippet: 'Nota de prueba con **negrita** y un enlace a [[TFG — hitos y memoria]].' },
    ]);
  });

  it('includes markdown links and uses heading/filename as title fallback', async () => {
    await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema', 'otra.md'), '# Otra nota\n\nVer [arq](Arquitectura.md).\n');
    await fs.writeFile(path.join(t.cfg.notesDir, 'sin-titulo.md'), 'enlace ![[arquitectura]]\n');
    const r = await t.app.inject({ url: `/api/notes/backlinks?path=${encodeURIComponent('Sistema/Arquitectura.md')}` });
    const items = r.json().items;
    expect(items.map((i: any) => [i.path, i.title])).toEqual(
      expect.arrayContaining([
        ['Sistema/otra.md', 'Otra nota'],
        ['sin-titulo.md', 'sin-titulo'],
        ['Roadmap/TFG — hitos y memoria.md', 'TFG — hitos y memoria'],
      ]),
    );
    expect(items).toHaveLength(3);
  });

  it('rejects traversal', async () => {
    expect((await t.app.inject({ url: '/api/notes/backlinks?path=../x.md' })).statusCode).toBe(400);
  });
});
