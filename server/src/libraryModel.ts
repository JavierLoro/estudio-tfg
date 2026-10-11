import crypto from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';
import { badRequest, HttpError } from './errors.ts';
import { parseFrontmatter, setFrontmatterKeys, splitFrontmatter } from './frontmatter.ts';

export const RESOURCE_KINDS = ['article', 'book', 'document', 'image', 'web', 'note', 'other'] as const;
export type ResourceKind = typeof RESOURCE_KINDS[number];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Bibliography = { authority: 'library'; entryType: string; key?: string; fields: Record<string, string> }
  | { authority: 'manual'; path: string; key: string };
export interface LibraryData {
  version: 1;
  id: string;
  kind: ResourceKind;
  urls: string[];
  attachments: string[];
  collections: string[];
  provenance: { method: string; [key: string]: unknown };
  bibliography?: Bibliography;
  [key: string]: unknown;
}

export function inferKind(filename?: string, url?: string): ResourceKind {
  const ext = path.extname(filename ?? '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.avif'].includes(ext)) return 'image';
  if (filename) return 'document';
  return url ? 'web' : 'note';
}

export function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((v) => typeof v !== 'string' || v.length > 8192)) throw badRequest(`${field} debe ser una lista de textos (máximo 100)`);
  return [...new Set(value.map((v: string) => v.trim()).filter(Boolean))];
}
export function urls(value: unknown): string[] {
  return strings(value, 'urls').map((url) => {
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error();
      return url;
    } catch { throw badRequest('Las URLs deben ser HTTP/HTTPS y no contener credenciales'); }
  });
}
export function relativeAttachment(value: string): boolean {
  return !!value && !/[\0\\\r\n]/.test(value) && !value.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

export function validateBibliography(value: unknown): Bibliography | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Referencia bibliográfica no válida');
  const b = value as any;
  if (b.authority === 'manual' && typeof b.path === 'string' && /\.bib$/i.test(b.path) && typeof b.key === 'string' && b.key && !b.fields && !b.entryType) {
    if (!relativeAttachment(b.path) || b.path.split('/').includes('..')) throw badRequest('Ruta de bibliografía manual no válida');
    return b;
  }
  if (b.authority === 'library' && typeof b.entryType === 'string' && /^[A-Za-z]+$/.test(b.entryType) && b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields)
    && !Object.hasOwn(b.fields, 'title') && Object.values(b.fields).every((v) => typeof v === 'string') && (b.key === undefined || typeof b.key === 'string')) return b;
  throw badRequest('La referencia debe tener una única autoridad; el título se guarda en la ficha');
}

export function validateLibrary(value: unknown): LibraryData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Formato de biblioteca no válido');
  const data = value as LibraryData;
  if (data.version !== 1) throw new HttpError(422, 'Versión de ficha no soportada; no se modificó');
  if (typeof data.id !== 'string' || !UUID.test(data.id)) throw badRequest('Identidad de ficha no válida');
  if (!RESOURCE_KINDS.includes(data.kind)) throw badRequest('Tipo de recurso no válido');
  urls(data.urls);
  if (strings(data.attachments, 'attachments').some((v) => !relativeAttachment(v))) throw badRequest('Ruta de adjunto no válida');
  strings(data.collections, 'collections');
  if (!data.provenance || typeof data.provenance !== 'object' || typeof data.provenance.method !== 'string') throw badRequest('Procedencia no válida');
  validateBibliography(data.bibliography);
  return data;
}

export function libraryFromContent(content: string): LibraryData | null {
  const split = splitFrontmatter(content);
  if (split.yaml !== null) {
    try { YAML.parse(split.yaml); } catch { throw badRequest('El frontmatter de la ficha no es YAML válido'); }
  }
  const { data } = parseFrontmatter(content);
  return data.biblioteca === undefined ? null : validateLibrary(data.biblioteca);
}

export function newLibraryData(options: { id?: string; kind?: ResourceKind; urls?: string[]; attachments?: string[]; collections?: string[]; method?: string }): LibraryData {
  return validateLibrary({ version: 1, id: options.id ?? crypto.randomUUID(), kind: options.kind ?? inferKind(options.attachments?.[0], options.urls?.[0]),
    urls: options.urls ?? [], attachments: options.attachments ?? [], collections: options.collections ?? [], provenance: { method: options.method ?? 'manual' } });
}

/** Cambiar solo campos gestionados, conservando YAML ajeno y el cuerpo exacto si no se edita. */
export function updateLibraryContent(content: string, updates: Record<string, unknown>): string {
  const current = libraryFromContent(content);
  const common: Record<string, unknown> = {};
  for (const key of ['title', 'status', 'tags'] as const) if (updates[key] !== undefined) common[key] = updates[key];
  const changes = ['kind', 'urls', 'collections', 'bibliography', 'attachments'].filter((key) => updates[key] !== undefined);
  if (changes.length && !current) throw new HttpError(422, 'Actualiza el formato de esta ficha desde Biblioteca antes de editar esos campos');
  if (current && changes.length) {
    if (current.bibliography?.authority === 'manual' && updates.bibliography !== undefined) throw badRequest('Edita la bibliografía manual en su archivo .bib');
    const next = { ...current };
    for (const key of changes) next[key] = updates[key];
    if (current.bibliography?.authority === 'library' && (updates.bibliography as any)?.authority === 'library') {
      const incoming = updates.bibliography as Extract<Bibliography, {authority:'library'}>;
      next.bibliography = { ...current.bibliography, ...incoming, fields: { ...current.bibliography.fields, ...incoming.fields } };
    }
    common.biblioteca = validateLibrary(next);
  }
  let next = Object.keys(common).length ? setFrontmatterKeys(content, common) : content;
  if (updates.note !== undefined) {
    if (typeof updates.note !== 'string' || Buffer.byteLength(updates.note) > 2 * 1024 * 1024) throw badRequest('Nota no válida o demasiado grande');
    const split = splitFrontmatter(next);
    next = split.yaml === null ? updates.note : split.open + split.yaml + split.close + updates.note;
  }
  return next;
}
