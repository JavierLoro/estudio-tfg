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
export function normalizeRel(p: unknown, allowEmpty = false): string {
  if (typeof p !== 'string') throw badRequest('path es obligatorio');
  if (p.includes('\0')) throw badRequest('Ruta no válida');
  if (p.includes('\\')) throw badRequest('Ruta no válida: usa "/"');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) throw badRequest('Ruta absoluta no permitida');
  const segs = p.split('/').filter((s) => s !== '' && s !== '.');
  if (segs.some((s) => s === '..')) throw badRequest('Ruta no permitida ("..")');
  const rel = segs.join('/');
  if (!rel && !allowEmpty) throw badRequest('path es obligatorio');
  return rel;
}

export function isInside(parent: string, child: string): boolean {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r));
}

async function realRoot(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir);
  } catch {
    throw new HttpError(500, `La carpeta raíz no existe: ${dir}`);
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
      if (probe === base) throw new HttpError(500, 'La carpeta raíz no existe');
      missing.push(path.basename(probe));
      probe = path.dirname(probe);
    }
  }
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
