import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nameKey, makeResolver } from '../src/notes.ts';
import { noteLinkCtx, rewriteNote } from '../src/links.ts';
import { foldSimple } from '../src/search.ts';
import { fold as webFold } from '../../web/src/lib/search.ts';
import { score } from '../../web/src/lib/quickOpen.ts';
import { workerDiagnosticRel } from '../src/outline.ts';
import { atomicWrite } from '../src/fsutil.ts';
import { moveEntry } from '../src/fileops.ts';
import { gitPlatformArgs } from '../../scripts/memoria-template.mjs';
import { canSymlink, setup, type TestEnv } from './helpers.ts';

let env: TestEnv | null = null;
afterEach(async () => { vi.restoreAllMocks(); await env?.close(); env = null; });
const nfc = 'Diagnóstico';
const nfd = nfc.normalize('NFD');

describe('Unicode: compara nombres y conserva las rutas reales', () => {
  it('resuelve nombres NFC/NFD exactos, relativos y con sufijo', () => {
    const files = [`Carpeta/${nfd}.md`, `Adjuntos/${nfd}.pdf`];
    const resolve = makeResolver(files);
    expect(nameKey(nfc)).toBe(nameKey(nfd));
    for (const dest of [nfc, `Carpeta/${nfc}`, `CARPETA/${nfc.toUpperCase()}`]) expect(resolve(dest)).toBe(files[0]);
    expect(resolve(`${nfc}.md`, 'Carpeta/Origen.md')).toBe(files[0]);
    expect(resolve(`Adjuntos/${nfc}.pdf`)).toBe(files[1]);
  });
  it('reescribe wikilinks, Markdown y attachment NFC que apuntan a nombres NFD', () => {
    const old = `Carpeta/${nfd}.md`;
    const target = `Nueva/${nfd}.md`;
    const attachment = `Adjuntos/${nfd}.pdf`;
    const movedAttachment = `Nueva/${nfd}.pdf`;
    const ctx = noteLinkCtx({ map: new Map([[old, target], [attachment, movedAttachment]]), preFiles: [old, attachment, 'Origen.md'], postFiles: [target, movedAttachment, 'Origen.md'] });
    const src = `---\nattachment: ${attachment.normalize('NFC')}\n---\n[[Carpeta/${nfc}]] y [nota](Carpeta/${nfc}.md).\n`;
    const out = rewriteNote(src, 'Origen.md', 'Origen.md', ctx);
    expect(out).toContain(`[[Nueva/${nfd}]]`);
    expect(out).toContain(`(Nueva/${nfd}.md)`);
    expect(out).toContain(`attachment: ${movedAttachment}`);
  });
  it('búsqueda y la comparación usada por QuickOpen ya aceptan ambas formas', async () => {
    for (const fold of [foldSimple, webFold]) expect(fold(nfc)).toBe(fold(nfd));
    expect(score(`${nfd}.md`, webFold(nfc))).toBe(score(`${nfc}.md`, webFold(nfd)));
    env = await setup();
    await fs.writeFile(path.join(env.cfg.notesDir, `${nfd}.md`), '# Nota ficticia\n');
    const actual = (await fs.readdir(env.cfg.notesDir)).find((f) => f.normalize('NFC') === `${nfc}.md`)!;
    for (const q of [nfc, nfd]) {
      const res = await env.app.inject({ url: `/api/search?root=notes&q=${encodeURIComponent(q)}` });
      expect(res.json().items).toContainEqual({ root: 'notes', path: actual, line: 1, snippet: actual });
    }
  });
});

describe('rutas, permisos e identidades', () => {
  it('interpreta las rutas POSIX del worker sin usar path del host', () => {
    vi.spyOn(path.win32, 'isAbsolute').mockReturnValue(false);
    vi.spyOn(path.win32, 'relative').mockImplementation(() => { throw new Error('No usar rutas del host'); });
    expect(workerDiagnosticRel('/tmp/memoria/1-capitulos/intro.tex', '/tmp/memoria')).toBe('1-capitulos/intro.tex');
    expect(workerDiagnosticRel('./1-capitulos/intro.tex', 'C:\\Memoria')).toBe('1-capitulos/intro.tex');
    expect(workerDiagnosticRel('/usr/share/texlive/tex.cls', '/tmp/memoria')).not.toBe('tex.cls');
  });
  it.each(['win32', 'darwin'])('temporal en %s: no hereda solo lectura en Windows', async (platform) => {
    env = await setup();
    const abs = path.join(env.cfg.notesDir, 'modo.md'); await fs.writeFile(abs, 'antes');
    const stat = fs.stat.bind(fs);
    vi.spyOn(fs, 'stat').mockImplementation(async (...args: any[]) => Object.assign(await (stat as any)(...args), { mode: 0o444 }));
    const open = vi.spyOn(fs, 'open');
    vi.spyOn(os, 'platform').mockReturnValue(platform as any);
    await atomicWrite(abs, 'después');
    expect(open.mock.calls[0][2]).toBe(platform === 'win32' ? 0o644 : 0o444);
    expect(await fs.readFile(abs, 'utf8')).toBe('después');
  });
  it('índices de 64 bits distintos no se confunden al renombrar solo mayúsculas', async () => {
    env = await setup();
    const src = path.join(env.cfg.notesDir, 'caso.md');
    const dst = path.join(env.cfg.notesDir, 'CASO.md');
    await fs.writeFile(src, 'origen');
    const real = fs.lstat.bind(fs);
    const a = 2n ** 53n;
    vi.spyOn(fs, 'lstat').mockImplementation(async (p: any, opts: any) => {
      if (String(p) === dst) return Object.assign(await real(src, { bigint: true }), { ino: a + 1n });
      const st = await (real as any)(p, opts);
      if (String(p) === src) st.ino = a;
      return st;
    });
    const rename = vi.spyOn(fs, 'rename');
    const res = await env.app.inject({ method: 'POST', url: '/api/move', payload: { root: 'notes', from: 'caso.md', to: 'CASO.md', updateLinks: false } });
    expect(res.statusCode).toBe(409);
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readFile(src, 'utf8')).toBe('origen');
  });
  it('rollback conserva un destino sustituido con otro índice de 64 bits', async () => {
    env = await setup();
    const src = path.join(env.cfg.notesDir, 'origen.md'); const dst = path.join(env.cfg.notesDir, 'destino.md');
    await fs.writeFile(src, 'contenido');
    const st = await fs.lstat(src, { bigint: true }); st.ino = 2n ** 53n;
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(async (p: any, opts: any) => Object.assign(await (lstat as any)(p, opts), { ino: st.ino + 1n }));
    const unlink = vi.spyOn(fs, 'unlink').mockRejectedValue(Object.assign(new Error('bloqueado'), { code: 'EACCES' }));
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    await expect(moveEntry(src, dst, st)).rejects.toMatchObject({ statusCode: 423 });
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(src, 'utf8')).toBe('contenido');
    expect(await fs.readFile(dst, 'utf8')).toBe('contenido');
  });
  it('Git habilita rutas largas solo para Windows y solo en la llamada', () => {
    expect(gitPlatformArgs('win32')).toEqual(['-c', 'core.longpaths=true']);
    expect(gitPlatformArgs('darwin')).toEqual([]);
    expect(gitPlatformArgs('linux')).toEqual([]);
  });
  it('las capacidades de enlace se detectan y recuerdan por tipo', async () => {
    const dir = await canSymlink('dir');
    expect(typeof dir).toBe('boolean');
    expect(await canSymlink('dir')).toBe(dir);
    expect(typeof await canSymlink()).toBe('boolean');
  });
});
