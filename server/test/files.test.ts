import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rev } from '../src/fsutil.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => t.close());

const ARQ = 'Sistema/Arquitectura.md';

async function get(root: string, p: string) {
  return t.app.inject({ url: `/api/file?root=${root}&path=${encodeURIComponent(p)}` });
}

describe('GET /api/file', () => {
  it('returns content, rev (sha256/16) and mtime', async () => {
    const res = await get('notes', ARQ);
    expect(res.statusCode).toBe(200);
    const b = res.json();
    const disk = await fs.readFile(path.join(t.cfg.notesDir, ARQ));
    expect(b).toMatchObject({ root: 'notes', path: ARQ, content: disk.toString('utf8') });
    expect(b.rev).toBe(rev(disk));
    expect(b.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof b.mtime).toBe('number');
  });

  it('memoria .tex works; non-text is 415; missing is 404', async () => {
    expect((await get('memoria', 'tfg.tex')).statusCode).toBe(200);
    await fs.writeFile(path.join(t.cfg.notesDir, 'img.png'), Buffer.from([0x89, 0x50]));
    const r415 = await get('notes', 'img.png');
    expect(r415.statusCode).toBe(415);
    expect(r415.json().error).toBeTruthy();
    expect((await get('notes', 'nope.md')).statusCode).toBe(404);
  });
});

describe('PUT /api/file', () => {
  it('saves with matching baseRev, atomically, and backs up the previous version', async () => {
    const before = (await get('notes', ARQ)).json();
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/file',
      payload: { root: 'notes', path: ARQ, content: 'nuevo contenido\n', baseRev: before.rev },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rev).toBe(rev('nuevo contenido\n'));
    expect(await fs.readFile(path.join(t.cfg.notesDir, ARQ), 'utf8')).toBe('nuevo contenido\n');
    // no temp files left behind
    const left = await fs.readdir(path.join(t.cfg.notesDir, 'Sistema'));
    expect(left.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // backup in BUILD_DIR/../history/notes/<path>/<ts>.bak
    const histDir = path.join(path.dirname(t.cfg.buildDir), 'history', 'notes', 'Sistema', 'Arquitectura.md');
    const baks = await fs.readdir(histDir);
    expect(baks).toHaveLength(1);
    expect(baks[0]).toMatch(/\.bak$/);
    expect(await fs.readFile(path.join(histDir, baks[0]), 'utf8')).toBe(before.content);
  });

  it('409 with current content and rev when disk changed; does not write', async () => {
    const before = (await get('notes', ARQ)).json();
    const abs = path.join(t.cfg.notesDir, ARQ);
    await fs.writeFile(abs, 'cambiado por Syncthing\n');
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/file',
      payload: { root: 'notes', path: ARQ, content: 'mi versión', baseRev: before.rev },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'conflict', content: 'cambiado por Syncthing\n', rev: rev('cambiado por Syncthing\n') });
    expect(await fs.readFile(abs, 'utf8')).toBe('cambiado por Syncthing\n');
  });

  it('requires baseRev; 404 for missing file', async () => {
    const r1 = await t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'notes', path: ARQ, content: 'x' } });
    expect(r1.statusCode).toBe(400);
    const r2 = await t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'notes', path: 'no.md', content: 'x', baseRev: 'abc' } });
    expect(r2.statusCode).toBe(404);
  });

  it('keeps only the last 20 backups', async () => {
    let cur = (await get('notes', ARQ)).json().rev;
    for (let i = 0; i < 23; i++) {
      const res = await t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'notes', path: ARQ, content: `v${i}`, baseRev: cur } });
      expect(res.statusCode).toBe(200);
      cur = res.json().rev;
    }
    const histDir = path.join(t.cfg.historyDir, 'notes', 'Sistema', 'Arquitectura.md');
    const baks = (await fs.readdir(histDir)).sort();
    expect(baks).toHaveLength(20);
    expect(await fs.readFile(path.join(histDir, baks[19]), 'utf8')).toBe('v21');
  });

  it('serialises concurrent saves with the same baseRev: one wins, the other gets 409', async () => {
    const base = (await get('notes', ARQ)).json().rev;
    const [a, b] = await Promise.all(
      ['A', 'B'].map((c) => t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'notes', path: ARQ, content: c, baseRev: base } })),
    );
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });
});

describe('POST /api/file', () => {
  it('creates with intermediate folders and never overwrites', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'memoria', path: 'capitulos/nuevo/cap1.tex', content: '\\chapter{Uno}\n' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().rev).toBe(rev('\\chapter{Uno}\n'));
    expect(await fs.readFile(path.join(t.cfg.memoriaDir, 'capitulos/nuevo/cap1.tex'), 'utf8')).toBe('\\chapter{Uno}\n');

    const again = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'memoria', path: 'capitulos/nuevo/cap1.tex', content: 'otro' } });
    expect(again.statusCode).toBe(409);
    expect(await fs.readFile(path.join(t.cfg.memoriaDir, 'capitulos/nuevo/cap1.tex'), 'utf8')).toBe('\\chapter{Uno}\n');

    const existing = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: ARQ, content: '' } });
    expect(existing.statusCode).toBe(409);
  });

  it('rejects non-text extensions with 415', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: 'a.exe', content: '' } });
    expect(res.statusCode).toBe(415);
  });
});

describe('GET /api/raw', () => {
  it('serves binary with content-type', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);
    await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema', 'diagrama.png'), bytes);
    const res = await t.app.inject({ url: '/api/raw?root=notes&path=Sistema/diagrama.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.equals(bytes)).toBe(true);
    const pdf = await t.app.inject({ url: '/api/raw?root=notes&path=nada.pdf' });
    expect(pdf.statusCode).toBe(404);
  });
});
