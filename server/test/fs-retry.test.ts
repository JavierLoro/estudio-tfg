import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveEntry } from '../src/fileops.ts';
import { atomicWrite, retryFileOp, rev } from '../src/fsutil.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

const fail = (code: string) => Object.assign(new Error(code), { code });
const windows = () => vi.spyOn(os, 'platform').mockReturnValue('win32');

describe('bloqueos de archivos en Windows', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])('reintenta rename ante %s con un temporal escribible', async (code) => {
    const abs = path.join(t.cfg.notesDir, 'nota.md');
    await fs.writeFile(abs, 'original', { mode: 0o640 });
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(fail(code)).mockRejectedValueOnce(fail(code));
    windows();
    await atomicWrite(abs, 'nuevo');
    expect(rename).toHaveBeenCalledTimes(3);
    expect(await fs.readFile(abs, 'utf8')).toBe('nuevo');
    if (process.platform !== 'win32') expect((await fs.stat(abs)).mode & 0o777).toBe(0o644);
  });

  it('un bloqueo permanente al guardar devuelve 423, conserva original/historial y limpia temporales', async () => {
    const abs = path.join(t.cfg.notesDir, 'nota.md');
    await fs.writeFile(abs, 'original');
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(fail('EPERM'));
    windows();
    const res = await t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'notes', path: 'nota.md', content: 'nuevo', baseRev: rev('original') } });
    expect(res.statusCode).toBe(423);
    expect(res.json().error).toBe('El archivo está en uso por otro programa; ciérralo y vuelve a intentarlo');
    expect(rename).toHaveBeenCalledTimes(8);
    expect(await fs.readFile(abs, 'utf8')).toBe('original');
    expect((await fs.readdir(t.cfg.notesDir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    const history = path.join(t.cfg.historyDir, 'notes', 'nota.md');
    const [bak] = await fs.readdir(history);
    expect(await fs.readFile(path.join(history, bak), 'utf8')).toBe('original');
  });

  it('no reintenta en POSIX ni ante otros errores en Windows', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    const op = vi.fn().mockRejectedValue(fail('EPERM'));
    await expect(retryFileOp(op)).rejects.toMatchObject({ code: 'EPERM' });
    expect(op).toHaveBeenCalledTimes(1);
    windows();
    op.mockReset().mockRejectedValue(fail('ENOENT'));
    await expect(retryFileOp(op)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])('reintenta unlink ante %s y anuncia el movimiento al terminar', async (code) => {
    const src = path.join(t.cfg.notesDir, 'origen.md');
    const dst = path.join(t.cfg.notesDir, 'destino.md');
    await fs.writeFile(src, 'datos');
    const unlink = vi.spyOn(fs, 'unlink').mockRejectedValueOnce(fail(code)).mockRejectedValueOnce(fail(code));
    const placed = vi.fn();
    windows();
    await moveEntry(src, dst, await fs.stat(src, { bigint: true }), placed);
    expect(unlink).toHaveBeenCalledTimes(3);
    expect(placed).toHaveBeenCalledTimes(1);
    expect(unlink.mock.invocationCallOrder[2]).toBeLessThan(placed.mock.invocationCallOrder[0]);
    expect(await fs.readFile(dst, 'utf8')).toBe('datos');
    await expect(fs.stat(src)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('un unlink permanentemente bloqueado revierte el destino sin eventos move ni duplicados', async () => {
    const src = path.join(t.cfg.notesDir, 'origen.md');
    const dst = path.join(t.cfg.notesDir, 'destino.md');
    await fs.writeFile(src, 'datos');
    const realUnlink = fs.unlink;
    const unlink = vi.spyOn(fs, 'unlink').mockImplementation(async (p) => {
      if (p === src) throw fail('EBUSY');
      return realUnlink(p);
    });
    const changed = vi.fn();
    t.ctx.bus.on('change', changed);
    windows();
    const res = await t.app.inject({ method: 'POST', url: '/api/move', payload: { root: 'notes', from: 'origen.md', to: 'destino.md', updateLinks: false } });
    expect(res.statusCode).toBe(423);
    expect(unlink.mock.calls.filter(([p]) => p === src)).toHaveLength(8);
    expect(await fs.readFile(src, 'utf8')).toBe('datos');
    await expect(fs.stat(dst)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(changed).not.toHaveBeenCalled();
  });

  it('también revierte un movimiento fallido en POSIX, sin reintentos', async () => {
    const src = path.join(t.cfg.notesDir, 'origen.md');
    const dst = path.join(t.cfg.notesDir, 'destino.md');
    await fs.writeFile(src, 'datos');
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    const realUnlink = fs.unlink;
    const unlink = vi.spyOn(fs, 'unlink').mockImplementation(async (p) => {
      if (p === src) throw fail('EACCES');
      return realUnlink(p);
    });
    await expect(moveEntry(src, dst, await fs.stat(src, { bigint: true }))).rejects.toMatchObject({ code: 'EACCES' });
    expect(unlink).toHaveBeenCalledTimes(2);
    expect(await fs.readFile(src, 'utf8')).toBe('datos');
    await expect(fs.stat(dst)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('explica un fallo al retirar el destino y conserva ambos archivos', async () => {
    const src = path.join(t.cfg.notesDir, 'origen.md');
    const dst = path.join(t.cfg.notesDir, 'destino.md');
    await fs.writeFile(src, 'datos');
    vi.spyOn(fs, 'unlink').mockRejectedValue(fail('EPERM'));
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    const placed = vi.fn();
    await expect(moveEntry(src, dst, await fs.stat(src, { bigint: true }), placed)).rejects.toMatchObject({ statusCode: 423, message: expect.stringContaining('ni retirar su copia') });
    expect(await fs.readFile(src, 'utf8')).toBe('datos');
    expect(await fs.readFile(dst, 'utf8')).toBe('datos');
    expect(placed).not.toHaveBeenCalled();
  });

  it('EPERM al renombrar sobre una carpeta aparecida durante la operación devuelve 409', async () => {
    const src = path.join(t.cfg.notesDir, 'origen');
    const dst = path.join(t.cfg.notesDir, 'destino');
    await fs.mkdir(src);
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async () => {
      await fs.mkdir(dst);
      throw fail('EPERM');
    });
    windows();
    await expect(moveEntry(src, dst, await fs.stat(src, { bigint: true }))).rejects.toMatchObject({ statusCode: 409 });
    expect(rename).toHaveBeenCalledTimes(1);
    expect((await fs.stat(src, { bigint: true })).isDirectory()).toBe(true);
  });
});
