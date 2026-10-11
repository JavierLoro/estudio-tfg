import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { isInside, resolveSafe } from './paths.ts';
import { rev, walkFiles } from './fsutil.ts';
import { resolveAttachment } from './attachments.ts';
import { badRequest } from './errors.ts';
import { inferKind, libraryFromContent, type Bibliography, type ResourceKind } from './libraryModel.ts';

export interface ResourceItem {
  path: string;
  title: string;
  url?: string;
  captured: string;
  status: string;
  tags: string[];
  attachment?: string;
  rev: string;
  id: string | null;
  schemaVersion: 0 | 1;
  kind: ResourceKind;
  urls: string[];
  attachments: string[];
  collections: string[];
  bibliography?: Bibliography;
  provenance?: Record<string, unknown>;
  note: string;
  libraryError?: string;
  thumbnailPath?: string;
}

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function itemFromContent(rel: string, content: string, mtime: Date): ResourceItem {
  const { data, body } = parseFrontmatter(content);
  let library = null;
  let libraryError: string | undefined;
  try { library = libraryFromContent(content); }
  catch (e) { libraryError = e instanceof Error ? e.message : 'Formato de ficha no válido'; }
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
    id: library?.id ?? null,
    schemaVersion: library ? 1 : 0,
    kind: library?.kind ?? inferKind(asString(data.attachment), asString(data.url)),
    urls: library?.urls ?? (asString(data.url) ? [asString(data.url)!] : []),
    attachments: library?.attachments ?? (asString(data.attachment) ? [asString(data.attachment)!] : []),
    collections: library?.collections ?? [],
    bibliography: library?.bibliography,
    provenance: library?.provenance,
    note: body,
    ...(libraryError ? { libraryError } : {}),
  };
  const url = item.urls[0];
  if (url) item.url = url;
  const att = item.attachments[0];
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
      if (item.libraryError) warnings.push({ path: f.rel, message: item.libraryError });
      const image = item.attachments.find((p) => /\.(png|jpe?g|svg|webp|gif|avif)$/i.test(p));
      if (image) {
        const found = await resolveAttachment(cfg, f.rel, image, item.schemaVersion === 1);
        if (found.attachmentPath) item.thumbnailPath = found.attachmentPath;
      }
      const t = Date.parse(item.captured);
      items.push({ ...item, _t: Number.isNaN(t) ? st.mtimeMs : t });
    } catch {
      warnings.push({ path: f.rel, message: 'No se pudo leer este recurso; revisa sus permisos o si cambió de ruta' });
    }
  }
  items.sort((a, b) => b._t - a._t || b.path.localeCompare(a.path));
  const ids = new Map<string, ResourceItem[]>();
  for (const item of items) if (item.id) ids.set(item.id, [...(ids.get(item.id) ?? []), item]);
  for (const group of ids.values()) if (group.length > 1) for (const item of group) {
    item.libraryError = 'Identidad duplicada; revisa las fichas antes de editarlas';
    warnings.push({ path: item.path, message: item.libraryError });
  }
  return { items: items.map(({ _t, ...rest }) => rest), warnings };
}

export async function readResourceFile(cfg: Config, inputPath: unknown) {
  const r = await resolveSafe(cfg, 'notes', inputPath);
  if (!r.rel.toLowerCase().endsWith('.md')) throw badRequest('Solo archivos .md');
  const [bytes, st] = await Promise.all([fs.readFile(r.abs), fs.stat(r.abs)]);
  const content = bytes.toString('utf8');
  const item = itemFromContent(r.rel, content, st.mtime);
  const attachments = await Promise.all(item.attachments.map(async (value) => {
    const result = await resolveAttachment(cfg, r.rel, value, item.schemaVersion === 1);
    return { name: path.posix.basename(value), value, path: result.attachmentPath, warning: result.attachmentWarning };
  }));
  return { root: 'notes' as const, path: r.rel, content, rev: rev(bytes), mtime: st.mtimeMs, item, attachments,
    attachmentPath: attachments[0]?.path ?? null, ...(attachments[0]?.warning ? { attachmentWarning: attachments[0].warning } : {}) };
}
