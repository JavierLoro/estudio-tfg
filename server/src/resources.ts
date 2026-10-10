import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { isInside, resolveSafe } from './paths.ts';
import { rev, walkFiles } from './fsutil.ts';
import { resolveAttachment } from './attachments.ts';
import { badRequest } from './errors.ts';

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

export interface ResourceWarning { path: string; message: string }

export async function listResources(cfg: Config): Promise<{ items: ResourceItem[]; warnings: ResourceWarning[] }> {
  const warnings: ResourceWarning[] = [];
  const scope = await resolveSafe(cfg, 'notes', cfg.resourcesSubdir);
  const files = await walkFiles(cfg, 'notes', { subdir: cfg.resourcesSubdir,
    onError: (path) => warnings.push({ path, message: 'No se pudo leer esta carpeta o enlace; revisa sus permisos' }),
  });
  const items: (ResourceItem & { _t: number })[] = [];
  for (const f of files) {
    if (!f.rel.toLowerCase().endsWith('.md')) continue;
    try {
      // Volver a validar por si un enlace cambió desde el recorrido.
      const r = await resolveSafe(cfg, 'notes', f.rel);
      if (!isInside(scope.abs, r.abs)) throw badRequest('Recurso fuera de la carpeta configurada');
      const [content, st] = await Promise.all([fs.readFile(r.abs, 'utf8'), fs.stat(r.abs)]);
      const item = itemFromContent(f.rel, content, st.mtime);
      const t = Date.parse(item.captured);
      items.push({ ...item, _t: Number.isNaN(t) ? st.mtimeMs : t });
    } catch {
      warnings.push({ path: f.rel, message: 'No se pudo leer este recurso; revisa sus permisos o si cambió de ruta' });
    }
  }
  items.sort((a, b) => b._t - a._t || b.path.localeCompare(a.path));
  return { items: items.map(({ _t, ...rest }) => rest), warnings };
}

export async function readResourceFile(cfg: Config, path: unknown) {
  const r = await resolveSafe(cfg, 'notes', path);
  if (!r.rel.toLowerCase().endsWith('.md')) throw badRequest('Solo archivos .md');
  const [bytes, st] = await Promise.all([fs.readFile(r.abs), fs.stat(r.abs)]);
  const content = bytes.toString('utf8');
  const { data } = parseFrontmatter(content);
  const attachment = await resolveAttachment(cfg, r.rel, asString(data.attachment));
  return { root: 'notes' as const, path: r.rel, content, rev: rev(bytes), mtime: st.mtimeMs, ...attachment };
}
