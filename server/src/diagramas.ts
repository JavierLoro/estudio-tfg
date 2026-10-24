import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from './context.ts';
import { createEngine } from './engine/index.ts';
import { HttpError, badRequest, notFound } from './errors.ts';
import { atomicWrite, backup, rev, walkFiles } from './fsutil.ts';
import { resolveSafe } from './paths.ts';
import { stripComment } from './outline.ts';
import { checkDiagramDestination, readMeta, withMeta } from './diagramFiles.ts';
export { readMeta, withMeta, type DiagramaMeta } from './diagramFiles.ts';
import { treeKey } from './fileops.ts';
import { parseExcalidraw } from '../../shared/excalidraw.ts';
import { checkSvg } from '../../worker/svg.mjs';
import { instanceId } from './settings.ts';

// Diagramas de la memoria: fuente .mmd o .excalidraw en diagramas/ y figura
// exportada en figuras/diagramas/<nombre>.{pdf,svg}. El SVG lo dibuja el navegador; el
// motor lo convierte a PDF, o recibe la conversión del navegador. El SVG guardado lleva
// en un <metadata> la revisión que lo generó: así se sabe si está desactualizada.

export const DIAGRAMAS_DIR = 'diagramas';
export const FIGURAS_DIR = 'figuras/diagramas';
export const MAX_SVG_BYTES = 5 * 1024 * 1024;

export type EstadoDiagrama = 'sin-exportar' | 'exportado' | 'desactualizado';

export interface EstadoResponse {
  estado: EstadoDiagrama;
  pdf: string | null;
  svg: string | null;
  exportadoEn: string | null;
}

export interface EstadoItem extends EstadoResponse {
  formato: 'mermaid' | 'excalidraw';
  /** Ruta de la fuente editable. */
  path: string;
  /** `diagramas/<nombre>` sin extensión: lo que va en \includegraphics. */
  nombre: string;
  /** Dónde se incluye la figura en los .tex de la memoria. */
  usos: { file: string; line: number }[];
}

/** Fuente bajo diagramas/ → nombre sin extensión. */
export function diagramName(rel: string): string {
  if (!rel.startsWith(DIAGRAMAS_DIR + '/') || !/\.(mmd|excalidraw)$/i.test(rel)) {
    throw badRequest('El diagrama debe ser un archivo .mmd o .excalidraw dentro de diagramas/');
  }
  const name = rel.slice(DIAGRAMAS_DIR.length + 1).replace(/\.(mmd|excalidraw)$/i, '');
  if (!name || name.split('/').some((s) => !s || s.startsWith('.'))) throw badRequest('Nombre de diagrama no válido');
  return name;
}

export const figurePaths = (name: string) => ({ pdf: `${FIGURAS_DIR}/${name}.pdf`, svg: `${FIGURAS_DIR}/${name}.svg` });

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
    .filter((f) => f.rel.startsWith(DIAGRAMAS_DIR + '/') && /\.(mmd|excalidraw)$/i.test(f.rel))
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
    items.push({ path: f.rel, nombre, formato: /\.excalidraw$/i.test(f.rel) ? 'excalidraw' : 'mermaid', ...st, usos: uses.get(nombre) ?? [] });
  }
  return items;
}

/** SVG → PDF con el motor elegido. */
async function svgToPdf(ctx: Ctx, svg: string, browserPdf?: Buffer): Promise<Buffer> {
  return (await createEngine({ ...ctx.cfg })).svg2pdf(svg, browserPdf);
}

/** El PDF del navegador es un adjunto, nunca una ruta ni una fuente para ejecutar. */
function readBrowserPdf(value: unknown): Buffer | undefined {
  if (value === undefined) return undefined;
  const max = 10 * 1024 * 1024;
  if (typeof value !== 'string' || !value || value.length > Math.ceil(max / 3) * 4 ||
    value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw badRequest('pdf debe ser base64 válido de hasta 10 MB');
  const pdf = Buffer.from(value, 'base64');
  if (pdf.toString('base64') !== value || pdf.length > max || pdf.subarray(0, 5).toString('latin1') !== '%PDF-' || !/%%EOF\s*$/.test(pdf.subarray(-1024).toString('latin1')))
    throw badRequest('El adjunto no es un PDF válido de hasta 10 MB');
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
  const live = ctx;
  ctx = { ...ctx, cfg: { ...ctx.cfg } };
  const destination = instanceId(ctx.cfg);
  const check = () => { if ((b.instanceId !== undefined && b.instanceId !== destination) || instanceId(live.cfg) !== destination) throw new HttpError(409, 'El proyecto cambió durante la exportación; vuelve al destino original'); };
  check();
  if (typeof b.rev !== 'string' || !b.rev) throw badRequest('rev es obligatorio');
  const r = await resolveSafe(ctx.cfg, 'memoria', b.path);
  const name = diagramName(r.rel);
  const svgIn = checkSvgBasic(b.svg);
  const browserPdf = readBrowserPdf(b.pdf);
  const src = await readOrNull(r.abs);
  if (!src) throw notFound('El diagrama no existe');
  const conflict = (cur: string) => ({ status: 409 as const, body: { error: 'La fuente del diagrama cambió desde que se dibujó', rev: cur } });
  if (rev(src) !== b.rev) return conflict(rev(src));
  await checkDiagramDestination(ctx.cfg, 'memoria', r.rel);
  const excalidraw = /\.excalidraw$/i.test(r.rel);
  if (excalidraw) {
    try { parseExcalidraw(src.toString('utf8')); } catch (e) { throw badRequest((e as Error).message); }
    const error = checkSvg(svgIn);
    if (error) throw badRequest(error);
    if (!browserPdf) throw badRequest('El dibujo Excalidraw necesita su PDF preparado por el editor');
  }

  const exportadoEn = new Date().toISOString();
  const svg = withMeta(svgIn, { fuente: r.rel, rev: b.rev, exportadoEn });
  // La conversión (lo lento) va fuera de los bloqueos; la revisión se vuelve a comprobar al escribir.
  const pdf = excalidraw ? browserPdf! : await svgToPdf(ctx, svg, browserPdf);
  const p = figurePaths(name);
  const { locks } = ctx;
  return locks.run(treeKey('memoria'), () => locks.run(`memoria:${r.rel}`, () =>
    locks.run(`memoria:${p.pdf}`, () =>
      locks.run(`memoria:${p.svg}`, async () => {
        const now = await readOrNull(r.abs);
        check();
        if (!now) throw notFound('El diagrama no existe');
        if (rev(now) !== b.rev) return conflict(rev(now));
        await checkDiagramDestination(ctx.cfg, 'memoria', r.rel);
        const dir = await resolveSafe(ctx.cfg, 'memoria', path.posix.dirname(p.pdf));
        await fs.mkdir(dir.abs, { recursive: true });
        // El PDF primero: el SVG (con el registro) se escribe al final, así un fallo a medias
        // deja la figura como «desactualizada», nunca como exportada sin su PDF.
        await writeFigure(ctx, p.pdf, pdf);
        await writeFigure(ctx, p.svg, Buffer.from(svg, 'utf8'));
        return { status: 200 as const, body: { pdf: p.pdf, svg: p.svg, exportadoEn } };
      }),
    ),
  ));
}
