import fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import type { Ctx } from './context.ts';
import type { Config } from './config.ts';
import { HttpError, badRequest, notFound } from './errors.ts';
import { atomicWrite, backup, rev, walkFiles } from './fsutil.ts';
import { isIgnoredName, isIgnoredRel } from './ignore.ts';
import { DEFAULT_GRAPHICSPATH, noteLinkCtx, parseGraphicspath, rewriteNote, rewriteTex, texLinkCtx, type MoveMap } from './links.ts';
import { isInside, normalizeRel, resolveSafe, rootDir, type RootName } from './paths.ts';

/**
 * Carpetas, mover/renombrar, papelera y restaurar (contrato v0.7).
 * Nada se borra de verdad: eliminar es mover a la papelera.
 */

/** Clave de bloqueo para operaciones que cambian el árbol de una raíz (se serializan). */
const treeKey = (root: RootName) => `${root}:\0tree`;

const MAX_REWRITE = 2 * 1024 * 1024;

export interface Entry {
  rel: string;
  /** Ruta absoluta sin seguir el último enlace simbólico (carpeta padre real + nombre). */
  abs: string;
  st: Stats | null;
}

async function lstatOrNull(abs: string): Promise<Stats | null> {
  try {
    return await fs.lstat(abs);
  } catch (e: any) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return null;
    throw e;
  }
}

/** Valida una ruta (no la raíz, dentro de ella) y la devuelve sin seguir un enlace final. */
export async function entryOf(cfg: Config, root: RootName, input: unknown, name = 'path'): Promise<Entry> {
  if (typeof input !== 'string') throw badRequest(`${name} es obligatorio`);
  const rel = normalizeRel(input, true);
  if (!rel) throw badRequest('No se puede usar la carpeta raíz');
  await resolveSafe(cfg, root, rel);
  const parent = await resolveSafe(cfg, root, path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), true);
  const abs = path.join(parent.abs, path.posix.basename(rel));
  return { rel, abs, st: await lstatOrNull(abs) };
}

/** Archivos (no ignorados) de una entrada: ella misma o, si es carpeta, su contenido. */
async function listEntryFiles(e: Entry, root: RootName): Promise<string[]> {
  if (!e.st?.isDirectory()) return [e.rel];
  const out: string[] = [];
  async function rec(abs: string, rel: string) {
    for (const ent of await fs.readdir(abs, { withFileTypes: true })) {
      if (isIgnoredName(ent.name, root, ent.isDirectory())) continue;
      if (ent.isDirectory()) await rec(path.join(abs, ent.name), `${rel}/${ent.name}`);
      else out.push(`${rel}/${ent.name}`);
    }
  }
  await rec(e.abs, e.rel);
  return out.sort();
}

const NO_LINK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS', 'EACCES']);

/**
 * Mueve un archivo o carpeta sin sobrescribir nunca: archivos con link+unlink
 * (falla si el destino existe), carpetas con rename; si cruza de dispositivo
 * (EXDEV), copia y luego borra el origen. `onPlaced` se llama cuando el destino
 * ya existe y antes de quitar el origen.
 */
export async function moveEntry(src: string, dst: string, st: Stats, onPlaced: () => void = () => {}, caseOnly = false): Promise<void> {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  if (st.isFile() && !caseOnly) {
    try {
      await fs.link(src, dst);
      onPlaced();
      await fs.unlink(src);
      return;
    } catch (e: any) {
      if (e?.code === 'EEXIST') throw new HttpError(409, 'Ya existe un archivo o carpeta con ese nombre');
      if (!NO_LINK.has(e?.code)) throw e;
    }
  }
  if (!caseOnly && (await lstatOrNull(dst))) throw new HttpError(409, 'Ya existe un archivo o carpeta con ese nombre');
  try {
    await fs.rename(src, dst);
    onPlaced();
  } catch (e: any) {
    if (e?.code === 'ENOTEMPTY' || e?.code === 'EEXIST') throw new HttpError(409, 'Ya existe un archivo o carpeta con ese nombre');
    if (e?.code !== 'EXDEV') throw e;
    // Otro dispositivo: copiar (sin sobrescribir) y quitar el origen solo si la copia terminó.
    await fs.cp(src, dst, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true });
    onPlaced();
    await fs.rm(src, { recursive: true });
  }
}

// ───────────────────────────── Carpetas ─────────────────────────────

export async function createDir(ctx: Ctx, root: RootName, input: unknown): Promise<string> {
  const e = await entryOf(ctx.cfg, root, input);
  return ctx.locks.run(treeKey(root), async () => {
    if (await lstatOrNull(e.abs)) throw new HttpError(409, 'Ya existe un archivo o carpeta con ese nombre');
    try {
      await fs.mkdir(e.abs, { recursive: true });
    } catch (err: any) {
      if (err?.code === 'EEXIST' || err?.code === 'ENOTDIR') throw new HttpError(409, 'Hay un archivo con ese nombre en la ruta');
      throw err;
    }
    await resolveSafe(ctx.cfg, root, e.rel); // contención tras crear
    return e.rel;
  });
}

