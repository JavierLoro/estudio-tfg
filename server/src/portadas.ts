import fs from 'node:fs/promises';
import type { Ctx } from './context.ts';
import { escapeTex } from './datos.ts';
import { HttpError } from './errors.ts';
import { atomicWrite, backup, rev } from './fsutil.ts';
import { resolveSafe } from './paths.ts';
import { ELEMENTOS_PORTADA, ZONAS, type PortadasConfig } from '../../shared/portadas.ts';

export const PORTADAS_REL = 'estilo/portadas.tex';
const MARK = '% et:portadas ';
export function validarPortadas(raw: unknown): PortadasConfig {
  const value = raw as PortadasConfig;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some((key) => !['exterior', 'interior'].includes(key))) throw new HttpError(400, 'La composición de portadas no es válida');
  for (const side of ['exterior', 'interior'] as const) {
    const blocks = value[side];
    if (!Array.isArray(blocks) || blocks.length > 20) throw new HttpError(400, 'Cada portada admite hasta 20 elementos');
    const ids = new Set<string>();
    for (const block of blocks) {
      if (!block || typeof block !== 'object' || typeof block.id !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(block.id) || ids.has(block.id) ||
        !ZONAS.includes(block.zona) || (block.tipo !== 'texto' && !ELEMENTOS_PORTADA.some(([key]) => key === block.tipo)) ||
        Object.keys(block).some((key) => !['id', 'tipo', 'zona', 'texto', 'alineacion', 'espacio', 'recurso'].includes(key)) ||
        (block.tipo === 'texto' && (typeof block.texto !== 'string' || !block.texto.trim() || block.texto.length > 500)) ||
        (block.tipo !== 'texto' && block.texto !== undefined) ||
        (block.alineacion !== undefined && !['izquierda', 'centro', 'derecha'].includes(block.alineacion)) ||
        (block.espacio !== undefined && (!Number.isFinite(block.espacio) || block.espacio < 0 || block.espacio > 50)) ||
        (block.tipo === 'imagen' ? typeof block.recurso !== 'string' || !/^estilo\/imagenes\/[a-f0-9]{16}\.(png|jpg|pdf)$/.test(block.recurso) : block.recurso !== undefined)) throw new HttpError(400, 'Hay un elemento de portada no válido');
      ids.add(block.id);
    }
    for (const zona of ZONAS) if (blocks.filter((b) => b.zona === zona).length > 10) throw new HttpError(400, 'Coloca como máximo 10 elementos en cada zona');
  }
  return value;
}

