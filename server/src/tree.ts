import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { isIgnoredName } from './ignore.ts';
import { isInside, rootDir, type RootName } from './paths.ts';

export interface Entry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  children?: Entry[];
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

export function sortEntries(list: Entry[]): Entry[] {
  return list.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return collator.compare(a.name, b.name) || a.name.localeCompare(b.name);
  });
}

export async function buildTree(cfg: Config, root: RootName): Promise<Entry[]> {
  const base = await fs.realpath(rootDir(cfg, root));
  const seen = new Set<string>();
  async function rec(dirAbs: string, dirRel: string): Promise<Entry[]> {
    const real = await fs.realpath(dirAbs).catch(() => null);
    if (!real || !isInside(base, real) || seen.has(real)) return [];
    seen.add(real);
    let ents;
    try {
      ents = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: Entry[] = [];
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
      if (!isDir && !isFile) continue;
      if (isIgnoredName(ent.name, root, isDir)) continue;
      if (isDir) out.push({ path: rel, name: ent.name, type: 'dir', children: await rec(abs, rel) });
      else out.push({ path: rel, name: ent.name, type: 'file' });
    }
    return sortEntries(out);
  }
  return rec(base, '');
}
