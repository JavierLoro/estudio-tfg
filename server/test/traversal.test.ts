import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeRel } from '../src/paths.ts';
import { canSymlink, flatPaths, setup, type TestEnv } from './helpers.ts';

const supportsFileSymlink = await canSymlink();
const supportsDirSymlink = await canSymlink('dir');

let t: TestEnv;
let outside: string;
beforeEach(async () => {
  t = await setup();
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-outside-'));
  await fs.writeFile(path.join(outside, 'secret.md'), 'SECRETO');
  await fs.mkdir(path.join(outside, 'dir'));
});
afterEach(async () => {
  await t.close();
  await fs.rm(outside, { recursive: true, force: true });
});

const BAD = ['../secret.md', 'Sistema/../../x.md', '/etc/passwd', '..', 'a/../../b.md', 'C:/x.md', 'a\\..\\b.md', 'x\0.md'];

describe('path traversal protection', () => {
  it('normalizeRel rejects .., absolute, backslashes, NUL', () => {
    for (const p of BAD) expect(() => normalizeRel(p), p).toThrow();
    expect(normalizeRel('./Sistema//Arquitectura.md')).toBe('Sistema/Arquitectura.md');
  });

  it('GET/PUT/POST/raw reject bad paths with 400', async () => {
    for (const p of BAD) {
      const q = encodeURIComponent(p);
      expect((await t.app.inject({ url: `/api/file?root=notes&path=${q}` })).statusCode, p).toBe(400);
      expect((await t.app.inject({ url: `/api/raw?root=notes&path=${q}` })).statusCode, p).toBe(400);
      expect((await t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'notes', path: p, content: 'x', baseRev: 'x' } })).statusCode, p).toBe(400);
      expect((await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: p, content: 'x' } })).statusCode, p).toBe(400);
    }
    // nothing was written outside
    expect(await fs.readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('SECRETO');
  });

  it.skipIf(!supportsFileSymlink || !supportsDirSymlink)('rejects symlinks that escape the root (file and directory)', async () => {
    await fs.symlink(path.join(outside, 'secret.md'), path.join(t.cfg.notesDir, 'link.md'));
    await fs.symlink(path.join(outside, 'dir'), path.join(t.cfg.notesDir, 'linkdir'), process.platform === 'win32' ? 'junction' : 'dir');

    expect((await t.app.inject({ url: '/api/file?root=notes&path=link.md' })).statusCode).toBe(400);
    expect((await t.app.inject({ url: '/api/raw?root=notes&path=link.md' })).statusCode).toBe(400);
    const put = await t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'notes', path: 'link.md', content: 'pwn', baseRev: 'x' } });
    expect(put.statusCode).toBe(400);
    const post = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: 'linkdir/new.md', content: 'pwn' } });
    expect(post.statusCode).toBe(400);
    const post2 = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: 'linkdir/sub/new.md', content: 'pwn' } });
    expect(post2.statusCode).toBe(400);
    expect(await fs.readdir(path.join(outside, 'dir'))).toEqual([]);
    expect(await fs.readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('SECRETO');

    // and they are not listed in the tree
    const all = flatPaths((await t.app.inject({ url: '/api/tree?root=notes' })).json().entries);
    expect(all).not.toContain('link.md');
    expect(all).not.toContain('linkdir');
  });

  it.skipIf(!supportsFileSymlink)('allows symlinks that stay inside the root', async () => {
    await fs.symlink(path.join(t.cfg.notesDir, 'Sistema', 'Arquitectura.md'), path.join(t.cfg.notesDir, 'alias.md'));
    const res = await t.app.inject({ url: '/api/file?root=notes&path=alias.md' });
    expect(res.statusCode).toBe(200);
  });
});
