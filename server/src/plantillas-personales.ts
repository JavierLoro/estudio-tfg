import fs from 'node:fs/promises';
import path from 'node:path';
import { templateFiles } from '../../scripts/memoria-template.mjs';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { Ctx } from './context.ts';
import { parseDatos, applyChanges, escapeTex } from './datos.ts';
import { nuevaMemoria } from './nueva-memoria.ts';
import { leerPortadas } from './portadas.ts';
import { leerFuentes, generarFuentes } from './fuentes.ts';
import { computeSourceRev } from './compile.ts';
import { resolveSafe } from './paths.ts';
import { rev } from './fsutil.ts';
import { HttpError } from './errors.ts';
import { UUID, privateJson, readPrivate } from './assistantChanges.ts';
import { configuracionInicial, type NuevaMemoriaConfig } from '../../shared/nueva-memoria.ts';
import type { OutlineItem } from './outline.ts';
interface Personal { id: string; nombre: string; rev: string; config: NuevaMemoriaConfig; hashes: Record<string, string> }
export const personalRoot = (ctx: Ctx) => path.join(ctx.cfg.dataDir, 'personal-templates');
export function personalFolder(ctx: Ctx, id: string) { if (!UUID.test(id)) throw new HttpError(400, 'Plantilla no válida'); return path.join(personalRoot(ctx), id); }
export async function leerPersonal(ctx: Ctx, id: string) {
  const folder = personalFolder(ctx, id), meta: Personal = await readPrivate(path.join(folder, 'template.json'));
  if (meta.id !== id || !meta.hashes || rev(JSON.stringify({ ...meta, rev: '' })) !== meta.rev) throw new HttpError(409, 'La plantilla guardada ha cambiado');
  const archivos = new Map<string, Buffer>(); let size = 0;
  for (const [rel, hash] of Object.entries(meta.hashes)) {
    if (!/^(?:[\w-]+\.tex|bibliografia\.bib|(?:0-inicio|1-capitulos|2-anexos)\/[\w-]+\.tex|estilo\/(?:[\w.-]+\.(?:tex|cls|png|jpg|pdf|json|txt)|(?:fuentes|imagenes)\/[a-f0-9]{16}\.(?:ttf|otf|png|jpg|pdf)))$/.test(rel) || rel.includes('..')) throw new HttpError(409, 'La plantilla contiene una ruta no permitida');
    const file = path.join(folder, 'files', rel);
    const real = await fs.realpath(file), base = await fs.realpath(path.join(folder, 'files'));
    if (!real.startsWith(base + path.sep)) throw new HttpError(409, 'Recurso fuera de la plantilla');
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink()) throw new HttpError(409, 'Recurso de plantilla no válido');
    size += st.size; if (size > 70 * 1024 * 1024) throw new HttpError(413, 'La plantilla supera el límite de tamaño');
    const data = await fs.readFile(file); if (rev(data) !== hash) throw new HttpError(409, 'Un recurso de la plantilla ha cambiado'); archivos.set(rel, data);
  }
  return { meta, archivos };
}
export async function guardarPersonal(ctx: Ctx, nombre: unknown, baseRev: unknown) {
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 100) throw new HttpError(400, 'Escribe un nombre de hasta 100 caracteres');
  const cfg = { ...ctx.cfg }, initialRev = await computeSourceRev(cfg);
  if (baseRev !== initialRev) throw new HttpError(409, 'La memoria ha cambiado; vuelve a guardar la plantilla');
  const cls = await resolveSafe(cfg, 'memoria', 'estilo/memoria.cls');
  if (!cls.exists || !/v3\.6/.test(await fs.readFile(cls.abs, 'utf8'))) throw new HttpError(409, 'Actualiza la plantilla base antes de guardarla como plantilla personal');
  const baseClass = templateFiles('generico',cfg.templatesDir).get('estilo/memoria.cls')!;
  if (!(await fs.readFile(cls.abs)).equals(await fs.readFile(baseClass))) throw new HttpError(409, 'La clase tiene cambios en código. Conserva esa carpeta como plantilla propia.');
  const config = configuracionInicial();
  const institution = await resolveSafe(cfg, 'memoria', 'estilo/institucion.tex');
  config.institucion = Object.fromEntries(Object.entries(parseDatos(await fs.readFile(institution.abs, 'utf8'), 'institucion')).filter(([,v]) => v));
  for (const key of Object.keys(config.institucion)) if (/^(cabecera|pie).+Texto$/.test(key)) config.institucion[key] = '';
  const logo = config.institucion.logo; config.institucion.logo = '';
  const datosFile = await resolveSafe(cfg, 'memoria', 'datos.tex'), datos = parseDatos(await fs.readFile(datosFile.abs, 'utf8'), 'datos');
  for (const key of ['idioma','formato','estiloBibliografia','licencia','atribucion']) if (datos[key]) config.datos[key] = datos[key];
  const portadas = await leerPortadas(ctx).catch(e => { if (e.statusCode === 404) return null; throw e; });
  if (portadas) { config.portadas = structuredClone(portadas.config); for (const blocks of Object.values(config.portadas)) for (const b of blocks) if (b.tipo === 'texto') b.texto = 'Texto propio'; }
  const outline = await ctx.outline.get();
  const caps = outline.items.filter(i => i.kind === 'chapter');
  config.capitulos = caps.length ? caps.map(c => c.title) : config.capitulos;
  config.apartados = { ...config.apartados,
    portada: config.institucion.mostrarPortada !== 'no', portadaInterior: config.institucion.mostrarPortadaInterior !== 'no',
    derechos: config.institucion.mostrarDerechos === 'si', tribunal: config.institucion.mostrarTribunal === 'si',
    bibliografia: outline.items.some(i => i.kind === 'bibliography'), anexo: outline.items.some(i => i.kind === 'appendix'),
    resumen: outline.items.some(i => i.kind === 'frontmatter' && /resumen/i.test(i.title) && i.enabled),
    abstract: outline.items.some(i => i.kind === 'frontmatter' && /abstract/i.test(i.title) && i.enabled),
    agradecimientos: outline.items.some(i => i.kind === 'frontmatter' && /agradecimientos|acknowledg/i.test(i.title) && i.enabled) };
  const archivos = nuevaMemoria(config, cfg.templatesDir);
  function headings(items: OutlineItem[]): string { return items.map(i => (i.kind === 'section' || i.kind === 'subsection' ? `\\${i.kind === 'section' ? 'section' : 'subsection'}{${escapeTex(i.title)}}\n\n` : '') + headings(i.children)).join(''); }
  [...archivos.keys()].filter(k => k.startsWith('1-capitulos/')).forEach((rel,i) => { if (caps[i]) archivos.set(rel, archivos.get(rel)!.toString() + headings(caps[i].children)); });
  if (logo) { const asset = await resolveSafe(cfg, 'memoria', 'estilo/' + logo); archivos.set('estilo/' + logo, await fs.readFile(asset.abs)); archivos.set('estilo/institucion.tex', applyChanges(archivos.get('estilo/institucion.tex')!.toString(), 'institucion', {logo})); }
  for (const blocks of Object.values(config.portadas!)) for (const b of blocks) if (b.recurso) { const asset = await resolveSafe(cfg, 'memoria', b.recurso); archivos.set(b.recurso, await fs.readFile(asset.abs)); }
  const {registro} = await leerFuentes(cfg);
  if (registro.familias.length) {
    archivos.set('estilo/fuentes.json', JSON.stringify(registro, null, 2) + '\n'); archivos.set('estilo/fuentes.tex', generarFuentes(registro));
    archivos.set('estilo/LICENCIAS-FUENTES.txt', registro.familias.map(f => f.nombre + '\n' + (f.licencia || 'El archivo no incluye información de licencia.') + '\n').join('\n'));
    for (const f of registro.familias) for (const file of Object.values(f.archivos)) { const asset = await resolveSafe(cfg, 'memoria', 'estilo/fuentes/' + file); archivos.set('estilo/fuentes/' + file, await fs.readFile(asset.abs)); }
  }
  // No se copia ningún archivo de capítulos, bibliografía o historial del proyecto original.
  if (initialRev !== await computeSourceRev(cfg) || ctx.cfg.memoriaDir !== cfg.memoriaDir) throw new HttpError(409, 'La memoria cambió mientras se preparaba la plantilla');
  if ([...archivos.values()].reduce((n,v) => n + Buffer.byteLength(v), 0) > 70 * 1024 * 1024) throw new HttpError(413, 'La plantilla supera 70 MB');
  const id = randomUUID(), folder = personalFolder(ctx, id), staging = folder + '.tmp';
  await fs.mkdir(path.join(staging, 'files'), { recursive: true, mode: 0o700 });
  try {
    const hashes: Record<string,string> = {};
    for (const [rel,data] of archivos) { if (rel === '.gitignore') continue; const file = path.join(staging, 'files', rel); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); hashes[rel] = rev(data); }
    const meta: Personal = { id, nombre: nombre.trim(), config, hashes, rev: '' }; meta.rev = rev(JSON.stringify(meta));
    await privateJson(path.join(staging, 'template.json'), meta); await fs.rename(staging, folder);
    return {id, nombre: meta.nombre, rev: meta.rev};
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
/** ZIP almacenado, sin dependencias ni nombres recibidos de la petición. */
export function crearZip(files: Map<string, Buffer>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, data] of files) {
    const filename = Buffer.from(name), checksum = crc32(data), header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(entry, filename); offset += header.length + filename.length + data.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