export function generarPortadas(raw: unknown): string {
  const cfg = validarPortadas(raw);
  const field: Record<string, string> = { tipo: 'tiponombre', cotutor: 'cotutor', ...Object.fromEntries(ELEMENTOS_PORTADA.map(([key]) => [key, key])) };
  field.tipo = 'tiponombre';
  const lines = [MARK + JSON.stringify(cfg), '% Composición gestionada desde Datos del trabajo → Componer portadas.'];
  for (const side of ['exterior', 'interior'] as const) {
    lines.push(`\\newcommand{\\portada${side === 'exterior' ? 'Exterior' : 'Interior'}Personalizada}{%`,
      '\\thispagestyle{empty}', '\\begingroup', '\\centering', '\\setstretch{1.2}', '\\vspace*{0pt}');
    for (const zona of ZONAS) {
      if (zona !== 'superior') lines.push('\\vfill');
      for (const block of cfg[side].filter((b) => b.zona === zona)) {
        const align = block.alineacion;
        if (align) lines.push('\\begingroup\\' + ({ izquierda: 'raggedright', centro: 'centering', derecha: 'raggedleft' }[align]));
        const start = lines.length;
        if (block.tipo === 'imagen') lines.push(`\\includegraphics[width=35mm,height=25mm,keepaspectratio]{${block.recurso}}\\par\\vspace{4mm}`);
        else if (block.tipo === 'firma') lines.push('\\vspace{10mm}\\rule{50mm}{0.4pt}\\par\\vspace{4mm}');
        else if (block.tipo === 'texto') lines.push(`{\\normalsize ${escapeTex(block.texto!.trim()).replace(/\r?\n/g, '\\\\')}\\par}\\vspace{4mm}`);
        else if (block.tipo === 'logo') lines.push(String.raw`\ifcsempty{mem@logo}{}{\IfFileExists{estilo/\dato{logo}}{\includegraphics[width=35mm,height=25mm,keepaspectratio]{estilo/\dato{logo}}\par\vspace{4mm}}{}}`);
        else {
          const key = field[block.tipo];
          const size = block.tipo === 'titulo' ? '\\LARGE\\bfseries' : block.tipo === 'universidad' ? '\\large\\bfseries' : '\\normalsize';
          const label = block.tipo === 'tutor' || block.tipo === 'cotutor' ? `\\dato{${block.tipo}texto}: ` : '';
          lines.push(`\\ifcsempty{mem@${key}}{}{{${size} ${label}\\dato{${key}}\\par}\\vspace{4mm}}`);
        }
        if (block.espacio !== undefined) for (let i = start; i < lines.length; i++) lines[i] = lines[i].replaceAll('vspace{4mm}', `vspace{${block.espacio}mm}`);
        if (align) lines.push('\\par\\endgroup');
      }
    }
    lines.push('\\par\\endgroup', '\\cleardoublepage', '}');
  }
  return lines.join('\n') + '\n';
}

export async function leerPortadas(ctx: Ctx) {
  const r = await resolveSafe(ctx.cfg, 'memoria', PORTADAS_REL);
  if (!r.exists) throw new HttpError(404, 'Esta memoria no tiene portadas configuradas con el editor visual');
  const buffer = await fs.readFile(r.abs);
  const src = buffer.toString('utf8');
  let config: PortadasConfig;
  try { config = validarPortadas(JSON.parse(src.split('\n')[0].slice(MARK.length))); }
  catch { throw new HttpError(409, 'El archivo de composición se ha editado en código; conserva esos cambios antes de usar el editor de portadas'); }
  if (!src.startsWith(MARK) || generarPortadas(config) !== src) throw new HttpError(409, 'Las portadas tienen cambios en código que el editor visual no puede sustituir');
  return { config, baseRev: rev(buffer) };
}

export async function guardarPortadas(ctx: Ctx, raw: unknown) {
  const body = raw as { config?: unknown; baseRev?: unknown };
  if (!body || typeof body.baseRev !== 'string') throw new HttpError(400, 'Falta la revisión de las portadas');
  const next = generarPortadas(body.config);
  for (const blocks of Object.values(validarPortadas(body.config))) for (const block of blocks) if (block.recurso) {
    const asset = await resolveSafe(ctx.cfg, 'memoria', block.recurso);
    if (!asset.exists || !(await fs.stat(asset.abs)).isFile()) throw new HttpError(400, 'La imagen de portada ya no está disponible');
  }
  return ctx.locks.run('memoria:' + PORTADAS_REL, async () => {
    const current = await leerPortadas(ctx);
    if (current.baseRev !== body.baseRev) throw new HttpError(409, 'Las portadas han cambiado; vuelve a abrir el editor para revisarlas');
    const r = await resolveSafe(ctx.cfg, 'memoria', PORTADAS_REL);
    const bytes = await fs.readFile(r.abs);
    if (rev(bytes) !== body.baseRev) throw new HttpError(409, 'Las portadas cambiaron antes de guardar');
    if (next !== bytes.toString('utf8')) {
      await backup(ctx.cfg, 'memoria', PORTADAS_REL, bytes);
      await atomicWrite(r.abs, next);
      ctx.bus.change({ root: 'memoria', path: PORTADAS_REL, kind: 'change' });
    }
    return { config: validarPortadas(body.config), baseRev: rev(next) };
  });
}
