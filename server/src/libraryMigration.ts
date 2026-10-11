import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { Ctx } from './context.ts';
import { HttpError, badRequest, notFound } from './errors.ts';
import { atomicWrite, backup, createExclusive, rev } from './fsutil.ts';
import { parseFrontmatter, setFrontmatterKeys, splitFrontmatter } from './frontmatter.ts';
import { resolveAttachment } from './attachments.ts';
import { ensureLibrary, libraryId } from './libraryIdentity.ts';
import { newLibraryData, UUID } from './libraryModel.ts';
import { isInside, resolveSafe } from './paths.ts';
import { listResources } from './resources.ts';
import { treeKey } from './fileops.ts';

interface Selection { path: string; baseRev: string; id: string; proposalRev: string }
interface Entry extends Selection { before: string; after: string; afterRev: string; applied: boolean }
interface Migration {
  version: 1; id: string; createdAt: string; fingerprint: string;
  state: 'prepared' | 'done' | 'undoing' | 'undone'; entries: Entry[]; error?: string;
}
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const dir = (ctx: Ctx) => path.join(path.dirname(ctx.cfg.buildDir), 'library', libraryId(ctx.cfg), 'migrations');
const file = (ctx: Ctx, id: string) => {
  if (!UUID.test(id)) throw badRequest('Identificador de migración no válido');
  return path.join(dir(ctx), `${id}.json`);
};
const summary = (op: Migration) => ({ id: op.id, createdAt: op.createdAt, state: op.state, total: op.entries.length,
  applied: op.entries.filter((entry) => entry.applied).length, ...(op.error ? { error: op.error } : {}) });

async function read(ctx: Ctx, id: string): Promise<Migration | null> {
  try {
    const op = JSON.parse(await fs.readFile(file(ctx, id), 'utf8')) as Migration;
    if (op.version !== 1 || op.id !== id || !['prepared', 'done', 'undoing', 'undone'].includes(op.state) || !Array.isArray(op.entries)
      || op.entries.length > 100 || !op.fingerprint || op.entries.some((e) => !UUID.test(e.id) || typeof e.path !== 'string' || typeof e.before !== 'string'
        || typeof e.after !== 'string' || rev(e.after) !== e.afterRev || rev(Buffer.from(e.before, 'base64')) !== e.baseRev || typeof e.applied !== 'boolean')) {
      throw new Error('Registro de migración no válido; conserva una copia antes de repararlo');
    }
    return op;
  } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}
const save = (ctx: Ctx, op: Migration) => atomicWrite(file(ctx, op.id), JSON.stringify(op) + '\n');

async function resource(ctx: Ctx, input: unknown) {
  const root = await resolveSafe(ctx.cfg, 'notes', ctx.cfg.resourcesSubdir);
  const r = await resolveSafe(ctx.cfg, 'notes', input);
  if (!r.rel.toLowerCase().endsWith('.md') || !isInside(root.abs, r.abs)) throw badRequest('La ficha debe estar dentro de Biblioteca');
  return r;
}
async function content(ctx: Ctx, rel: string) {
  const r = await resource(ctx, rel);
  const st = await fs.stat(r.abs);
  if (!st.isFile() || st.size > 2 * 1024 * 1024) throw badRequest('Ficha no válida o mayor de 2 MB');
  const bytes = await fs.readFile(r.abs);
  if (!Buffer.from(bytes.toString('utf8')).equals(bytes)) throw badRequest('La ficha no está codificada en UTF-8');
  return { r, bytes, text: bytes.toString('utf8') };
}

async function converted(ctx: Ctx, rel: string, src: string, id: string) {
  const split = splitFrontmatter(src);
  if (split.yaml !== null) YAML.parse(split.yaml);
  const { data } = parseFrontmatter(src);
  if (data.biblioteca !== undefined) throw new HttpError(409, 'La ficha ya tiene datos de biblioteca; recarga la vista previa');
  const warnings: string[] = [], attachments: string[] = [];
  if (data.attachment !== undefined) {
    if (typeof data.attachment !== 'string') throw badRequest('El adjunto antiguo no es una ruta de texto');
    const att = await resolveAttachment(ctx.cfg, rel, data.attachment);
    if (!att.attachmentPath) throw new HttpError(422, att.attachmentWarning ?? 'No se encontró el adjunto; revísalo antes de migrar');
    attachments.push(path.posix.relative(path.posix.dirname(rel), att.attachmentPath));
    if (att.attachmentWarning) warnings.push(att.attachmentWarning);
  }
  const library = newLibraryData({ id, urls: typeof data.url === 'string' && data.url ? [data.url] : [], attachments, method: 'legacy' });
  return { after: setFrontmatterKeys(src, { biblioteca: library }), warnings, library };
}

export async function migrationPreview(ctx: Ctx) {
  const list = await listResources(ctx.cfg);
  const items = [], warnings = [...list.warnings];
  for (const item of list.items.filter((item) => !item.schemaVersion && !item.libraryError).slice(0, 100)) {
    try {
      const { text } = await content(ctx, item.path), id = crypto.randomUUID();
      const next = await converted(ctx, item.path, text, id);
      items.push({ path: item.path, title: item.title, baseRev: rev(text), id, proposalRev: rev(next.after), ...next });
    } catch (e) { warnings.push({ path: item.path, message: e instanceof Error ? e.message : 'No se pudo preparar la ficha' }); }
  }
  return { items, warnings, operations: await migrationList(ctx) };
}

