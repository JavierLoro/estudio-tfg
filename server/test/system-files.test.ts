import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIgnoredName, isIgnoredRel } from '../src/ignore.ts';
import { computeSourceRev, createSourceTar } from '../src/compile.ts';
import { isEmptyDir } from '../../scripts/memoria-template.mjs';
import { setup, flatPaths, type TestEnv } from './helpers.ts';

let env: TestEnv | null = null;
afterEach(async () => { vi.restoreAllMocks(); await env?.close(); env = null; });

describe('archivos de sistema', () => {
  it.each(['desktop.ini', 'DESKTOP.INI', 'Thumbs.db', 'THUMBS.DB', 'archivo.tmp', 'ARCHIVO.TMP'])('ignora %s en ambas raíces', (name) => {
    for (const root of ['memoria', 'notes'] as const) {
      expect(isIgnoredName(name, root, false)).toBe(true);
      expect(isIgnoredRel(`carpeta/${name}`, root, false)).toBe(true);
      expect(isIgnoredName(name, root, true)).toBe(false);
    }
  });
  it('solo residuos = vacía; una carpeta o un archivo de usuario no', async () => {
    env = await setup();
    const dir = path.join(env.dir, 'vacia'); await fs.mkdir(dir);
    for (const name of ['desktop.ini', 'THUMBS.DB', 'copia.tmp', '.DS_Store']) await fs.writeFile(path.join(dir, name), 'residuo');
    expect(isEmptyDir(dir)).toBe(true);
    await fs.mkdir(path.join(dir, 'carpeta.tmp'));
    expect(isEmptyDir(dir)).toBe(false);
    await fs.rmdir(path.join(dir, 'carpeta.tmp'));
    await fs.writeFile(path.join(dir, 'nota.md'), 'contenido');
    expect(isEmptyDir(dir)).toBe(false);
  });
  it('árbol, búsqueda y tar omiten residuos y sourceRev no cambia', async () => {
    env = await setup();
    const before = await computeSourceRev(env.cfg);
    for (const dir of [env.cfg.memoriaDir, env.cfg.notesDir]) {
      for (const name of ['desktop.ini', 'Thumbs.db', 'residuo.TMP']) await fs.writeFile(path.join(dir, name), 'marcador-residuo');
    }
    expect(await computeSourceRev(env.cfg)).toBe(before);
    for (const root of ['memoria', 'notes']) {
      const tree = (await env.app.inject({ url: `/api/tree?root=${root}` })).json();
      expect(flatPaths(tree.entries).some((p) => /desktop.ini|thumbs.db|residuo.tmp/i.test(p))).toBe(false);
      const hits = (await env.app.inject({ url: `/api/search?root=${root}&q=marcador-residuo` })).json();
      expect(hits.items).toEqual([]);
    }
    const names: string[] = [];
    const parser = new tar.Parser({ onReadEntry: (e) => { names.push(e.path); e.resume(); } });
    await pipeline((await createSourceTar(env.cfg)).stream, parser);
    expect(names.some((p) => /desktop.ini|thumbs.db|residuo.tmp/i.test(p))).toBe(false);
    expect(names).toContain('tfg.tex');
  });
});

describe('selector de carpetas en Windows', () => {
  const names = ['AppData', '$Recycle.Bin', 'System Volume Information', 'Config.Msi', 'Recovery', 'PerfLogs', 'Windows', 'ProgramData', 'Program Files', 'Program Files (x86)', 'MSOCache'];
  it('filtra nombres de sistema solo en Windows y conserva las raíces explícitas', async () => {
    env = await setup();
    for (const name of [...names, 'Documentos']) await fs.mkdir(path.join(env.dir, name));
    const url = `/api/fs/dirs?path=${encodeURIComponent(env.dir)}`;
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    let res = (await env.app.inject({ url })).json();
    expect(res.dirs.map((e: any) => e.name)).toContain('Documentos');
    expect(res.dirs.map((e: any) => e.name).some((n: string) => names.includes(n))).toBe(false);
    expect((await env.app.inject({ url: '/api/fs/dirs' })).json().dirs[0].path).toBe(env.dir);
    vi.mocked(os.platform).mockReturnValue('darwin');
    res = (await env.app.inject({ url })).json();
    expect(res.dirs.map((e: any) => e.name)).toEqual(expect.arrayContaining(names));
  });
  it.each(['EPERM', 'EACCES'])('omite un hijo cuyo readdir falla con %s', async (code) => {
    env = await setup();
    const denied = path.join(env.dir, 'Protegida'); await fs.mkdir(denied);
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    const read = fs.readdir.bind(fs);
    vi.spyOn(fs, 'readdir').mockImplementation(async (...args: any[]) => {
      if (String(args[0]) === denied) throw Object.assign(new Error('permiso'), { code });
      return (read as any)(...args);
    });
    const res = await env.app.inject({ url: `/api/fs/dirs?path=${encodeURIComponent(env.dir)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().dirs.map((e: any) => e.name)).not.toContain('Protegida');
  });
});
