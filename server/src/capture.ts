import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Config } from './config.ts';
import { fetchPublicMetadata, type MetadataFetcher } from './metadataHttp.ts';
import { HttpError, badRequest } from './errors.ts';
import { yamlScalar } from './frontmatter.ts';
import { isReservedName, resolveSafe } from './paths.ts';

export const MAX_UPLOAD = 50 * 1024 * 1024;


function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO 8601 with the local UTC offset, e.g. 2026-10-06T10:00:00+02:00 */
export function localIso(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Sanitise a title for use as a file name (without extension). */
export function sanitizeTitle(t: string, max = 100, fallback = 'recurso'): string {
  let s = t
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|#^[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '');
  if (s.length > max) s = s.slice(0, max).replace(/[. ]+$/, '').trim();
  s ||= fallback;
  return isReservedName(s) ? s.replace(/^([^.]+)/, '$1 (recurso)') : s;
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  const ext = path.extname(base).replace(/[^A-Za-z0-9.]/g, '').slice(0, 16).replace(/\.+$/, '');
  const stem = sanitizeTitle(base.slice(0, base.length - path.extname(base).length), 100, 'adjunto');
  return `${stem}${ext.toLowerCase()}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => safeCp(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCp(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
function safeCp(n: number) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

export function extractTitle(html: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const m of metas) {
    if (/(?:property|name)\s*=\s*["']og:title["']/i.test(m)) {
      const c = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(m);
      const v = c ? decodeEntities(c[1] ?? c[2] ?? '').replace(/\s+/g, ' ').trim() : '';
      if (v) return v;
    }
  }
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (t) {
    const v = decodeEntities(t[1]).replace(/\s+/g, ' ').trim();
    if (v) return v;
  }
  return null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** Si la consulta falla, conservar un recurso manual con aviso. */
export async function fetchTitle(url: string, fetchMetadata: MetadataFetcher = fetchPublicMetadata): Promise<{ title: string; warning?: string }> {
  const fallback = hostOf(url) ?? 'Recurso';
  try {
    const response = await fetchMetadata(url);
    const title = extractTitle(response.body.toString('utf8'));
    return title ? { title } : { title: fallback, warning: 'No se encontró un título; completa el recurso manualmente' };
  } catch (e) {
    return { title: fallback, warning: `Recurso guardado sin consultar sus metadatos: ${e instanceof Error ? e.message : 'Error de conexión'}` };
  }
}

export function parseTags(v: unknown): string[] {
  const raw: string[] = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : [];
  const out: string[] = [];
  for (const t of raw) {
    const s = t.trim().replace(/^#+/, '').trim().replace(/\s+/g, '-');
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export interface CaptureInput {
  operationId?: string;
  libraryId?: string;
  url?: string;
  title?: string;
  note?: string;
  tags?: string[];
  /** Temp file already written to the attachments folder. */
  file?: { tmpAbs: string; filename: string };
}

export function buildResourceMarkdown(o: {
  title: string;
  url?: string;
  captured: string;
  tags: string[];
  attachment?: string;
  note?: string;
}): string {
  const lines = ['---', 'type: resource', `title: ${JSON.stringify(o.title)}`];
  if (o.url) lines.push(`url: ${yamlScalar(o.url)}`);
  lines.push(`captured: ${o.captured}`, 'status: inbox', 'tags:');
  for (const t of ['recurso', ...o.tags.filter((t) => t !== 'recurso')]) lines.push(`  - ${yamlScalar(t)}`);
  if (o.attachment) lines.push(`attachment: ${JSON.stringify(o.attachment)}`);
  lines.push('---', '');
  if (o.note && o.note.trim()) lines.push(o.note.replace(/\r\n/g, '\n').trimEnd(), '');
  return lines.join('\n');
}

/** Stream an upload to a hidden temp file in the attachments dir. */
export async function receiveUpload(cfg: Config, stream: Readable): Promise<string> {
  const dir = await attachmentsDir(cfg);
  const tmp = path.join(dir, `.upload-${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    await pipeline(stream, createWriteStream(tmp, { flags: 'wx' }));
  } catch (e: any) {
    await fs.rm(tmp, { force: true });
    if (e?.code === 'FST_REQ_FILE_TOO_LARGE' || e?.statusCode === 413) throw new HttpError(413, 'Adjunto demasiado grande (máx. 50 MB)');
    throw e;
  }
  return tmp;
}

async function attachmentsDir(cfg: Config): Promise<string> {
  const r = await resolveSafe(cfg, 'notes', `${cfg.resourcesSubdir}/adjuntos`);
  await fs.mkdir(r.abs, { recursive: true });
  return r.abs;
}

export async function prepareCapture(input: CaptureInput, fetchMetadata?: MetadataFetcher): Promise<{ title: string; url?: string; note?: string; warning?: string }> {
  const url = input.url?.trim() || undefined;
  const note = input.note?.trim() ? input.note : undefined;
  if (!url && !note && !input.file) throw badRequest('Indica al menos una URL, una nota o un archivo');

  let title = input.title?.replace(/\s+/g, ' ').trim() || '';
  let warning: string | undefined;
  if (!title && url) ({ title, warning } = await fetchTitle(url, fetchMetadata));
  if (!title && input.file) title = input.file.filename.replace(/\.[^.]+$/, '').trim();
  if (!title && note) title = note.trim().split(/\r?\n/)[0].replace(/^#+\s*/, '').slice(0, 80).trim();
  if (!title) title = 'Recurso';

  return { title, url, note, warning };
}