export async function migrationList(ctx: Ctx) {
  let names: string[];
  try { names = await fs.readdir(dir(ctx)); } catch (e: any) { if (e.code === 'ENOENT') return []; throw e; }
  const operations = [];
  for (const name of names.filter((name) => name.endsWith('.json') && UUID.test(name.slice(0, -5)))) {
    const op = await read(ctx, name.slice(0, -5));
    if (op) operations.push(summary(op));
  }
  return operations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Preflight y revisión bajo el mismo bloqueo que los guardados; cada paso queda registrado. */
async function run(ctx: Ctx, op: Migration) {
  if (op.state === 'undone' || op.state === 'done') return summary(op);
  const undo = op.state === 'undoing';
  try {
    const known = (await listResources(ctx.cfg)).items;
    for (const entry of op.entries) if (known.some((item) => item.id === entry.id && item.path !== entry.path)) throw new HttpError(409, `Identidad duplicada para ${entry.path}; revisa la biblioteca`);
    for (const entry of op.entries) {
      const current = rev((await content(ctx, entry.path)).bytes);
      if (current !== entry.baseRev && current !== entry.afterRev) throw new HttpError(409, `Cambió ${entry.path}; la operación se conserva para revisión`, { path: entry.path, rev: current });
    }
    for (const entry of op.entries) await ctx.locks.run(`notes:${entry.path}`, async () => {
      const { r, bytes } = await content(ctx, entry.path), current = rev(bytes);
      if (current !== entry.baseRev && current !== entry.afterRev) throw new HttpError(409, `Cambió ${entry.path}; no se sobrescribió`, { path: entry.path, rev: current });
      if (current !== (undo ? entry.baseRev : entry.afterRev)) {
        await backup(ctx.cfg, 'notes', entry.path, bytes);
        await atomicWrite(r.abs, undo ? Buffer.from(entry.before, 'base64') : entry.after);
        ctx.bus.change({ root: 'notes', path: entry.path, kind: 'change' });
      }
      entry.applied = !undo;
      await save(ctx, op);
    });
    op.state = undo ? 'undone' : 'done';
    delete op.error;
    await save(ctx, op);
    return summary(op);
  } catch (e) {
    op.error = e instanceof Error ? e.message : 'No se pudo completar la operación';
    await save(ctx, op).catch(() => {});
    throw e;
  }
}

export async function migrate(ctx: Ctx, operationId: string, selection: Selection[]) {
  if (!UUID.test(operationId) || !Array.isArray(selection) || selection.length > 100) throw badRequest('Migración no válida (máximo 100 fichas)');
  for (const e of selection) if (!e || typeof e.path !== 'string' || typeof e.baseRev !== 'string' || !/^[a-f0-9]{16}$/.test(e.baseRev) || typeof e.proposalRev !== 'string' || !/^[a-f0-9]{16}$/.test(e.proposalRev) || typeof e.id !== 'string' || !UUID.test(e.id)) throw badRequest('La migración necesita ruta, revisión, propuesta e identidad de cada ficha');
  selection = selection.map(({ path, baseRev, id, proposalRev }) => ({ path, baseRev, id, proposalRev }));
  if (new Set(selection.map((e) => e.path)).size !== selection.length || new Set(selection.map((e) => e.id)).size !== selection.length) throw badRequest('La selección contiene rutas o identidades repetidas');
  return ctx.locks.run(treeKey('notes'), async () => {
    await ensureLibrary(ctx.cfg);
    const fingerprint = hash(JSON.stringify(selection)), existing = await read(ctx, operationId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'Este identificador de migración ya tiene otra selección');
      return run(ctx, existing);
    }
    const known = (await listResources(ctx.cfg)).items;
    if (selection.some((e) => known.some((item) => item.id === e.id))) throw new HttpError(409, 'La identidad propuesta ya está en uso');
    const entries: Entry[] = [];
    let size = 0;
    for (const e of selection) {
      const { bytes, text } = await content(ctx, e.path);
      if (rev(bytes) !== e.baseRev) throw new HttpError(409, `Cambió ${e.path}; recarga la vista previa`, { path: e.path, rev: rev(bytes) });
      const { after } = await converted(ctx, e.path, text, e.id);
      if (rev(after) !== e.proposalRev) throw new HttpError(409, `Cambió la resolución de ${e.path}; recarga la vista previa`);
      size += bytes.length + Buffer.byteLength(after);
      if (size > 10 * 1024 * 1024) throw new HttpError(413, 'La migración supera 10 MB; selecciona menos fichas');
      entries.push({ ...e, before: bytes.toString('base64'), after, afterRev: rev(after), applied: false });
    }
    const op: Migration = { version: 1, id: operationId, createdAt: new Date().toISOString(), fingerprint, state: 'prepared', entries };
    await fs.mkdir(dir(ctx), { recursive: true });
    if (!await createExclusive(file(ctx, operationId), JSON.stringify(op) + '\n')) throw new HttpError(409, 'La operación ya existe; recarga su estado');
    return run(ctx, op);
  });
}

export async function resumeMigration(ctx: Ctx, id: string, undo = false) {
  return ctx.locks.run(treeKey('notes'), async () => {
    const op = await read(ctx, id);
    if (!op) throw notFound('Migración no encontrada');
    if (undo && op.state !== 'undone' && op.state !== 'undoing') {
      op.state = 'undoing';
      await save(ctx, op);
    }
    return run(ctx, op);
  });
}

export async function recoverMigrations(ctx: Ctx) {
  const problems = [];
  try {
    for (const op of await migrationList(ctx)) if (op.state === 'prepared' || op.state === 'undoing') {
      try { await resumeMigration(ctx, op.id); }
      catch (e) { problems.push(e instanceof Error ? e.message : 'Migración pendiente'); }
    }
  } catch (e) { problems.push(e instanceof Error ? e.message : 'Registro de biblioteca no válido'); }
  return problems;
}
