import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { libraryId } from '../src/libraryIdentity.ts';
import { rev } from '../src/fsutil.ts';
import { setup, canSymlink, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => t.close());
const get = () => t.app.inject({ url: '/api/library/map' });
const node = (title = 'Tema ficticio', parent: string | null = null) => ({ id: crypto.randomUUID(), parent, title, note: '' });
const put = async (map: any, changes: Record<string, unknown> = {}) => {
  const current = (await get()).json();
  return t.app.inject({ method: 'PUT', url: '/api/library/map', payload: { libraryId: libraryId(t.cfg), baseRev: current.rev, map, ...changes } });
};
const file = () => path.join(t.cfg.notesDir, t.cfg.resourcesSubdir, '.mapa.json');

it('leer un mapa vacío no escribe; guardar conserva jerarquía, identidad y vínculos reutilizados', async () => {
  const initial = (await get()).json();
  expect(initial.map).toEqual({ version: 1, nodes: [], links: [] });
  expect(initial.exists).toBe(false);
  await expect(fs.access(file())).rejects.toMatchObject({ code: 'ENOENT' });
  const theme = node(), child = { ...node('Fuente ficticia', theme.id), resourceId: crypto.randomUUID() }, duplicate = { ...node('La misma fuente'), resourceId: child.resourceId };
  const map = { version: 1, nodes: [theme, child, duplicate], links: [{ id: crypto.randomUUID(), from: child.id, to: duplicate.id, label: 'Se usa también en' }] };
  const result = await put(map);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ map, exists: true, libraryId: initial.libraryId });
  expect((await get()).json()).toEqual(result.json());
  expect(result.json().rev).toBe(rev(await fs.readFile(file())));
});

it('exige revisión e identidad de Biblioteca y conserva la versión anterior en historial', async () => {
  const map = { version: 1, nodes: [node()], links: [] };
  const before = (await put(map)).json();
  const after = { ...map, nodes: [{ ...map.nodes[0], title: 'Actualizado' }] };
  expect((await put(after, { baseRev: null })).statusCode).toBe(400);
  expect((await put(after, { libraryId: 'otra-biblioteca' })).statusCode).toBe(409);
  expect((await put(after)).statusCode).toBe(200);
  const stale = await put(map, { baseRev: before.rev });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().current.map).toEqual(after);
  const history = path.join(t.cfg.historyDir, 'notes', t.cfg.resourcesSubdir, '.mapa.json');
  expect(JSON.parse(await fs.readFile(path.join(history, (await fs.readdir(history))[0]), 'utf8'))).toEqual(map);
});

it('rechaza padres inexistentes, ciclos, IDs repetidos y conexiones a nodos ausentes', async () => {
  const a = node(), b = node('Interno', a.id);
  for (const nodes of [[{ ...a, parent: b.id }, b], [a, a], [{ ...a, parent: crypto.randomUUID() }], [{ ...a, note: null }]])
    expect((await put({ version: 1, nodes, links: [] })).statusCode).toBe(400);
  expect((await put({ version: 1, nodes: [a], links: [{ id: crypto.randomUUID(), from: a.id, to: b.id, label: 'Falta' }] })).statusCode).toBe(400);
  const deep = [node()];
  for (let i = 1; i < 13; i++) deep.push(node(`Tema ${i}`, deep[i - 1].id));
  expect((await put({ version: 1, nodes: deep, links: [] })).statusCode).toBe(400);
  expect((await get()).json().exists).toBe(false);
});

it('no publica un mapa cuyo JSON excedería el límite de lectura', async () => {
  const nodes = Array.from({ length: 100 }, () => ({ ...node(), note: '\u0001'.repeat(10000) }));
  expect((await put({ version: 1, nodes, links: [] })).statusCode).toBe(400);
  expect((await get()).json().exists).toBe(false);
});

it('conserva un mapa dañado y rechaza un enlace fuera del vault', async () => {
  await fs.writeFile(file(), '{dañado');
  expect((await get()).statusCode).toBe(422);
  expect((await t.app.inject({ method: 'PUT', url: '/api/library/map', payload: { libraryId: libraryId(t.cfg), baseRev: rev('{dañado'), map: { version: 1, nodes: [], links: [] } } })).statusCode).toBe(422);
  expect(await fs.readFile(file(), 'utf8')).toBe('{dañado');
  if (!await canSymlink()) return;
  const outside = path.join(t.dir, 'fuera.json');
  await fs.writeFile(outside, 'Contenido externo ficticio');
  await fs.unlink(file());
  await fs.symlink(outside, file());
  expect((await get()).statusCode).toBe(400);
  expect(await fs.readFile(outside, 'utf8')).toBe('Contenido externo ficticio');
});
