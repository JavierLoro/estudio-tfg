import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { isIgnoredName } from './ignore.ts';
import { resolveSafe } from './paths.ts';
import { rev } from './fsutil.ts';

export interface ResourceItem {
  path: string;
  title: string;
  url?: string;
  captured: string;
  status: string;
  tags: string[];
  attachment?: string;
  rev: string;
}

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function itemFromContent(rel: string, content: string, mtime: Date): ResourceItem {
  const { data } = parseFrontmatter(content);
  const tags = Array.isArray(data.tags)
    ? data.tags.map(String)
    : typeof data.tags === 'string'
      ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : [];
  const item: ResourceItem = {
    path: rel,
    title: asString(data.title)?.trim() || path.posix.basename(rel).replace(/\.md$/i, ''),
    captured: asString(data.captured) ?? mtime.toISOString(),
    status: asString(data.status) ?? 'inbox',
    tags,
    rev: rev(content),
  };
  const url = asString(data.url);
  if (url) item.url = url;
  const att = asString(data.attachment);
  if (att) item.attachment = att;
  return item;
}

export async function listResources(cfg: Config): Promise<ResourceItem[]> {
  const dir = await resolveSafe(cfg, 'notes', cfg.resourcesSubdir);
  if (!dir.exists) return [];
  const ents = await fs.readdir(dir.abs, { withFileTypes: true }).catch(() => []);
  const items: (ResourceItem & { _t: number })[] = [];
  for (const ent of ents) {
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.md')) continue;
    if (isIgnoredName(ent.name, 'notes', false)) continue;
    const abs = path.join(dir.abs, ent.name);
    try {
      const [content, st] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
      const item = itemFromContent(`${dir.rel}/${ent.name}`, content, st.mtime);
      const t = Date.parse(item.captured);
      items.push({ ...item, _t: Number.isNaN(t) ? st.mtimeMs : t });
    } catch {
      /* skip unreadable */
    }
  }
  items.sort((a, b) => b._t - a._t || b.path.localeCompare(a.path));
  return items.map(({ _t, ...rest }) => rest);
}
