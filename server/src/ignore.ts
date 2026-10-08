import { isSystemFile } from '../../scripts/system-files.mjs';
import type { RootName } from './paths.ts';

const LATEX_AUX = [
  '.aux', '.log', '.out', '.toc', '.lof', '.lot', '.lol', '.bbl', '.blg', '.bcf', '.run.xml', '.fls',
  '.fdb_latexmk', '.synctex.gz', '.synctex(busy)', '.acn', '.acr', '.alg',
];

export function isSyncConflict(name: string): boolean {
  return name.includes('.sync-conflict-');
}

/**
 * Whether a single path segment must be ignored (tree, search, watcher).
 * `isDir` undefined = unknown.
 */
export function isIgnoredName(name: string, root: RootName, isDir?: boolean): boolean {
  if (name.startsWith('.')) return true;
  if (isDir !== true && isSystemFile(name)) return true;
  if (name === 'node_modules') return true;
  if (name.endsWith('.lock')) return true;
  if (isSyncConflict(name)) return true;
  if (root === 'memoria') {
    if (name === 'build' && isDir !== false) return true;
    if (isDir !== true) {
      const lower = name.toLowerCase();
      if (LATEX_AUX.some((ext) => lower.endsWith(ext))) return true;
    }
  }
  return false;
}

/** Whether a root-relative path (with `/`) is ignored; non-final segments are directories. */
export function isIgnoredRel(rel: string, root: RootName, isDir?: boolean): boolean {
  if (rel === '' || rel === '.') return false;
  const segs = rel.split('/');
  return segs.some((s, i) => isIgnoredName(s, root, i < segs.length - 1 ? true : isDir));
}
