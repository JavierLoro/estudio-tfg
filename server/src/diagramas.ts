import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from './context.ts';
import { HttpError, badRequest, notFound } from './errors.ts';
import { atomicWrite, backup, rev, walkFiles } from './fsutil.ts';
import { resolveSafe } from './paths.ts';
import { stripComment } from './outline.ts';

// Diagramas de la memoria (v0.8): fuente Mermaid en diagramas/<nombre>.mmd y figura
// exportada en figuras/diagramas/<nombre>.{pdf,svg}. El SVG lo dibuja el navegador; el
// worker lo convierte a PDF (POST /svg2pdf). El SVG guardado lleva en un <metadata> la
// revisión de la fuente que lo generó: así se sabe si la figura está desactualizada.

export const DIAGRAMAS_DIR = 'diagramas';
export const FIGURAS_DIR = 'figuras/diagramas';
export const MAX_SVG_BYTES = 5 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 60_000;
const META_ID = 'estudio-tfg-diagrama';

export type EstadoDiagrama = 'sin-exportar' | 'exportado' | 'desactualizado';

export interface DiagramaMeta {
  fuente: string;
  rev: string;
  exportadoEn: string;
}

export interface EstadoResponse {
  estado: EstadoDiagrama;
  pdf: string | null;
  svg: string | null;
  exportadoEn: string | null;
}

export interface EstadoItem extends EstadoResponse {
  /** Ruta del .mmd. */
  path: string;
  /** `diagramas/<nombre>` sin extensión: lo que va en \includegraphics. */
  nombre: string;
  /** Dónde se incluye la figura en los .tex de la memoria. */
  usos: { file: string; line: number }[];
}

/** `diagramas/a/b.mmd` → `a/b`. 400 si no es un .mmd dentro de diagramas/. */
export function diagramName(rel: string): string {
  if (!rel.startsWith(DIAGRAMAS_DIR + '/') || !/\.mmd$/i.test(rel)) {
    throw badRequest('El diagrama debe ser un archivo .mmd dentro de diagramas/');
  }
  const name = rel.slice(DIAGRAMAS_DIR.length + 1).replace(/\.mmd$/i, '');
  if (!name || name.split('/').some((s) => !s || s.startsWith('.'))) throw badRequest('Nombre de diagrama no válido');
  return name;
}

export const figurePaths = (name: string) => ({ pdf: `${FIGURAS_DIR}/${name}.pdf`, svg: `${FIGURAS_DIR}/${name}.svg` });

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const META_RE = new RegExp(`<metadata\\s+id="${META_ID}"[^>]*>([\\s\\S]*?)</metadata>`, 'g');

/** Registro de exportación del SVG (o null si no lo tiene). */
export function readMeta(svg: string): DiagramaMeta | null {
  META_RE.lastIndex = 0;
  const m = META_RE.exec(svg);
  if (!m) return null;
  try {
    const v = JSON.parse(unescXml(m[1]));
    if (typeof v?.rev === 'string' && typeof v?.fuente === 'string') {
      return { fuente: v.fuente, rev: v.rev, exportadoEn: typeof v.exportadoEn === 'string' ? v.exportadoEn : '' };
    }
  } catch {
    /* metadatos ilegibles */
  }
  return null;
}

/** Inserta (o sustituye) el registro justo después de la etiqueta de apertura <svg …>. */
export function withMeta(svg: string, meta: DiagramaMeta): string {
  const clean = svg.replace(META_RE, '');
  const m = /<svg[\s>][^>]*>/.exec(clean);
  if (!m) throw badRequest('No es un SVG');
  const tag = m[0].endsWith('/>') ? null : m[0];
  if (!tag) throw badRequest('El SVG está vacío');
  const el = `<metadata id="${META_ID}">${escXml(JSON.stringify(meta))}</metadata>`;
  const at = m.index + tag.length;
  return clean.slice(0, at) + el + clean.slice(at);
}

