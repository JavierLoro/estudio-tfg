import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { instanceId } from '../src/settings.ts';
import { multipart, setup, canSymlink, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { vi.restoreAllMocks(); await t.close(); });

async function upload(name = 'imagen.png', bytes = Buffer.from('archivo ficticio'), changes: Record<string, string> = {}) {
  const query = new URLSearchParams({ root: 'memoria', directory: 'figuras/importadas', instanceId: instanceId(t.cfg), ...changes });
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(bytes)]), name);
  return t.app.inject({ method: 'POST', url: `/api/files/import?${query}`, ...await multipart(form) });
}

it('guarda bytes en ambas raíces y crea las carpetas sin modificar archivos existentes', async () => {
  for (const root of ['memoria', 'notes']) {
    const result = await upload('CON%.PNG', Buffer.from(root), { root });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ root, path: 'figuras/importadas/CON (recurso).png', reused: false });
    const base = root === 'memoria' ? t.cfg.memoriaDir : t.cfg.notesDir;
    expect(await fs.readFile(path.join(base, result.json().path), 'utf8')).toBe(root);
    expect(await fs.readdir(path.join(base, 'figuras/importadas'))).toEqual(['CON (recurso).png']);
  }
});

it('un nombre ocupado recibe sufijo y los reintentos o subidas concurrentes reutilizan bytes idénticos', async () => {
  const first = (await upload()).json();
  const another = (await upload('imagen.png', Buffer.from('otros bytes'))).json();
  expect(another.path).toBe('figuras/importadas/imagen 2.png');
  const [a, b] = await Promise.all([upload('imagen.png', Buffer.from('otros bytes')), upload('imagen.png', Buffer.from('otros bytes'))]);
  expect(a.json()).toMatchObject({ path: another.path, reused: true });
  expect(b.json()).toMatchObject({ path: another.path, reused: true });
  expect(await fs.readFile(path.join(t.cfg.memoriaDir, first.path), 'utf8')).toBe('archivo ficticio');
  expect(await fs.readdir(path.join(t.cfg.memoriaDir, 'figuras/importadas'))).toHaveLength(2);
});

it('rechaza rutas que escapan, destinos excluidos y un proyecto cambiado', async () => {
  for (const directory of ['../fuera', '/tmp/fuera', 'C:/fuera', '.git/hooks', 'build'])
    expect((await upload('a.png', undefined, { directory })).statusCode).toBe(400);
  expect((await upload('a.png', undefined, { instanceId: 'otro-proyecto' })).statusCode).toBe(409);
  expect((await upload('a.png', undefined, { root: 'otro' })).statusCode).toBe(400);
  expect(await fs.readdir(path.join(t.cfg.memoriaDir, 'figuras'))).not.toContain('importadas');
});

it('rechaza enlaces que salen de la raíz y no toca su destino', async () => {
  if (!await canSymlink('dir')) return;
  const outside = path.join(t.dir, 'fuera');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(t.cfg.memoriaDir, 'atajo'), process.platform === 'win32' ? 'junction' : 'dir');
  expect((await upload('a.png', undefined, { directory: 'atajo' })).statusCode).toBe(400);
  expect(await fs.readdir(outside)).toEqual([]);
});

it('limita a 50 MB, elimina temporales y rechaza varios archivos en una petición', async () => {
  expect((await upload('grande.bin', Buffer.alloc(50 * 1024 * 1024 + 1))).statusCode).toBe(413);
  expect(await fs.readdir(path.join(t.cfg.memoriaDir, 'figuras/importadas'))).toEqual([]);
  const form = new FormData();
  for (const name of ['uno.txt', 'dos.txt']) form.append('file', new Blob(['ficticio']), name);
  const query = new URLSearchParams({ root: 'memoria', directory: '', instanceId: instanceId(t.cfg) });
  expect((await t.app.inject({ method: 'POST', url: `/api/files/import?${query}`, ...await multipart(form) })).statusCode).toBe(413);
  expect(await fs.readdir(t.cfg.memoriaDir)).not.toContain('uno.txt');
  expect((await fs.readdir(t.cfg.memoriaDir)).filter(n => n.startsWith('.upload-'))).toEqual([]);
});

it('un cambio de proyecto durante la subida detiene la publicación y elimina el temporal', async () => {
  const original = t.cfg.memoriaDir, alternative = path.join(t.dir, 'otra-memoria');
  await fs.mkdir(alternative);
  const read = fs.readFile.bind(fs);
  vi.spyOn(fs, 'readFile').mockImplementation((async (...args: any[]) => {
    if (String(args[0]).includes('.upload-')) t.cfg.memoriaDir = alternative;
    return (read as any)(...args);
  }) as typeof fs.readFile);
  expect((await upload()).statusCode).toBe(409);
  expect(await fs.readdir(path.join(original, 'figuras/importadas'))).toEqual([]);
  expect(await fs.readdir(alternative)).toEqual([]);
});
