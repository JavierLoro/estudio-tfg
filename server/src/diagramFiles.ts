import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import type { Ctx } from './context.ts';
import { atomicWrite, backup } from './fsutil.ts';
import { HttpError } from './errors.ts';
import { resolveSafe, type RootName } from './paths.ts';

export const diagramSource = (rel: string) => rel.startsWith('diagramas/') && /\.(mmd|excalidraw)$/i.test(rel);
export interface DiagramaMeta { fuente: string; rev: string; exportadoEn: string }
export function readMeta(svg: string): DiagramaMeta | null {
  const raw = /<metadata\s+id="estudio-tfg-diagrama"[^>]*>([\s\S]*?)<\/metadata>/.exec(svg)?.[1];
  if (!raw) return null;
  try {
    const value = JSON.parse(raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
    return typeof value?.fuente === 'string' && typeof value?.rev === 'string'
      ? { fuente: value.fuente, rev: value.rev, exportadoEn: typeof value.exportadoEn === 'string' ? value.exportadoEn : '' } : null;
  } catch { return null; }
}
export function withMeta(svg: string, meta: DiagramaMeta): string {
  const clean = svg.replace(/<metadata\s+id="estudio-tfg-diagrama"[^>]*>[\s\S]*?<\/metadata>/g, '');
  const tag = /<svg[\s>][^>]*>/.exec(clean);
  if (!tag || tag[0].endsWith('/>')) throw new HttpError(400, 'No es un SVG válido');
  const text = JSON.stringify(meta).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const at = tag.index + tag[0].length;
  return clean.slice(0, at) + `<metadata id="estudio-tfg-diagrama">${text}</metadata>` + clean.slice(at);
}

/** El SVG conserva su propietario cuando la fuente cambia de nombre. */
export async function moveDiagramOwner(ctx: Ctx, from: string, to: string) {
  if (!diagramSource(from) || !diagramSource(to)) return;
  const rel = 'figuras/' + from.replace(/\.(mmd|excalidraw)$/i, '.svg');
  const file = await resolveSafe(ctx.cfg, 'memoria', rel);
  if (!file.exists) return;
  await ctx.locks.run(`memoria:${rel}`, async () => {
    const before = await fs.readFile(file.abs), meta = readMeta(before.toString('utf8'));
    if (meta?.fuente !== from) return;
    await backup(ctx.cfg, 'memoria', rel, before);
    await atomicWrite(file.abs, withMeta(before.toString('utf8'), { ...meta, fuente: to }));
  });
}

/** Los dos formatos comparten la figura de LaTeX; nunca pueden apropiarse del mismo nombre. */
export async function checkDiagramDestination(cfg: Config, root: RootName, rel: string, exclude?: string) {
  if (root !== 'memoria' || !diagramSource(rel)) return;
  const dir = path.posix.dirname(rel), base = path.posix.basename(rel).replace(/\.(mmd|excalidraw)$/i, '').normalize('NFC').toLowerCase();
  const parent = await resolveSafe(cfg, root, dir);
  const names = parent.exists ? await fs.readdir(parent.abs) : [];
  if (names.some(name => {
    const other = `${dir}/${name}`;
    return diagramSource(other) && other !== rel && other !== exclude && name.replace(/\.(mmd|excalidraw)$/i, '').normalize('NFC').toLowerCase() === base;
  })) throw new HttpError(409, 'Ese nombre ya pertenece a otro diagrama; elige otro para conservar su figura');
  const figure = await resolveSafe(cfg, root, 'figuras/' + rel.replace(/\.(mmd|excalidraw)$/i, '.svg'));
  if (figure.exists) {
    const text = await fs.readFile(figure.abs, 'utf8');
    const source = readMeta(text)?.fuente;
    if (source && source !== rel && source !== exclude) throw new HttpError(409, 'La figura de ese nombre pertenece a otro archivo; elige un nombre distinto');
  }
}
