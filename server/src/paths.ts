import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { HttpError, badRequest } from './errors.ts';

export type RootName = 'notes' | 'memoria';
export const ROOTS: RootName[] = ['notes', 'memoria'];

export function parseRoot(v: unknown): RootName {
  if (v === 'notes' || v === 'memoria') return v;
  throw badRequest('root debe ser "notes" o "memoria"');
}

export function rootDir(cfg: Config, root: RootName): string {
  return root === 'notes' ? cfg.notesDir : cfg.memoriaDir;
}

/**
 * Validate and normalise a root-relative path. Rejects absolute paths, `..`,
 * backslashes, NUL and empty paths (unless allowEmpty).
 */
export function normalizeRel(p: unknown, allowEmpty = false, paths = path): string {
  if (typeof p !== 'string') throw badRequest('path es obligatorio');
  if (p.includes('\0')) throw badRequest('Ruta no válida');
  if (p.includes('\\')) throw badRequest('Ruta no válida: usa "/"');
  if (paths.isAbsolute(p) || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) throw badRequest('Ruta absoluta no permitida');
  const segs = p.split('/').filter((s) => s !== '' && s !== '.');
  if (segs.some((s) => s === '..')) throw badRequest('Ruta no permitida ("..")');
  const rel = segs.join('/');
  if (!rel && !allowEmpty) throw badRequest('path es obligatorio');
  return rel;
}

/** También Windows reserva estos nombres con extensión y los dígitos ¹²³. */
export function isReservedName(name: string): boolean {
  return /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(name.split('.')[0].trimEnd());
}

function segmentError(name: string): string | null {
  if (!name || name === '.' || name === '..') return 'elige un nombre de archivo o carpeta';
  if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name)) return 'no uses caracteres de control ni <>:"/\\|?*';
  if (/[. ]$/.test(name)) return 'no puede terminar en punto ni espacio';
  if (isReservedName(name)) return 'es un nombre reservado en Windows';
  return null;
}

export function validSegment(name: string): boolean {
  return segmentError(name) === null;
}

/** Validar nombres nuevos; los padres que ya existen pueden conservar nombres antiguos. */
export async function validateNewPath(cfg: Config, root: RootName, input: unknown, field = 'path'): Promise<string> {
  let rel: string;
  try {
    rel = normalizeRel(input);
  } catch (e) {
    if (e instanceof HttpError && e.statusCode === 400) throw new HttpError(400, e.message, { ...e.body, field });
    throw e;
  }
  const segments = rel.split('/');
  for (let i = 0; i < segments.length; i++) {
    const reason = segmentError(segments[i]);
    if (!reason) continue;
    if (i < segments.length - 1) {
      const parent = await resolveSafe(cfg, root, segments.slice(0, i + 1).join('/')).catch(() => null);
      if (parent?.exists) continue;
    }
    throw new HttpError(400, `Nombre «${segments[i]}» no válido: ${reason}`, { field });
  }
  return rel;
}

export function isInside(parent: string, child: string, paths = path): boolean {
  if (paths.sep === '\\') {
    parent = paths.toNamespacedPath(parent);
    child = paths.toNamespacedPath(child);
  }
  const r = paths.relative(parent, child);
  return r === '' || (!r.startsWith('..' + paths.sep) && r !== '..' && !paths.isAbsolute(r));
}

async function realRoot(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir);
  } catch {
    throw new HttpError(409, `Configura las carpetas en Ajustes (no existe: ${dir})`, { code: 'not_configured' });
  }
}

export interface Resolved {
  rel: string;
  /** Absolute path (realpath when the file exists). */
  abs: string;
  exists: boolean;
}

/**
 * Resolve a root-relative path safely. Follows symlinks via realpath of the
 * deepest existing ancestor and rejects anything escaping the root (400).
 */
export async function resolveSafe(cfg: Config, root: RootName, relInput: unknown, allowEmpty = false): Promise<Resolved> {
  const rel = normalizeRel(relInput, allowEmpty);
  const base = await realRoot(rootDir(cfg, root));
  const lexical = path.join(base, ...rel.split('/').filter(Boolean));
  if (!isInside(base, lexical)) throw badRequest('Ruta fuera de la raíz');

  // Find deepest existing ancestor (including the path itself).
  let probe = lexical;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      if (!isInside(base, real)) throw badRequest('Ruta fuera de la raíz (enlace simbólico)');
      const abs = missing.length ? path.join(real, ...missing.reverse()) : real;
      return { rel, abs, exists: missing.length === 0 };
    } catch (e: any) {
      if (e instanceof HttpError) throw e;
      if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') throw e;
      // A dangling symlink: lstat succeeds but realpath fails -> refuse.
      try {
        const st = await fs.lstat(probe);
        if (st.isSymbolicLink()) throw badRequest('Enlace simbólico no válido');
      } catch (le: any) {
        if (le instanceof HttpError) throw le;
      }
      if (probe === base) throw new HttpError(409, 'Configura las carpetas en Ajustes (la carpeta raíz no existe)', { code: 'not_configured' });
      missing.push(path.basename(probe));
      probe = path.dirname(probe);
    }
  }
}

export function toPosix(p: string, paths = path): string {
  return p.split(paths.sep).join('/');
}
