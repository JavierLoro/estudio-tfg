import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { isIgnoredName } from './ignore.ts';
import { isInside, rootDir, type RootName } from './paths.ts';

export const TEXT_EXTS = new Set([
  '.md', '.tex', '.bib', '.sty', '.cls', '.txt', '.mmd', '.bst', '.json', '.yml', '.yaml',
  '.c', '.py', '.ts', '.js', '.csv',
]);

export function isTextPath(p: string): boolean {
  return TEXT_EXTS.has(path.extname(p).toLowerCase());
}

export function rev(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function tmpName(abs: string): string {
  return path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
}

/** Atomic write: temp file in the same folder + rename. Preserves the file mode if it existed. */
export async function atomicWrite(abs: string, data: string | Buffer): Promise<void> {
  const tmp = tmpName(abs);
  let mode: number | undefined;
  try {
    mode = (await fs.stat(abs)).mode & 0o777;
  } catch {
    /* new file */
  }
  try {
    const fh = await fs.open(tmp, 'wx', mode ?? 0o644);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, abs);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

/**
 * Create a file atomically without ever overwriting: write temp, then hard-link
 * to the target (fails with EEXIST if it exists), then remove the temp.
 * Returns false if the target already exists.
 */
export async function createExclusive(abs: string, data: string | Buffer): Promise<boolean> {
  const tmp = tmpName(abs);
  const fh = await fs.open(tmp, 'wx', 0o644);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fs.link(tmp, abs);
    return true;
  } catch (e: any) {
    if (e?.code === 'EEXIST') return false;
    throw e;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** Move an already-written temp file into place without overwriting. */
export async function linkExclusive(tmp: string, abs: string): Promise<boolean> {
  try {
    await fs.link(tmp, abs);
    return true;
  } catch (e: any) {
    if (e?.code === 'EEXIST') return false;
    throw e;
  }
}

export const HISTORY_KEEP = 20;

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/** Copy the current on-disk version to BUILD_DIR/../history/<root>/<path>/<timestamp>.bak and prune to 20. */
export async function backup(cfg: Config, root: RootName, rel: string, currentContent: Buffer): Promise<string> {
  const dir = path.join(cfg.historyDir, root, ...rel.split('/'));
  if (!isInside(cfg.historyDir, dir)) throw new Error('Ruta de historial no válida');
  await fs.mkdir(dir, { recursive: true });
  // <ISO timestamp>-<seq>.bak: sorts chronologically even within the same millisecond.
  const ts = stamp();
  let name = '';
  for (let i = 0; ; i++) {
    name = `${ts}-${String(i).padStart(3, '0')}.bak`;
    if (await createExclusive(path.join(dir, name), currentContent)) break;
  }
  const all = (await fs.readdir(dir)).filter((f) => f.endsWith('.bak')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - HISTORY_KEEP))) {
    await fs.rm(path.join(dir, old), { force: true });
  }
  return path.join(dir, name);
}

/** Serialise async operations per key (e.g. per file). */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

export interface WalkedFile {
  rel: string;
  abs: string;
}

/**
 * Recursively list non-ignored files of a root. Symlinks are followed only if
 * they stay inside the root; directory cycles are avoided.
 */
export async function walkFiles(cfg: Config, root: RootName, opts: { includeSyncConflicts?: boolean } = {}): Promise<WalkedFile[]> {
  const base = await fs.realpath(rootDir(cfg, root));
  const out: WalkedFile[] = [];
  const seen = new Set<string>();
  async function rec(dirAbs: string, dirRel: string) {
    const real = await fs.realpath(dirAbs).catch(() => null);
    if (!real || !isInside(base, real) || seen.has(real)) return;
    seen.add(real);
    let ents;
    try {
      ents = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const abs = path.join(dirAbs, ent.name);
      const rel = dirRel ? `${dirRel}/${ent.name}` : ent.name;
      let isDir = ent.isDirectory();
      let isFile = ent.isFile();
      if (ent.isSymbolicLink()) {
        const target = await fs.realpath(abs).catch(() => null);
        if (!target || !isInside(base, target)) continue;
        const st = await fs.stat(target).catch(() => null);
        if (!st) continue;
        isDir = st.isDirectory();
        isFile = st.isFile();
      }
      if (opts.includeSyncConflicts && isFile && ent.name.includes('.sync-conflict-') && !ent.name.startsWith('.')) {
        out.push({ rel, abs });
        continue;
      }
      if (isIgnoredName(ent.name, root, isDir)) continue;
      if (isDir) await rec(abs, rel);
      else if (isFile && !opts.includeSyncConflicts) out.push({ rel, abs });
    }
  }
  await rec(base, '');
  return out;
}
