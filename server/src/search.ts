import type { Config } from './config.ts';
import { isTextPath, walkFiles } from './fsutil.ts';
import { readText } from './notes.ts';
import type { RootName } from './paths.ts';

/** Lowercase + strip diacritics, keeping a map from normalised index to original index. */
export function fold(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const n = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < n.length; k++) map.push(i);
    text += n;
    i += ch.length;
  }
  map.push(i);
  return { text, map };
}

export function foldSimple(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export interface SearchItem {
  root: RootName;
  path: string;
  line: number;
  snippet: string;
}

export const SEARCH_MAX = 200;

function snippetAround(line: string, origIdx: number, max = 200): string {
  const trimmed = line.replace(/\t/g, ' ');
  if (trimmed.length <= max) return trimmed.trim();
  const start = Math.max(0, Math.min(origIdx - 60, trimmed.length - max));
  const s = trimmed.slice(start, start + max).trim();
  return (start > 0 ? '…' : '') + s + (start + max < trimmed.length ? '…' : '');
}

export async function search(cfg: Config, q: string, roots: RootName[]): Promise<SearchItem[]> {
  const needle = foldSimple(q.trim());
  if (!needle) return [];
  const items: SearchItem[] = [];
  for (const root of roots) {
    const files = await walkFiles(cfg, root);
    files.sort((a, b) => a.rel.localeCompare(b.rel, 'es'));
    // Filename matches first.
    for (const f of files) {
      if (items.length >= SEARCH_MAX) return items;
      const name = f.rel.split('/').pop()!;
      if (foldSimple(name).includes(needle)) items.push({ root, path: f.rel, line: 1, snippet: name });
    }
    for (const f of files) {
      if (!isTextPath(f.rel)) continue;
      const content = await readText(f.abs);
      if (content === null) continue;
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (items.length >= SEARCH_MAX) return items;
        const { text, map } = fold(lines[i]);
        const idx = text.indexOf(needle);
        if (idx >= 0) items.push({ root, path: f.rel, line: i + 1, snippet: snippetAround(lines[i], map[idx]) });
      }
    }
  }
  return items;
}
