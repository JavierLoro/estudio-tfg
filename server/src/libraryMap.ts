import fs from 'node:fs/promises';
import type { Ctx } from './context.ts';
import { HttpError, badRequest } from './errors.ts';
import { atomicWrite, backup, createExclusive, rev } from './fsutil.ts';
import { treeKey } from './fileops.ts';
import { ensureLibrary, libraryId } from './libraryIdentity.ts';
import { UUID } from './libraryModel.ts';
import { resolveSafe } from './paths.ts';

export interface LibraryMapNode {
  id: string;
  parent: string | null;
  title: string;
  note: string;
  resourceId?: string;
}
export interface LibraryMapLink { id: string; from: string; to: string; label: string }
export interface LibraryMap { version: 1; nodes: LibraryMapNode[]; links: LibraryMapLink[] }
const empty = (): LibraryMap => ({ version: 1, nodes: [], links: [] });
const serialize = (map: LibraryMap) => JSON.stringify(map, null, 2) + '\n';
const mapPath = (ctx: Ctx) => `${ctx.cfg.resourcesSubdir}/.mapa.json`;

export function validateLibraryMap(value: any): LibraryMap {
  if (value?.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.links) || value.nodes.length > 200 || value.links.length > 500)
    throw badRequest('Mapa no válido (máximo 200 nodos y 500 conexiones)');
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && !v.includes('\0');
  const nodes: LibraryMapNode[] = value.nodes.map((n: any) => {
    if (!n || !UUID.test(n.id) || !(n.parent === null || UUID.test(n.parent)) || !text(n.title, 200) || !n.title.trim() || !text(n.note, 10000)
      || (n.resourceId !== undefined && !UUID.test(n.resourceId)))
      throw badRequest('Nodo no válido');
    return { id: n.id, parent: n.parent, title: n.title.trim(), note: n.note,
      ...(n.resourceId !== undefined ? { resourceId: n.resourceId } : {}) };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (byId.size !== nodes.length) throw badRequest('Hay identidades de nodo repetidas');
  for (const node of nodes) {
    const seen = new Set([node.id]);
    let parent = node.parent;
    while (parent !== null) {
      if (seen.has(parent) || !byId.has(parent)) throw badRequest('La jerarquía tiene un ciclo o un padre que no existe');
      seen.add(parent);
      if (seen.size > 12) throw badRequest('Se admiten como máximo doce niveles de nodos');
      parent = byId.get(parent)!.parent;
    }
  }
  const links: LibraryMapLink[] = value.links.map((l: any) => {
    if (!l || !UUID.test(l.id) || !byId.has(l.from) || !byId.has(l.to) || l.from === l.to || !text(l.label, 200) || !l.label.trim())
      throw badRequest('Conexión no válida');
    return { id: l.id, from: l.from, to: l.to, label: l.label.trim() };
  });
  if (new Set(links.map(l => l.id)).size !== links.length) throw badRequest('Hay identidades de conexión repetidas');
  return { version: 1, nodes, links };
}

export async function readLibraryMap(ctx: Ctx) {
  const file = await resolveSafe(ctx.cfg, 'notes', mapPath(ctx));
  if (!file.exists) { const map = empty(); return { libraryId: libraryId(ctx.cfg), map, rev: rev(serialize(map)), exists: false }; }
  const st = await fs.stat(file.abs);
  if (!st.isFile() || st.size > 4 * 1024 * 1024) throw new HttpError(422, 'El mapa no es un archivo válido o supera 4 MiB');
  const bytes = await fs.readFile(file.abs);
  try {
    return { libraryId: libraryId(ctx.cfg), map: validateLibraryMap(JSON.parse(bytes.toString('utf8'))), rev: rev(bytes), exists: true };
  } catch { throw new HttpError(422, 'El mapa está dañado o usa un formato desconocido; conserva su archivo antes de repararlo'); }
}

export async function writeLibraryMap(ctx: Ctx, input: any) {
  if (typeof input?.baseRev !== 'string' || !/^[a-f0-9]{16}$/.test(input.baseRev)) throw badRequest('baseRev obligatorio (revisión de 16 caracteres)');
  if (input.libraryId !== libraryId(ctx.cfg)) throw new HttpError(409, 'La Biblioteca cambió; vuelve al destino original');
  const map = validateLibraryMap(input.map), rel = mapPath(ctx), bytes = serialize(map);
  if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) throw badRequest('El mapa supera 4 MiB; reduce el texto de los nodos');
  return ctx.locks.run(treeKey('notes'), () => ctx.locks.run(`notes:${rel}`, async () => {
    const current = await readLibraryMap(ctx);
    if (input.baseRev !== current.rev) throw new HttpError(409, 'El mapa cambió. Conserva tus cambios y recarga para revisarlos.', { current });
    await ensureLibrary(ctx.cfg);
    const file = await resolveSafe(ctx.cfg, 'notes', rel);
    if (current.exists) {
      const before = await fs.readFile(file.abs);
      if (rev(before) !== input.baseRev) throw new HttpError(409, 'El mapa cambió mientras se guardaba; vuelve a revisarlo');
      if (before.toString('utf8') !== bytes) { await backup(ctx.cfg, 'notes', rel, before); await atomicWrite(file.abs, bytes); }
    } else if (!await createExclusive(file.abs, bytes)) throw new HttpError(409, 'El mapa se creó desde otra ventana; vuelve a revisarlo');
    ctx.bus.change({ root: 'notes', path: rel, kind: current.exists ? 'change' : 'add' });
    return { libraryId: current.libraryId, map, rev: rev(bytes), exists: true };
  }));
}