// ───────────────────────────── Mover ─────────────────────────────

export interface MoveResult {
  path: string;
  moved: { from: string; to: string }[];
  updated: { path: string; rev: string }[];
  /** Solo si alguna reescritura de enlaces falló (el archivo queda como estaba). */
  failed?: { path: string; error: string }[];
}

const isUnder = (child: string, parent: string) => child === parent || child.startsWith(`${parent}/`);

export async function moveEntryOp(ctx: Ctx, root: RootName, fromIn: unknown, toIn: unknown, updateLinks: boolean): Promise<MoveResult> {
  const { cfg } = ctx;
  const from = await entryOf(cfg, root, fromIn, 'from');
  const to = await entryOf(cfg, root, toIn, 'to');
  if (isUnder(to.rel, from.rel) && to.rel !== from.rel) throw badRequest('No se puede mover una carpeta dentro de sí misma');
  return ctx.locks.run(treeKey(root), async () => {
    const fromSt = await lstatOrNull(from.abs);
    if (!fromSt) throw notFound('No existe el archivo o carpeta');
    const toSt = await lstatOrNull(to.abs);
    // Renombrar solo cambiando mayúsculas en un sistema de archivos que no las distingue.
    const caseOnly = !!toSt && to.rel !== from.rel && to.rel.toLowerCase() === from.rel.toLowerCase() && toSt.ino === fromSt.ino && toSt.dev === fromSt.dev;
    if (toSt && !caseOnly) throw new HttpError(409, 'Ya existe un archivo o carpeta con ese nombre');
    if (fromSt.isDirectory() && isInside(from.abs, to.abs) && !caseOnly) throw badRequest('No se puede mover una carpeta dentro de sí misma');

    const fromEntry = { ...from, st: fromSt };
    const files = await listEntryFiles(fromEntry, root);
    const map = new Map(files.map((f) => [f, to.rel + f.slice(from.rel.length)]));
    const moved = [...map].map(([f, t]) => ({ from: f, to: t }));
    const preFiles = updateLinks ? (await walkFiles(cfg, root)).map((f) => f.rel) : [];

    const doMove = () =>
      moveEntry(from.abs, to.abs, fromSt, () => {
        for (const m of moved) ctx.bus.change({ root, path: m.to, from: m.from, kind: 'move' });
      }, caseOnly);
    // Un archivo suelto: también con su bloqueo, para no cruzarse con un guardado.
    if (fromSt.isFile()) await ctx.locks.run(`${root}:${from.rel}`, () => ctx.locks.run(`${root}:${to.rel}`, doMove));
    else await doMove();
    await resolveSafe(cfg, root, to.rel); // contención tras mover

    const result: MoveResult = { path: to.rel, moved, updated: [] };
    if (updateLinks && map.size) {
      const postFiles = preFiles
        .map((f) => map.get(f) ?? f)
        .filter((f) => !isIgnoredRel(f, root));
      const { updated, failed } = await rewriteLinks(ctx, root, { map, preFiles, postFiles });
      result.updated = updated;
      if (failed.length) result.failed = failed;
    }
    return result;
  });
}

async function readSmall(abs: string): Promise<Buffer | null> {
  try {
    const st = await fs.stat(abs);
    if (!st.isFile() || st.size > MAX_REWRITE) return null;
    return await fs.readFile(abs);
  } catch {
    return null;
  }
}

/** Reescribe los enlaces de la raíz tras mover. Cada archivo: bloqueo, historial y escritura atómica. */
async function rewriteLinks(ctx: Ctx, root: RootName, mm: MoveMap): Promise<{ updated: MoveResult['updated']; failed: NonNullable<MoveResult['failed']> }> {
  const base = await fs.realpath(rootDir(ctx.cfg, root));
  const inverse = new Map([...mm.map].map(([a, b]) => [b, a]));
  const updated: MoveResult['updated'] = [];
  const failed: NonNullable<MoveResult['failed']> = [];
  const ext = root === 'notes' ? '.md' : '.tex';
  const targets = mm.postFiles.filter((f) => f.toLowerCase().endsWith(ext));

  let rewrite: (content: string, oldPath: string, newPath: string) => string;
  if (root === 'notes') {
    const c = noteLinkCtx(mm);
    rewrite = (content, oldPath, newPath) => rewriteNote(content, oldPath, newPath, c);
  } else {
    const gp: string[] = [];
    for (const f of mm.postFiles.filter((f) => /\.(tex|cls|sty)$/i.test(f))) {
      const buf = await readSmall(path.join(base, ...f.split('/')));
      if (buf && buf.includes('\\graphicspath')) for (const d of parseGraphicspath(buf.toString('utf8'))) if (!gp.includes(d)) gp.push(d);
    }
    const c = texLinkCtx(mm, gp.length ? gp : DEFAULT_GRAPHICSPATH);
    rewrite = (content) => rewriteTex(content, c);
  }

  for (const rel of targets) {
    const abs = path.join(base, ...rel.split('/'));
    try {
      await ctx.locks.run(`${root}:${rel}`, async () => {
        const buf = await readSmall(abs);
        if (!buf) return;
        const content = buf.toString('utf8');
        if (!Buffer.from(content, 'utf8').equals(buf)) return; // no es UTF-8 válido: no se toca
        const next = rewrite(content, inverse.get(rel) ?? rel, rel);
        if (next === content) return;
        await backup(ctx.cfg, root, rel, buf);
        await atomicWrite(abs, next);
        updated.push({ path: rel, rev: rev(next) });
      });
    } catch (e: any) {
      failed.push({ path: rel, error: e?.message || String(e) });
    }
  }
  return { updated, failed };
}