/** Comprobación básica (el worker hace la completa y responde 400 con el motivo). */
export function checkSvgBasic(svg: unknown): string {
  if (typeof svg !== 'string' || !svg.trim()) throw badRequest('svg es obligatorio');
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES) throw badRequest('El SVG supera el máximo de 5 MB');
  const head = svg.replace(/^﻿/, '').replace(/^(\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->)*/, '');
  if (!/^<svg[\s>]/.test(head)) throw badRequest('No es un SVG válido (la raíz debe ser <svg>)');
  if (/<foreignObject[\s>]/i.test(svg)) throw badRequest('El SVG contiene etiquetas HTML (foreignObject): no se puede convertir fielmente a PDF');
  return svg;
}

async function readOrNull(abs: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(abs);
  } catch (e: any) {
    if (e?.code === 'ENOENT' || e?.code === 'EISDIR' || e?.code === 'ENOTDIR') return null;
    throw e;
  }
}

/** Estado de la figura de un .mmd dado su contenido actual. */
async function estadoDe(ctx: Ctx, name: string, sourceRev: string): Promise<EstadoResponse> {
  const p = figurePaths(name);
  const [svgR, pdfR] = await Promise.all([resolveSafe(ctx.cfg, 'memoria', p.svg), resolveSafe(ctx.cfg, 'memoria', p.pdf)]);
  const [svgBuf, pdfBuf] = await Promise.all([readOrNull(svgR.abs), pdfR.exists ? fs.stat(pdfR.abs).then((s) => (s.isFile() ? true : null), () => null) : null]);
  if (!svgBuf || !pdfBuf) return { estado: 'sin-exportar', pdf: pdfBuf ? p.pdf : null, svg: svgBuf ? p.svg : null, exportadoEn: null };
  const meta = readMeta(svgBuf.toString('utf8'));
  // Sin registro (SVG puesto a mano o de otra herramienta): no se sabe de qué versión es.
  return { estado: meta?.rev === sourceRev ? 'exportado' : 'desactualizado', pdf: p.pdf, svg: p.svg, exportadoEn: meta?.exportadoEn || null };
}

export async function estado(ctx: Ctx, relInput: unknown): Promise<EstadoResponse> {
  const r = await resolveSafe(ctx.cfg, 'memoria', relInput);
  const name = diagramName(r.rel);
  const src = await readOrNull(r.abs);
  if (!src) throw notFound('El diagrama no existe');
  return estadoDe(ctx, name, rev(src));
}

const INCLUDEGRAPHICS_RE = /\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)*\{([^{}]+)\}/g;

