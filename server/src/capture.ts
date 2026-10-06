import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Config } from './config.ts';
import { HttpError, badRequest } from './errors.ts';
import { createExclusive, linkExclusive } from './fsutil.ts';
import { yamlScalar } from './frontmatter.ts';
import { resolveSafe } from './paths.ts';

export const MAX_UPLOAD = 50 * 1024 * 1024;
const TITLE_TIMEOUT_MS = 4000;
const TITLE_MAX_BYTES = 1024 * 1024;

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
  return s || fallback;
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  const ext = path.extname(base).replace(/[^A-Za-z0-9.]/g, '').slice(0, 16);
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

/** Fetch the page title (og:title or <title>), 4 s timeout, 1 MB max. Falls back to the host. */
export async function fetchTitle(url: string): Promise<string> {
  const fallback = hostOf(url) ?? url.slice(0, 80);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return fallback;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TITLE_TIMEOUT_MS);
  try {
    const res = await fetch(u, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (EstudioTFG capture)', accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok || !res.body) return fallback;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < TITLE_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      // Stop early once the head has been read.
      if (/<\/head>/i.test(Buffer.from(value).toString('latin1'))) break;
    }
    reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).subarray(0, TITLE_MAX_BYTES).toString('utf8');
    return extractTitle(html) ?? fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
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

function withSuffix(stem: string, ext: string, n: number) {
  return n === 1 ? `${stem}${ext}` : `${stem} ${n}${ext}`;
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

async function resourcesDir(cfg: Config): Promise<{ abs: string; rel: string }> {
  const r = await resolveSafe(cfg, 'notes', cfg.resourcesSubdir);
  await fs.mkdir(r.abs, { recursive: true });
  return { abs: r.abs, rel: r.rel };
}

async function attachmentsDir(cfg: Config): Promise<string> {
  const r = await resolveSafe(cfg, 'notes', `${cfg.resourcesSubdir}/adjuntos`);
  await fs.mkdir(r.abs, { recursive: true });
  return r.abs;
}

export async function capture(cfg: Config, input: CaptureInput, now = new Date()): Promise<{ path: string; title: string }> {
  const url = input.url?.trim() || undefined;
  const note = input.note?.trim() ? input.note : undefined;
  if (!url && !note && !input.file) throw badRequest('Indica al menos una URL, una nota o un archivo');

  let title = input.title?.replace(/\s+/g, ' ').trim() || '';
  if (!title && url) title = await fetchTitle(url);
  if (!title && input.file) title = input.file.filename.replace(/\.[^.]+$/, '').trim();
  if (!title && note) title = note.trim().split(/\r?\n/)[0].replace(/^#+\s*/, '').slice(0, 80).trim();
  if (!title) title = 'Recurso';

  const res = await resourcesDir(cfg);
  let attachment: string | undefined;
  try {
    if (input.file) {
      const dir = await attachmentsDir(cfg);
      const clean = sanitizeFilename(input.file.filename || 'adjunto');
      const ext = path.extname(clean);
      const stem = clean.slice(0, clean.length - ext.length) || 'adjunto';
      for (let n = 1; ; n++) {
        const name = withSuffix(stem, ext, n);
        if (await linkExclusive(input.file.tmpAbs, path.join(dir, name))) {
          attachment = `adjuntos/${name}`;
          break;
        }
        if (n > 1000) throw new Error('Demasiadas colisiones de nombre');
      }
    }
  } finally {
    if (input.file) await fs.rm(input.file.tmpAbs, { force: true });
  }

  const md = buildResourceMarkdown({
    title,
    url,
    captured: localIso(now),
    tags: input.tags ?? [],
    attachment,
    note,
  });
  const stem = `${localDate(now)} ${sanitizeTitle(title)}`;
  for (let n = 1; ; n++) {
    const name = withSuffix(stem, '.md', n);
    if (await createExclusive(path.join(res.abs, name), md)) {
      return { path: `${res.rel}/${name}`, title };
    }
    if (n > 1000) throw new Error('Demasiadas colisiones de nombre');
  }
}
