import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileInUse } from './errors.ts';
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

const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RETRY_DELAYS = [20, 40, 80, 160, 320, 640, 740];

/** Windows puede bloquear rename/unlink brevemente (antivirus, sincronización…). */
export async function retryFileOp<T>(op: () => Promise<T>): Promise<T> {
  const windows = os.platform() === 'win32';
  for (let i = 0; ; i++) {
    try {
      return await op();
    } catch (e: any) {
      if (!windows || !BUSY.has(e?.code)) throw e;
      if (i === RETRY_DELAYS.length) throw fileInUse();
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[i]));
    }
  }
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
    await retryFileOp(() => fs.rename(tmp, abs));
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

/**
 * Crea sin sobrescribir: temporal + enlace duro, o copia exclusiva si el
 * sistema de archivos no admite enlaces. La alternativa no es atómica.
 * Returns false if the target already exists.
 */
export async function createExclusive(abs: string, data: string | Buffer): Promise<boolean> {
  const tmp = tmpName(abs);
  const fh = await fs.open(tmp, 'wx', 0o644);
  try {
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    return await linkExclusive(tmp, abs);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

export const NO_LINK = new Set(['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS', 'EISDIR', 'EINVAL']);
const noLinkDevices = new Set<string>();

/** Recordar por pareja de volúmenes; EXDEV no invalida enlaces dentro de uno solo. */
export async function tryHardLink(src: string, dst: string): Promise<boolean> {
  const [from, to] = await Promise.all([fs.stat(src), fs.stat(path.dirname(dst))]);
  const key = `${from.dev}:${to.dev}`;
  if (noLinkDevices.has(key)) return false;
  try {
    await fs.link(src, dst);
    return true;
  } catch (e: any) {
    if (NO_LINK.has(e?.code)) {
      noLinkDevices.add(key);
      return false;
    }
    throw e;
  }
}

/** Copia en streaming con O_EXCL y fsync; nunca borra un destino preexistente. */
export async function copyExclusive(src: string, dst: string): Promise<boolean> {
  const st = await fs.lstat(src);
  if (!st.isFile()) throw Object.assign(new Error('El origen no es un archivo regular'), { code: st.isSymbolicLink() ? 'ELOOP' : 'EINVAL' });
  const source = await fs.open(src, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await source.stat();
    if (!opened.isFile() || opened.dev !== st.dev || opened.ino !== st.ino) throw new Error('El archivo de origen ha cambiado');
    let fh;
    try {
      fh = await fs.open(dst, 'wx', 0o644);
    } catch (e: any) {
      if (e?.code === 'EEXIST') return false;
      throw e;
    }
    try {
      try {
        for await (const chunk of source.createReadStream({ autoClose: false })) await fh.writeFile(chunk);
        await fh.sync();
      } finally {
        await fh.close();
      }
      return true;
    } catch (e) {
      await retryFileOp(() => fs.unlink(dst));
      throw e;
    }
  } finally {
    await source.close();
  }
}

/** Coloca un temporal ya escrito sin sobrescribir ni eliminar el temporal. */
export async function linkExclusive(tmp: string, abs: string): Promise<boolean> {
  try {
    if (await tryHardLink(tmp, abs)) return true;
    return await copyExclusive(tmp, abs);
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
