import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.ts';

/** Strip alias (`|`) and heading/block refs (`#`, `^`) from a wikilink target. */
export function cleanTarget(target: string): string {
  let t = target.trim();
  t = t.replace(/^\[\[|\]\]$/g, '');
  const pipe = t.indexOf('|');
  if (pipe >= 0) t = t.slice(0, pipe);
  const hash = t.search(/[#^]/);
  if (hash >= 0) t = t.slice(0, hash);
  t = t.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '');
  return t;
}

/** Clave de comparación; nunca se usa como ruta de disco. */
export const nameKey = (s: string) => s.normalize('NFC').toLowerCase();

export type Resolver = (rawTarget: string, fromPath?: string) => string | null;

/**
 * Resolver Obsidian-style over a fixed list of root-relative file paths (indexed,
 * for resolving many links). Exact path first (with or without `.md`), then
 * relative to the linking note's folder, then by filename (case-insensitive),
 * also allowing partial folder suffix matches. Shortest path wins on ties.
 */
export function makeResolver(files: string[]): Resolver {
  const set = new Set(files);
  const byNormalized = new Map<string, string[]>();
  const byLower = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, f: string) => {
    const l = m.get(k);
    if (l) l.push(f);
    else m.set(k, [f]);
  };
  for (const f of files) {
    push(byNormalized, f.normalize('NFC'), f);
    const lf = nameKey(f);
    push(byLower, lf, f);
    push(byBase, lf.slice(lf.lastIndexOf('/') + 1), f);
  }
  return (rawTarget, fromPath) => {
    const t = cleanTarget(rawTarget);
    if (!t) return null;
    const hasMd = t.toLowerCase().endsWith('.md');
    const candidates = hasMd || path.posix.extname(t) ? [t, `${t}.md`] : [`${t}.md`, t];

    // 1. Exact path from root.
    for (const c of candidates) if (set.has(c)) return c;
    const normalized = candidates.flatMap((c) => byNormalized.get(c.normalize('NFC')) ?? []);
    if (normalized.length) return shortest(normalized);
    // 1b. Relative to the linking note's folder.
    if (fromPath) {
      const dir = path.posix.dirname(fromPath);
      if (dir && dir !== '.') {
        for (const c of candidates) {
          const p = path.posix.normalize(`${dir}/${c}`);
          if (set.has(p)) return p;
          const matches = byNormalized.get(p.normalize('NFC'));
          if (matches?.length) return shortest(matches);
        }
      }
    }
    // 2. Case-insensitive exact path.
    const lowerCands = candidates.map(nameKey);
    const exact = lowerCands.flatMap((c) => byLower.get(c) ?? []);
    if (exact.length) return shortest(exact);
    // 3. Suffix match (by filename, or folder/filename), case-insensitive.
    const suffix = new Set<string>();
    for (const c of lowerCands) {
      for (const f of byBase.get(c.slice(c.lastIndexOf('/') + 1)) ?? []) {
        if (nameKey(f).endsWith('/' + c)) suffix.add(f);
      }
    }
    if (suffix.size) return shortest([...suffix]);
    return null;
  };
}

/** Resolve a wikilink against a list of root-relative file paths (see makeResolver). */
export function resolveWikilink(rawTarget: string, files: string[], fromPath?: string): string | null {
  return makeResolver(files)(rawTarget, fromPath);
}

function shortest(list: string[]): string {
  return [...list].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length || a.localeCompare(b))[0];
}

const WIKILINK_RE = /!?\[\[([^\]\n]+?)\]\]/g;
const MDLINK_RE = /\[[^\]\n]*\]\(([^)\s]+\.md)(?:#[^)]*)?\)/gi;

export interface LinkHit {
  target: string;
  line: string;
  kind: 'wiki' | 'md';
}

export function extractLinks(content: string): LinkHit[] {
  const hits: LinkHit[] = [];
  for (const line of content.split(/\r?\n/)) {
    for (const m of line.matchAll(WIKILINK_RE)) hits.push({ target: m[1], line, kind: 'wiki' });
    for (const m of line.matchAll(MDLINK_RE)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      let t = m[1];
      try {
        t = decodeURIComponent(t);
      } catch {
        /* keep raw */
      }
      hits.push({ target: t, line, kind: 'md' });
    }
  }
  return hits;
}

export function noteTitle(rel: string, content: string): string {
  const { data, body } = parseFrontmatter(content);
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim();
  const h = /^#\s+(.+)$/m.exec(body);
  if (h) return h[1].trim();
  return path.posix.basename(rel).replace(/\.md$/i, '');
}

export function makeSnippet(line: string, max = 200): string {
  const t = line.trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export async function readText(abs: string, maxBytes = 2 * 1024 * 1024): Promise<string | null> {
  try {
    const st = await fs.stat(abs);
    if (!st.isFile() || st.size > maxBytes) return null;
    return await fs.readFile(abs, 'utf8');
  } catch {
    return null;
  }
}
