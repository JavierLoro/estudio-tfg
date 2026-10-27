import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import { fromBufferPromise } from 'yauzl';
import { claseDe, readManifiestos } from '../../scripts/memoria-template.mjs';
import { HttpError } from './errors.ts';
import { isIgnoredName } from './ignore.ts';
import { isInside, normalizeRel, validSegment } from './paths.ts';

const MAX_ENTRIES = 5000;
const MAX_BYTES = 200 * 1024 * 1024;
export const MAX_ZIP = 50 * 1024 * 1024;
const invalid = (message: string) => new HttpError(400, message);
export interface ProyectoPropio {
  archivos: { path: string; principal: boolean; compatible: boolean }[];
  principal: string | null;
}

async function fragmento(file: string): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(512 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

/** Analiza fuentes sin ejecutar TeX ni cambiar el proyecto. */
export async function inspeccionarProyecto(dir: string): Promise<ProyectoPropio> {
  const base = await fs.realpath(dir);
  const seen = new Set<string>();
  const archivos: ProyectoPropio['archivos'] = [];
  let entries = 0;
  const clase = path.join(base, 'estilo/memoria.cls');
  const realClase = await fs.realpath(clase).catch(() => null);
  const version = realClase && isInside(base, realClase) ? claseDe(await fragmento(realClase).catch(() => '')) : null;
  const conocida = !!version && readManifiestos().some((m) => m.clase === version);
  async function visit(abs: string, rel: string, depth: number) {
    if (depth > 32) throw invalid('La plantilla tiene demasiados niveles de carpetas');
    const real = await fs.realpath(abs);
    if (!isInside(base, real) || seen.has(real)) return;
    seen.add(real);
    for (const ent of await fs.readdir(real, { withFileTypes: true })) {
      if (++entries > MAX_ENTRIES) throw invalid('La plantilla supera el límite de 5000 entradas');
      if (isIgnoredName(ent.name, 'memoria', ent.isDirectory())) continue;
      const file = path.join(abs, ent.name);
      const target = await fs.realpath(file).catch(() => null);
      if (!target || !isInside(base, target)) continue;
      const st = await fs.stat(target);
      const relative = rel ? rel + '/' + ent.name : ent.name;
      if (st.isDirectory()) await visit(file, relative, depth + 1);
      else if (st.isFile() && /\.tex$/i.test(ent.name) && !relative.split('/').some((s) => s.startsWith('-'))) {
        const src = (await fragmento(target)).split(/\r?\n/).filter((line) => !/^\s*%/.test(line)).join('\n');
        const documentClass = /^\s*\\documentclass\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/m.exec(src)?.[1]?.trim();
        archivos.push({ path: relative, principal: !!documentClass, compatible: conocida && documentClass === 'estilo/memoria' });
      }
    }
  }
  await visit(base, '', 0);
  if (!archivos.length) throw invalid('La carpeta no contiene archivos .tex');
  archivos.sort((a, b) => Number(b.principal) - Number(a.principal) || a.path.localeCompare(b.path, 'es', { numeric: true }));
  const candidatos = archivos.filter((f) => f.principal);
  const habituales = candidatos.filter((f) => /^(main|tfg)\.tex$/i.test(f.path));
  const principal = candidatos.length === 1 ? candidatos[0].path : habituales.length === 1 ? habituales[0].path : null;
  return { archivos, principal };
}

/** Extrae solo archivos regulares, con tamaño, CRC y nombres válidos en las tres plataformas. */
export async function extraerPlantilla(buffer: Buffer, dir: string): Promise<string> {
  if (buffer.length > MAX_ZIP) throw new HttpError(413, 'El ZIP supera los 50 MB');
  const names = new Map<string, { path: string; dir: boolean }>();
  const files: string[] = [];
  let count = 0, total = 0;
  const zip = await fromBufferPromise(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true })
    .catch(() => { throw invalid('El archivo no es un ZIP válido'); });
  try {
    if (zip.entryCount > MAX_ENTRIES) throw invalid('El ZIP supera el límite de 5000 entradas');
    for await (const entry of zip.eachEntry()) {
      if (++count > MAX_ENTRIES) throw invalid('El ZIP supera el límite de 5000 entradas');
      total += entry.uncompressedSize;
      if (!Number.isSafeInteger(total) || total > MAX_BYTES) throw new HttpError(413, 'El ZIP extraído supera los 200 MB');
      const raw = entry.fileName.replace(/\/$/, '');
      const segments = raw.split('/');
      if (segments.some((s) => !validSegment(s) || s.toLowerCase() === '.git') || segments.length > 32) throw invalid('El ZIP contiene una ruta no permitida');
      const rel = normalizeRel(raw);
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (![0, 0o100000, 0o040000].includes(mode) || entry.generalPurposeBitFlag & 1) throw invalid('El ZIP contiene enlaces, archivos especiales o entradas cifradas');
      if (segments.includes('__MACOSX') || segments.at(-1) === '.DS_Store') continue;
      const directory = entry.fileName.endsWith('/') || mode === 0o040000 || !!(entry.externalFileAttributes & 16);
      for (let i = 1; i <= segments.length; i++) {
        const p = segments.slice(0, i).join('/');
        const isDir = i < segments.length || directory;
        const key = p.normalize('NFC').toLowerCase();
        const previous = names.get(key);
        if (previous && (!previous.dir || !isDir || previous.path !== p)) throw invalid('El ZIP contiene nombres duplicados o incompatibles entre plataformas');
        names.set(key, { path: p, dir: isDir });
      }
      const abs = path.join(dir, ...segments);
      if (directory) { await fs.mkdir(abs, { recursive: true }); continue; }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      let crc = 0, bytes = 0;
      const verify = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > entry.uncompressedSize) { callback(invalid('El ZIP declara un tamaño incorrecto')); return; }
        crc = crc32(chunk, crc);
        callback(null, chunk);
      } });
      await pipeline(await zip.openReadStreamPromise(entry), verify, createWriteStream(abs, { flags: 'wx', mode: 0o644 }));
      if (bytes !== entry.uncompressedSize || crc !== entry.crc32) throw invalid('El ZIP está dañado');
      files.push(rel);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw invalid('No se puede extraer el ZIP: está dañado o usa un formato no admitido');
  } finally { zip.close(); }
  if (!files.length) throw invalid('El ZIP no contiene archivos');
  // Los ZIP de universidades y GitHub suelen envolver el proyecto en una carpeta.
  let root = dir;
  for (;;) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory()) return root;
    root = path.join(root, entries[0].name);
  }
}
