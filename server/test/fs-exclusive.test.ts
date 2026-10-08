import { canSymlink } from './helpers.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supportsFileSymlink = await canSymlink();

let dir: string;
let util: typeof import('../src/fsutil.ts');
let ops: typeof import('../src/fileops.ts');
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-exclusive-'));
  vi.resetModules();
  util = await import('../src/fsutil.ts');
  ops = await import('../src/fileops.ts');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});
const fail = (code: string) => Object.assign(new Error(code), { code });

describe('creación y movimiento sin enlaces duros', () => {
  it.each(['EPERM', 'EXDEV', 'ENOTSUP', 'EISDIR', 'EINVAL', 'EACCES', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS'])('usa copia exclusiva ante %s y recuerda el volumen', async (code) => {
    const link = vi.spyOn(fs, 'link').mockRejectedValue(fail(code));
    const src = path.join(dir, 'subida.tmp');
    const dst = path.join(dir, 'adjunto.pdf');
    const bytes = Buffer.alloc(200_000, 0xab); // varias lecturas del stream
    await fs.writeFile(src, bytes);
    expect(await util.createExclusive(path.join(dir, 'nota.md'), 'nota')).toBe(true);
    await fs.mkdir(path.join(dir, 'otra'));
    expect(await util.createExclusive(path.join(dir, 'otra', 'capitulo.tex'), 'capítulo')).toBe(true);
    expect(await util.linkExclusive(src, dst)).toBe(true);
    expect(await fs.readFile(dst)).toEqual(bytes);
    expect(await fs.readFile(src)).toEqual(bytes);
    expect(link).toHaveBeenCalledTimes(1);
    expect(await util.createExclusive(path.join(dir, 'nota.md'), 'sobrescribir')).toBe(false);
    expect(await util.linkExclusive(src, dst)).toBe(false);
    expect(await fs.readFile(path.join(dir, 'nota.md'), 'utf8')).toBe('nota');
    const moved = path.join(dir, 'movido.pdf');
    await ops.moveEntry(dst, moved, await fs.stat(dst, { bigint: true }));
    expect(await fs.readFile(moved)).toEqual(bytes);
    await expect(fs.stat(dst)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(link).toHaveBeenCalledTimes(1);
    expect((await fs.readdir(dir)).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('una carrera por el mismo destino tiene un ganador y no mezcla los datos', async () => {
    vi.spyOn(fs, 'link').mockRejectedValue(fail('ENOTSUP'));
    const abs = path.join(dir, 'nota.md');
    const data = ['A'.repeat(200_000), 'B'.repeat(200_000)];
    const results = await Promise.all(data.map((s) => util.createExclusive(abs, s)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await fs.readFile(abs, 'utf8')).toBe(data[results.indexOf(true)]);
    expect(await fs.readdir(dir)).toEqual(['nota.md']);
  });

  it('fsync antes de terminar y limpia una copia incompleta si falla', async () => {
    const src = path.join(dir, 'origen.tmp');
    const dst = path.join(dir, 'destino.md');
    await fs.writeFile(src, 'datos');
    const realOpen = fs.open;
    const sync = vi.fn().mockRejectedValue(fail('EIO'));
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const fh = await realOpen(...args);
      if (args[0] === dst) vi.spyOn(fh, 'sync').mockImplementation(sync);
      return fh;
    });
    await expect(util.copyExclusive(src, dst)).rejects.toMatchObject({ code: 'EIO' });
    expect(sync).toHaveBeenCalledTimes(1);
    await expect(fs.stat(dst)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(src, 'utf8')).toBe('datos');
  });

  it('no borra ni abre para escribir un destino que ya existía', async () => {
    const src = path.join(dir, 'origen.tmp');
    const dst = path.join(dir, 'destino.md');
    await fs.writeFile(src, 'nuevo');
    await fs.writeFile(dst, 'original');
    const unlink = vi.spyOn(fs, 'unlink');
    expect(await util.copyExclusive(src, dst)).toBe(false);
    expect(await fs.readFile(dst, 'utf8')).toBe('original');
    expect(unlink).not.toHaveBeenCalled();
  });

  it.skipIf(!supportsFileSymlink)('la copia alternativa no sigue un origen sustituido por un symlink', async () => {
    const real = path.join(dir, 'fuera.md');
    const src = path.join(dir, 'origen.md');
    const dst = path.join(dir, 'destino.md');
    await fs.writeFile(real, 'datos que no deben copiarse');
    await fs.symlink(real, src);
    await expect(util.copyExclusive(src, dst)).rejects.toMatchObject({ code: 'ELOOP' });
    await expect(fs.stat(dst)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(real, 'utf8')).toBe('datos que no deben copiarse');
  });

  it('un movimiento sin enlaces duros no sobrescribe un destino surgido durante el intento', async () => {
    const src = path.join(dir, 'origen.md');
    const dst = path.join(dir, 'destino.md');
    await fs.writeFile(src, 'origen');
    vi.spyOn(fs, 'link').mockImplementation(async () => {
      await fs.writeFile(dst, 'otro escritor');
      throw fail('EINVAL');
    });
    await expect(ops.moveEntry(src, dst, await fs.stat(src, { bigint: true }))).rejects.toMatchObject({ statusCode: 409 });
    expect(await fs.readFile(src, 'utf8')).toBe('origen');
    expect(await fs.readFile(dst, 'utf8')).toBe('otro escritor');
  });

  it('revierte la copia si el origen queda bloqueado, sin anunciar un movimiento', async () => {
    const src = path.join(dir, 'origen.md');
    const dst = path.join(dir, 'destino.md');
    await fs.writeFile(src, 'origen');
    vi.spyOn(fs, 'link').mockRejectedValue(fail('ENOTSUP'));
    const realUnlink = fs.unlink;
    vi.spyOn(fs, 'unlink').mockImplementation(async (p) => {
      if (p === src) throw fail('EBUSY');
      return realUnlink(p);
    });
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    const placed = vi.fn();
    await expect(ops.moveEntry(src, dst, await fs.stat(src, { bigint: true }), placed)).rejects.toMatchObject({ code: 'EBUSY' });
    expect(await fs.readFile(src, 'utf8')).toBe('origen');
    await expect(fs.stat(dst)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(placed).not.toHaveBeenCalled();
  });

  it('EXDEV entre dispositivos no desactiva enlaces dentro del mismo dispositivo', async () => {
    const src = path.join(dir, 'origen.md');
    await fs.writeFile(src, 'datos');
    const realStat = fs.stat;
    vi.spyOn(fs, 'stat').mockImplementation(async (p: any) => {
      const st = await realStat(p);
      if (p === dir) return Object.assign(st, { dev: st.dev + 1 });
      return st;
    });
    const link = vi.spyOn(fs, 'link').mockRejectedValueOnce(fail('EXDEV'));
    expect(await util.tryHardLink(src, path.join(dir, 'fuera.md'))).toBe(false);
    vi.mocked(fs.stat).mockRestore();
    expect(await util.tryHardLink(src, path.join(dir, 'dentro.md'))).toBe(true);
    expect(link).toHaveBeenCalledTimes(2);
  });

  it('limpia el temporal de creación cuando falla escribir antes de enlazar', async () => {
    const realOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const fh = await realOpen(...args);
      vi.spyOn(fh, 'writeFile').mockRejectedValue(fail('ENOSPC'));
      return fh;
    });
    await expect(util.createExclusive(path.join(dir, 'nota.md'), 'datos')).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('la API crea, captura adjuntos, añade capítulos y conserva historial sin enlaces', async () => {
    const { setup, multipart } = await import('./helpers.ts');
    const t = await setup();
    try {
      const link = vi.spyOn(fs, 'link').mockRejectedValue(fail('EISDIR'));
      const created = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: 'nota.md', content: 'original' } });
      expect(created.statusCode).toBe(200);
      const saved = await t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'notes', path: 'nota.md', content: 'nuevo', baseRev: created.json().rev } });
      expect(saved.statusCode).toBe(200);
      const hist = path.join(t.cfg.historyDir, 'notes', 'nota.md');
      const [bak] = await fs.readdir(hist);
      expect(await fs.readFile(path.join(hist, bak), 'utf8')).toBe('original');
      const fd = new FormData();
      fd.set('title', 'Documento ficticio');
      fd.set('file', new Blob(['%PDF-ficticio']), 'documento.pdf');
      const captured = await t.app.inject({ method: 'POST', url: '/api/capture', ...await multipart(fd) });
      expect(captured.statusCode).toBe(200);
      expect(await fs.readFile(path.join(t.cfg.notesDir, 'Recursos', 'adjuntos', 'documento.pdf'), 'utf8')).toBe('%PDF-ficticio');
      const chapter = await t.app.inject({ method: 'POST', url: '/api/memoria/sections', payload: { kind: 'chapter', title: 'Capítulo ficticio' } });
      expect(chapter.statusCode).toBe(200);
      const moved = await t.app.inject({ method: 'POST', url: '/api/move', payload: { root: 'notes', from: 'nota.md', to: 'otra.md', updateLinks: false } });
      expect(moved.statusCode).toBe(200);
      const trashed = await t.app.inject({ method: 'DELETE', url: '/api/file?root=notes&path=otra.md' });
      expect(trashed.statusCode).toBe(200);
      const restored = await t.app.inject({ method: 'POST', url: '/api/trash/restore', payload: { root: 'notes', ...trashed.json<{ path: string; trashPath: string }>() } });
      expect(restored.statusCode).toBe(200);
      expect(await fs.readFile(path.join(t.cfg.notesDir, 'otra.md'), 'utf8')).toBe('nuevo');
      expect(link).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      await t.close();
    }
  });
});
