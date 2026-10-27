import { FUENTES_PERSONALES_KEYS } from '../../shared/tipografia.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './errors.ts';
import { rev, atomicWrite, backup } from './fsutil.ts';
import { resolveSafe } from './paths.ts';
import type { Ctx } from './context.ts';
import type { Config } from './config.ts';
export const FUENTES_REL = 'estilo/fuentes.json';
export interface FamiliaPropia { id: string; nombre: string; licencia: string; archivos: Partial<Record<'regular' | 'negrita' | 'cursiva' | 'negritaCursiva', string>> }
export interface RegistroFuentes { familias: FamiliaPropia[] }
const invalid = () => new HttpError(400, 'El archivo no es una fuente TTF u OTF válida');
/** Solo se leen las tablas SFNT necesarias; no se ejecuta ni instala la fuente. */
export function inspeccionarFuente(buf: Buffer) {
  if (buf.length < 12 || buf.length > 10 * 1024 * 1024 || ![0x00010000, 0x4f54544f].includes(buf.readUInt32BE(0))) throw invalid();
  const count = buf.readUInt16BE(4);
  if (!count || count > 256 || 12 + count * 16 > buf.length) throw invalid();
  const tables = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16, offset = buf.readUInt32BE(at + 8), length = buf.readUInt32BE(at + 12);
    if (offset < 12 + count * 16 || offset + length > buf.length) throw invalid();
    tables.set(buf.toString('ascii', at, at + 4), buf.subarray(offset, offset + length));
  }
  if (!tables.has('head') || !tables.has('cmap') || (!tables.has('glyf') && !tables.has('CFF ') && !tables.has('CFF2'))) throw invalid();
  const names = tables.get('name');
  if (!names || names.length < 6 || names.readUInt16BE(0) > 1) throw invalid();
  const n = names.readUInt16BE(2), storage = names.readUInt16BE(4);
  if (6 + n * 12 > names.length || storage < 6 + n * 12) throw invalid();
  const fields = new Map<number, string>();
  for (let i = 0; i < n; i++) {
    const p = 6 + i * 12, platform = names.readUInt16BE(p), id = names.readUInt16BE(p + 6), len = names.readUInt16BE(p + 8), start = storage + names.readUInt16BE(p + 10);
    if (start + len > names.length) throw invalid();
    if (fields.has(id) || ![0, 1, 3].includes(platform)) continue;
    const raw = Buffer.from(names.subarray(start, start + len));
    if (platform !== 1) { if (len % 2) throw invalid(); raw.swap16(); }
    const value = raw.toString(platform === 1 ? 'latin1' : 'utf16le').replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (value) fields.set(id, value.slice(0, id === 13 ? 12000 : 200));
  }
  const nombre = fields.get(16) || fields.get(1);
  if (!nombre) throw invalid();
  const style = (fields.get(17) || fields.get(2) || '').toLowerCase();
  const bold = /bold|black|heavy|negrita/.test(style), italic = /italic|oblique|cursiva/.test(style);
  return { nombre, variante: bold ? italic ? 'negritaCursiva' : 'negrita' : italic ? 'cursiva' : 'regular', licencia: fields.get(13) || fields.get(0) || '', ext: buf.readUInt32BE(0) === 0x4f54544f ? 'otf' : 'ttf' } as const;
}
export async function leerFuentes(cfg: Config): Promise<{ registro: RegistroFuentes; baseRev: string | null; avisos: string[] }> {
  const r = await resolveSafe(cfg, 'memoria', FUENTES_REL);
  const buf = r.exists ? await fs.readFile(r.abs) : null;
  const registro: RegistroFuentes = buf ? JSON.parse(buf.toString('utf8')) : { familias: [] };
  if (!Array.isArray(registro.familias) || registro.familias.length > 40) throw new HttpError(409, 'El registro de fuentes no es válido');
  for (const f of registro.familias) if (!/^propia-[a-f0-9]{16}$/.test(f.id) || typeof f.nombre !== 'string' || typeof f.licencia !== 'string' || !f.archivos || Object.entries(f.archivos).some(([v, file]) => !['regular', 'negrita', 'cursiva', 'negritaCursiva'].includes(v) || !/^[a-f0-9]{16}\.(ttf|otf)$/.test(file))) throw new HttpError(409, 'El registro de fuentes contiene rutas o variantes no válidas');
  const files = new Set(registro.familias.flatMap(f => Object.values(f.archivos)));
  for (const file of files) {
    const r = await resolveSafe(cfg,'memoria','estilo/fuentes/' + file);
    if (!r.exists || !(await fs.stat(r.abs)).isFile() || (await fs.stat(r.abs)).size > 10 * 1024 * 1024 || rev(await fs.readFile(r.abs)) !== file.slice(0,16)) throw new HttpError(409,'Un archivo de fuente ha cambiado o ya no está disponible');
  }
  const definitions = await resolveSafe(cfg, 'memoria', 'estilo/fuentes.tex');
  const tex = definitions.exists ? await fs.readFile(definitions.abs) : null;
  if (buf && tex?.toString() !== generarFuentes(registro)) throw new HttpError(409, 'Las definiciones de fuentes tienen cambios en código; conserva esos cambios antes de importar');
  const avisos = registro.familias.flatMap(f => {
    const missing = ['regular', 'negrita', 'cursiva', 'negritaCursiva'].filter(v => !f.archivos[v as keyof typeof f.archivos]);
    return missing.length ? [`${f.nombre}: faltan ${missing.join(', ')}. Se usará el archivo ${f.archivos.regular ? 'regular' : 'disponible'} de esta familia, sin simular estilos.`] : [];
  });
  return { registro, baseRev: buf || tex ? rev(Buffer.concat([buf ?? Buffer.alloc(0), tex ?? Buffer.alloc(0)])) : null, avisos };
}
export function generarFuentes(registro: RegistroFuentes) {
  return '% Generado por Estudio TFG.\n' + registro.familias.map(f => {
    const regular = f.archivos.regular || Object.values(f.archivos)[0]!;
    const options = `Path=estilo/fuentes/,BoldFont=${f.archivos.negrita || regular},ItalicFont=${f.archivos.cursiva || regular},BoldItalicFont=${f.archivos.negritaCursiva || regular}`;
    return `\\csdef{mem@font@${f.id}}{\\fontspec[${options}]{${regular}}}\n\\csdef{mem@main@${f.id}}{\\setmainfont[${options}]{${regular}}}\n\\csdef{mem@mono@${f.id}}{\\setmonofont[${options}]{${regular}}}`;
  }).join('\n') + '\n';
}
export async function validarFuentes(cfg: Config, values: Record<string, unknown>) {
  const propios = Object.entries(values).filter(([k,v]) => FUENTES_PERSONALES_KEYS.includes(k) && typeof v === 'string' && v.startsWith('propia-'));
  if (!propios.length) return;
  const { registro } = await leerFuentes(cfg);
  for (const [,v] of propios) if (!registro.familias.some(f => f.id === v)) throw new HttpError(400, 'Selecciona una fuente importada en esta memoria');
}
export async function importarFuentes(ctx: Ctx, files: Buffer[], baseRev: unknown) {
  const parsed = files.map(data => ({ data, info: inspeccionarFuente(data) }));
  if (!parsed.length || parsed.length > 16) throw new HttpError(400, 'Selecciona entre 1 y 16 archivos de fuentes');
  const cfg = { ...ctx.cfg };
  return ctx.locks.run('memoria:' + FUENTES_REL, () => ctx.locks.run('memoria:estilo/fuentes.tex', async () => {
    const cur = await leerFuentes(cfg);
    if (baseRev !== cur.baseRev) throw new HttpError(409, 'Las fuentes han cambiado; vuelve a cargar la lista');
    const registro = structuredClone(cur.registro), additions = new Map<string, Buffer>();
    for (const {data, info} of parsed) {
      const id = 'propia-' + rev(info.nombre.normalize('NFKC').toLowerCase());
      let family = registro.familias.find(f => f.id === id);
      if (!family) { family = { id, nombre: info.nombre, licencia: info.licencia, archivos: {} }; registro.familias.push(family); }
      const file = rev(data) + '.' + info.ext;
      family.archivos[info.variante] = file;
      additions.set(file, data);
    }
    if (registro.familias.length > 40) throw new HttpError(400, 'La memoria admite hasta 40 familias');
    const allFiles = new Set(registro.familias.flatMap(f => Object.values(f.archivos)));
    const fontDir = await resolveSafe(cfg, 'memoria', 'estilo/fuentes');
    for (const name of fontDir.exists ? await fs.readdir(fontDir.abs) : []) if (/^[a-f0-9]{16}\.(ttf|otf)$/.test(name)) allFiles.add(name);
    let bytes = 0;
    for (const name of allFiles) {
      const r = await resolveSafe(cfg, 'memoria', 'estilo/fuentes/' + name);
      bytes += additions.get(name)?.length ?? (await fs.stat(r.abs)).size;
    }
    if (bytes > 50 * 1024 * 1024) throw new HttpError(413, 'Las fuentes de la memoria superan 50 MB');
    if (ctx.cfg.memoriaDir !== cfg.memoriaDir) throw new HttpError(409, 'La memoria ha cambiado');
    for (const [name, data] of additions) {
      const r = await resolveSafe(cfg, 'memoria', 'estilo/fuentes/' + name);
      await fs.mkdir(path.dirname(r.abs), { recursive: true }); await resolveSafe(cfg, 'memoria', 'estilo/fuentes/' + name);
      if (r.exists && !(await fs.readFile(r.abs)).equals(data)) throw new HttpError(409, 'El archivo de fuente existente ha cambiado');
      if (!r.exists) await atomicWrite(r.abs, data);
    }
    const prev = new Map<string, Buffer | null>();
    const writes: [string, string][] = [['estilo/fuentes.tex', generarFuentes(registro)], [FUENTES_REL, JSON.stringify(registro, null, 2) + '\n']];
    for (const [rel] of writes) { const r = await resolveSafe(cfg, 'memoria', rel); const buf = r.exists ? await fs.readFile(r.abs) : null; prev.set(rel, buf); if (buf) await backup(cfg, 'memoria', rel, buf); }
    try {
      for (const [rel, data] of writes) { const r = await resolveSafe(cfg, 'memoria', rel); await atomicWrite(r.abs, data); ctx.bus.change({root:'memoria', path:rel, kind:'change'}); }
    } catch (error) {
      for (const [rel, buf] of prev) { const r = await resolveSafe(cfg, 'memoria', rel); if (buf) await atomicWrite(r.abs, buf); else await fs.rm(r.abs, {force:true}); }
      throw error;
    }
    return leerFuentes(cfg);
  }));
}
