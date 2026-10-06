import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.ts';

/** Strip alias (`|`) and heading/block refs (`#`, `^`) from a wikilink target. */
export function cleanTarget(target: string): string {
  let t = target.trim();
  t = t.replace(/^\[\[|\]\]$/g, '');
  const pipe = t.indexOf('|');
  if (pipe >= 0) t = t.slice(0, pipe);
  const hash = t.indexOf('#');
  if (hash >= 0) t = t.slice(0, hash);
  t = t.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '');
  return t;
}

/**
 * Resolve a wikilink Obsidian-style against a list of root-relative file paths.
 * Exact path first (with or without `.md`), then by filename (case-insensitive),
 * also allowing partial folder suffix matches. Shortest path wins on ties.
 */
export function resolveWikilink(rawTarget: string, files: string[], fromPath?: string): string | null {
  const t = cleanTarget(rawTarget);
  if (!t) return null;
  const set = new Set(files);
  const hasMd = t.toLowerCase().endsWith('.md');
  const candidates = hasMd || path.posix.extname(t) ? [t, `${t}.md`] : [`${t}.md`, t];

  // 1. Exact path from root.
  for (const c of candidates) if (set.has(c)) return c;
  // 1b. Relative to the linking note's folder.
  if (fromPath) {
    const dir = path.posix.dirname(fromPath);
    if (dir && dir !== '.') {
      for (const c of candidates) {
        const p = path.posix.normalize(`${dir}/${c}`);
        if (set.has(p)) return p;
      }
    }
  }
  // 2. Case-insensitive exact path.
  const lowerCands = candidates.map((c) => c.toLowerCase());
  const byLower = files.filter((f) => lowerCands.includes(f.toLowerCase()));
  if (byLower.length) return shortest(byLower);
  // 3. Suffix match (by filename, or folder/filename), case-insensitive.
  const suffix = files.filter((f) => {
    const lf = f.toLowerCase();
    return lowerCands.some((c) => lf.endsWith('/' + c));
  });
  if (suffix.length) return shortest(suffix);
  return null;
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