/** `figuras/diagramas/x.pdf`, `./diagramas/x` → `diagramas/x` (lo que resuelve \graphicspath). */
function graphicTarget(arg: string): string {
  let t = arg.trim().replace(/^\.\//, '');
  if (t.startsWith('figuras/')) t = t.slice('figuras/'.length);
  return t.replace(/\.(pdf|svg|png)$/i, '');
}

/** \includegraphics de cada figura de diagramas: `diagramas/<nombre>` → usos. */
async function figureUses(ctx: Ctx): Promise<Map<string, { file: string; line: number }[]>> {
  const out = new Map<string, { file: string; line: number }[]>();
  const files = (await walkFiles(ctx.cfg, 'memoria')).filter((f) => /\.tex$/i.test(f.rel));
  for (const f of files) {
    let text: string;
    try {
      const st = await fs.stat(f.abs);
      if (st.size > 2 * 1024 * 1024) continue;
      text = await fs.readFile(f.abs, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('diagramas/')) continue;
    text.split(/\r?\n/).forEach((raw, i) => {
      const line = stripComment(raw);
      for (const m of line.matchAll(INCLUDEGRAPHICS_RE)) {
        const t = graphicTarget(m[1]);
        if (!t.startsWith(DIAGRAMAS_DIR + '/')) continue;
        const list = out.get(t) ?? [];
        list.push({ file: f.rel, line: i + 1 });
        out.set(t, list);
      }
    });
  }
  return out;
}

/** Todos los diagramas de la memoria con su estado y dónde se usan. */
export async function listEstados(ctx: Ctx): Promise<EstadoItem[]> {
  const files = (await walkFiles(ctx.cfg, 'memoria'))
    .filter((f) => f.rel.startsWith(DIAGRAMAS_DIR + '/') && /\.mmd$/i.test(f.rel))
    .sort((a, b) => a.rel.localeCompare(b.rel, 'es'));
  const uses = files.length ? await figureUses(ctx) : new Map();
  const items: EstadoItem[] = [];
  for (const f of files) {
    let name: string;
    try {
      name = diagramName(f.rel);
    } catch {
      continue;
    }
    const src = await readOrNull(f.abs);
    if (!src) continue;
    const st = await estadoDe(ctx, name, rev(src));
    const nombre = `${DIAGRAMAS_DIR}/${name}`;
    items.push({ path: f.rel, nombre, ...st, usos: uses.get(nombre) ?? [] });
  }
  return items;
}

/** SVG → PDF con el worker. */
async function svgToPdf(ctx: Ctx, svg: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(`${ctx.cfg.workerUrl}/svg2pdf`, {
      method: 'POST',
      headers: { 'content-type': 'image/svg+xml' },
      body: svg,
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(503, 'Worker de compilación no disponible: no se puede convertir el diagrama a PDF');
  }
  if (!res.ok) {
    let msg = `el worker respondió ${res.status}`;
    try {
      const b = (await res.json()) as { error?: unknown };
      if (typeof b?.error === 'string') msg = b.error;
    } catch {
      /* sin JSON */
    }
    if (res.status === 400 || res.status === 413) throw badRequest(`SVG no válido: ${msg}`);
    if (res.status === 404) throw new HttpError(503, 'El worker no sabe convertir diagramas: reconstrúyelo (npm run worker)');
    throw new HttpError(502, `No se pudo convertir el diagrama a PDF: ${msg}`);
  }
  const pdf = Buffer.from(await res.arrayBuffer());
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(502, 'El worker no devolvió un PDF');
  return pdf;
}

/** Escribe un archivo de la memoria con copia en el historial (si existía y cambia) y de forma atómica. */
async function writeFigure(ctx: Ctx, rel: string, data: Buffer): Promise<void> {
  const r = await resolveSafe(ctx.cfg, 'memoria', rel);
  const cur = await readOrNull(r.abs);
  if (cur?.equals(data)) return;
  if (cur) await backup(ctx.cfg, 'memoria', r.rel, cur);
  await atomicWrite(r.abs, data);
}

export async function exportar(ctx: Ctx, body: unknown): Promise<{ status: 200 | 409; body: Record<string, unknown> }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.rev !== 'string' || !b.rev) throw badRequest('rev es obligatorio');
  const r = await resolveSafe(ctx.cfg, 'memoria', b.path);
  const name = diagramName(r.rel);
  const svgIn = checkSvgBasic(b.svg);
  const src = await readOrNull(r.abs);
  if (!src) throw notFound('El diagrama no existe');
  const conflict = (cur: string) => ({ status: 409 as const, body: { error: 'La fuente del diagrama cambió desde que se dibujó', rev: cur } });
  if (rev(src) !== b.rev) return conflict(rev(src));

  const exportadoEn = new Date().toISOString();
  const svg = withMeta(svgIn, { fuente: r.rel, rev: b.rev, exportadoEn });
  // La conversión (lo lento) va fuera de los bloqueos; la revisión se vuelve a comprobar al escribir.
  const pdf = await svgToPdf(ctx, svg);
  const p = figurePaths(name);
  const { locks } = ctx;
  return locks.run(`memoria:${r.rel}`, () =>
    locks.run(`memoria:${p.pdf}`, () =>
      locks.run(`memoria:${p.svg}`, async () => {
        const now = await readOrNull(r.abs);
        if (!now) throw notFound('El diagrama no existe');
        if (rev(now) !== b.rev) return conflict(rev(now));
        const dir = await resolveSafe(ctx.cfg, 'memoria', path.posix.dirname(p.pdf));
        await fs.mkdir(dir.abs, { recursive: true });
        // El PDF primero: el SVG (con el registro) se escribe al final, así un fallo a medias
        // deja la figura como «desactualizada», nunca como exportada sin su PDF.
        await writeFigure(ctx, p.pdf, pdf);
        await writeFigure(ctx, p.svg, Buffer.from(svg, 'utf8'));
        return { status: 200 as const, body: { pdf: p.pdf, svg: p.svg, exportadoEn } };
      }),
    ),
  );
}
