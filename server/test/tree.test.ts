import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isIgnoredName, isIgnoredRel } from '../src/ignore.ts';
import { flatPaths, setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => t.close());

describe('ignore rules', () => {
  it('unit', () => {
    expect(isIgnoredName('.obsidian', 'notes', true)).toBe(true);
    expect(isIgnoredName('a.md.lock', 'notes', false)).toBe(true);
    expect(isIgnoredName('x.sync-conflict-20260930-134509-2SOC3CR.md', 'notes', false)).toBe(true);
    expect(isIgnoredName('node_modules', 'notes', true)).toBe(true);
    expect(isIgnoredName('main.aux', 'memoria', false)).toBe(true);
    expect(isIgnoredName('main.synctex.gz', 'memoria', false)).toBe(true);
    expect(isIgnoredName('main.fdb_latexmk', 'memoria', false)).toBe(true);
    expect(isIgnoredName('build', 'memoria', true)).toBe(true);
    expect(isIgnoredName('main.log', 'notes', false)).toBe(false);
    expect(isIgnoredName('build', 'notes', true)).toBe(false);
    expect(isIgnoredName('main.tex', 'memoria', false)).toBe(false);
    expect(isIgnoredRel('build/main.pdf', 'memoria')).toBe(true);
    expect(isIgnoredRel('a/.git/config', 'notes')).toBe(true);
  });
});

describe('GET /api/tree', () => {
  it('notes: hides .lock, sync-conflicts and dotfiles; dirs first', async () => {
    const res = await t.app.inject({ url: '/api/tree?root=notes' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.root).toBe('notes');
    const all = flatPaths(body.entries);
    expect(all).toContain('Sistema/Arquitectura.md');
    expect(all).toContain('Roadmap/TFG — hitos y memoria.md');
    expect(all).toContain('Recursos');
    expect(all.some((p) => p.endsWith('.lock'))).toBe(false);
    expect(all.some((p) => p.includes('sync-conflict'))).toBe(false);
    expect(all.some((p) => p.split('/').some((s) => s.startsWith('.')))).toBe(false);
    expect(body.entries.map((e: any) => e.name)).toEqual(['Recursos', 'Roadmap', 'Sistema']);
    const sistema = body.entries.find((e: any) => e.name === 'Sistema');
    expect(sistema.type).toBe('dir');
    expect(sistema.children[0]).toEqual({ path: 'Sistema/Arquitectura.md', name: 'Arquitectura.md', type: 'file' });
  });

  it('memoria: hides LaTeX aux, build/, node_modules, dotfiles', async () => {
    const m = t.cfg.memoriaDir;
    for (const f of ['main.aux', 'main.log', 'main.toc', 'main.synctex.gz', 'main.fdb_latexmk', 'main.bbl', 'main.out']) {
      await fs.writeFile(path.join(m, f), 'x');
    }
    await fs.mkdir(path.join(m, 'build'));
    await fs.writeFile(path.join(m, 'build', 'main.pdf'), 'x');
    await fs.mkdir(path.join(m, 'node_modules'));
    await fs.writeFile(path.join(m, 'chapter.tex.lock'), '');
    const res = await t.app.inject({ url: '/api/tree?root=memoria' });
    const all = flatPaths(res.json().entries);
    expect(all).toContain('tfg.tex');
    expect(all).toContain('bibliografia.bib');
    expect(all).toContain('estilo/memoria.cls');
    expect(all).toContain('estilo/institucion.tex');
    for (const bad of ['main.aux', 'main.log', 'main.toc', 'main.synctex.gz', 'main.fdb_latexmk', 'main.bbl', 'main.out', 'build', 'node_modules', '.gitignore', 'chapter.tex.lock']) {
      expect(all).not.toContain(bad);
    }
    // folders first
    const top = res.json().entries;
    const firstFile = top.findIndex((e: any) => e.type === 'file');
    expect(top.slice(firstFile).every((e: any) => e.type === 'file')).toBe(true);
  });

  it('sorts alphabetically with Spanish collation', async () => {
    for (const n of ['zeta.md', 'Ñandú.md', 'nube.md', 'árbol.md', 'Beta.md']) {
      await fs.writeFile(path.join(t.cfg.notesDir, n), '');
    }
    const res = await t.app.inject({ url: '/api/tree?root=notes' });
    const files = res.json().entries.filter((e: any) => e.type === 'file').map((e: any) => e.name);
    expect(files).toEqual(['árbol.md', 'Beta.md', 'nube.md', 'Ñandú.md', 'zeta.md']);
  });

  it('rejects unknown root', async () => {
    const res = await t.app.inject({ url: '/api/tree?root=etc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });
});

describe('GET /api/status', () => {
  it('reports config, sync conflicts and worker down', async () => {
    const res = await t.app.inject({ url: '/api/status' });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.notesDir).toBe(t.cfg.notesDir);
    expect(s.memoriaDir).toBe(t.cfg.memoriaDir);
    expect(s.memoriaMain).toBe('tfg.tex');
    expect(s.resourcesSubdir).toBe('Recursos');
    expect(s.syncConflicts).toEqual(['notes/Sistema/x.sync-conflict-20260930-134509-2SOC3CR.md']);
    expect(s.worker).toBe('down');
  });
});