// ───────────────────────────── Papelera ─────────────────────────────

/** Carpeta de la papelera: `<notas>/.trash` o `data/trash/memoria`. */
async function trashBase(cfg: Config, root: RootName): Promise<string> {
  if (root === 'notes') return path.join(await fs.realpath(cfg.notesDir), '.trash');
  return path.join(path.dirname(cfg.buildDir), 'trash', 'memoria');
}

function withN(name: string, n: number, keepExt: boolean): string {
  if (n === 1) return name;
  const ext = keepExt ? path.extname(name) : '';
  return `${name.slice(0, name.length - ext.length)} (${n})${ext}`;
}

/** Ruta libre dentro de la papelera: ` (2)`, ` (3)`… en el nombre que choque. */
async function freeTrashRel(base: string, rel: string, isDir: boolean): Promise<string> {
  const segs = rel.split('/');
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const last = i === segs.length - 1;
    for (let n = 1; ; n++) {
      const cand = withN(segs[i], n, last && !isDir);
      const st = await lstatOrNull(path.join(base, ...out, cand));
      if (last ? !st : !st || st.isDirectory()) {
        out.push(cand);
        break;
      }
      if (n > 10_000) throw new Error('Demasiadas colisiones de nombre en la papelera');
    }
  }
  return out.join('/');
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

export async function trashEntry(ctx: Ctx, root: RootName, input: unknown): Promise<{ path: string; trashPath: string }> {
  const { cfg } = ctx;
  const e = await entryOf(cfg, root, input);
  return ctx.locks.run(treeKey(root), async () => {
    const st = await lstatOrNull(e.abs);
    if (!st) throw notFound('No existe el archivo o carpeta');
    const base = await trashBase(cfg, root);
    if (root === 'notes' && isUnder(e.rel, '.trash')) throw badRequest('Ya está en la papelera');
    await fs.mkdir(base, { recursive: true });
    if (root === 'notes' && !isInside(path.dirname(base), await fs.realpath(base))) throw badRequest('La papelera sale de la carpeta de notas');
    const trashPath = await freeTrashRel(base, root === 'notes' ? e.rel : `${stamp()}/${e.rel}`, st.isDirectory());
    const dst = path.join(base, ...trashPath.split('/'));
    const run = () => moveEntry(e.abs, dst, st);
    if (st.isFile()) await ctx.locks.run(`${root}:${e.rel}`, run);
    else await run();
    return { path: e.rel, trashPath };
  });
}

/** Quita las carpetas vacías desde `dir` hacia arriba sin llegar a `base`. */
async function pruneEmpty(dir: string, base: string): Promise<void> {
  while (dir !== base && isInside(base, dir)) {
    try {
      await fs.rmdir(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

export async function restoreEntry(ctx: Ctx, root: RootName, input: unknown, trashPathIn: unknown): Promise<string> {
  const { cfg } = ctx;
  const e = await entryOf(cfg, root, input);
  if (typeof trashPathIn !== 'string') throw badRequest('trashPath es obligatorio');
  const trashRel = normalizeRel(trashPathIn);
  return ctx.locks.run(treeKey(root), async () => {
    const base = await trashBase(cfg, root);
    const realBase = await fs.realpath(base).catch(() => null);
    if (!realBase) throw notFound('No está en la papelera');
    const src = path.join(realBase, ...trashRel.split('/'));
    const realParent = await fs.realpath(path.dirname(src)).catch(() => null);
    if (!realParent || !isInside(realBase, realParent)) throw notFound('No está en la papelera');
    const st = await lstatOrNull(src);
    if (!st) throw notFound('No está en la papelera');
    if (await lstatOrNull(e.abs)) throw new HttpError(409, 'Ya existe un archivo o carpeta en esa ruta');
    const run = () => moveEntry(src, e.abs, st);
    if (st.isFile()) await ctx.locks.run(`${root}:${e.rel}`, run);
    else await run();
    await resolveSafe(cfg, root, e.rel);
    await pruneEmpty(path.dirname(src), realBase);
    return e.rel;
  });
}
