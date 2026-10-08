import fs from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

it.each(['EPERM', 'EACCES', 'ENOTSUP'])('detecta %s, recuerda la falta de permiso y limpia el temporal', async (code) => {
  vi.resetModules();
  const symlink = vi.spyOn(fs, 'symlink').mockRejectedValue(Object.assign(new Error(code), { code }));
  const rm = vi.spyOn(fs, 'rm');
  const { canSymlink } = await import('./helpers.ts');
  expect(await canSymlink()).toBe(false);
  expect(await canSymlink()).toBe(false);
  expect(symlink).toHaveBeenCalledTimes(1);
  expect(rm).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await expect(fs.stat(rm.mock.calls[0][0])).rejects.toMatchObject({ code: 'ENOENT' });
});

it('un error inesperado al probar enlaces no queda oculto como falta de capacidad', async () => {
  vi.resetModules();
  vi.spyOn(fs, 'symlink').mockRejectedValue(Object.assign(new Error('EIO'), { code: 'EIO' }));
  const { canSymlink } = await import('./helpers.ts');
  await expect(canSymlink()).rejects.toMatchObject({ code: 'EIO' });
});
