// Extractor tar mínimo y seguro (sin dependencias). Lee el tar en streaming y
// escribe solo archivos regulares y carpetas dentro de `dest`.
//
// Admite ustar/POSIX (prefijo), cabeceras PAX (`x`: path/size; `g` se ignora) y
// nombres largos GNU (`L`). Rechaza (error con status 400):
//   - rutas absolutas, con `..`, `\`, NUL o vacías,
//   - enlaces simbólicos, enlaces duros, dispositivos, FIFOs y cualquier otro tipo,
//   - cabeceras con checksum incorrecto, archivos truncados,
//   - más de MAX_ENTRIES entradas.
// El límite de tamaño total se aplica a los bytes leídos del stream (413).

import fs from 'node:fs/promises';
import path from 'node:path';

const BLOCK = 512;
export const MAX_ENTRIES = 50_000;

export class TarError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Lector de bytes exactos sobre un iterable asíncrono de Buffers, con límite total. */
class ByteReader {
  constructor(iterable, maxBytes) {
    this.it = iterable[Symbol.asyncIterator]();
    this.chunks = [];
    this.buffered = 0;
    this.total = 0;
    this.maxBytes = maxBytes;
    this.done = false;
  }

  async fill(n) {
    while (this.buffered < n && !this.done) {
      const { value, done } = await this.it.next();
      if (done) {
        this.done = true;
        break;
      }
      const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
      this.total += buf.length;
      if (this.total > this.maxBytes) {
        throw new TarError(`El tar supera el máximo de ${Math.round(this.maxBytes / 1024 / 1024)} MB`, 413);
      }
      this.chunks.push(buf);
      this.buffered += buf.length;
    }
  }

  /** Exactamente n bytes, o null si el stream terminó sin ningún byte. Error si termina a medias. */
  async read(n) {
    await this.fill(n);
    if (this.buffered === 0 && this.done) return null;
    if (this.buffered < n) throw new TarError('Tar truncado');
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.buffered = rest.length;
    return out;
  }

  /** Hasta `max` bytes (al menos 1) sin pasarse; para copiar datos por trozos. */
  async readUpTo(max) {
    await this.fill(1);
    if (this.buffered === 0) throw new TarError('Tar truncado');
    return this.read(Math.min(max, this.buffered));
  }

  /** Consume el resto del stream (respetando el límite). */
  async drain() {
    while (!this.done) {
      this.chunks = [];
      this.buffered = 0;
      await this.fill(Infinity);
    }
  }
}

const isZero = (b) => {
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false;
  return true;
};

function cstr(buf, off, len) {
  const s = buf.subarray(off, off + len);
  const z = s.indexOf(0);
  return (z < 0 ? s : s.subarray(0, z)).toString('utf8');
}

function octal(buf, off, len, field) {
  // Base-256 (GNU) para números grandes: no lo aceptamos (límite 200 MB de todos modos).
  if (buf[off] & 0x80) throw new TarError(`Campo ${field} no soportado`);
  const s = cstr(buf, off, len).trim();
  if (s === '') return 0;
  if (!/^[0-7]+$/.test(s)) throw new TarError(`Campo ${field} inválido`);
  return parseInt(s, 8);
}

function checksumOk(h) {
  const stored = octal(h, 148, 8, 'checksum');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  return sum === stored;
}

function parsePax(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    if (sp < 0) break;
    const len = parseInt(buf.subarray(i, sp).toString('ascii'), 10);
    if (!Number.isFinite(len) || len <= 0 || i + len > buf.length) throw new TarError('Cabecera PAX inválida');
    const rec = buf.subarray(sp + 1, i + len - 1).toString('utf8'); // sin el "\n" final
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/** Ruta relativa segura (con `/`) o error. Ignora `./` iniciales y `/` finales. */
export function safeEntryPath(name) {
  if (typeof name !== 'string' || name === '') throw new TarError('Entrada sin nombre');
  if (name.includes('\0') || name.includes('\\')) throw new TarError(`Ruta no permitida en el tar: ${JSON.stringify(name)}`);
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw new TarError(`Ruta absoluta no permitida en el tar: ${name}`);
  const segs = name.split('/').filter((s) => s !== '' && s !== '.');
  if (segs.some((s) => s === '..')) throw new TarError(`Ruta con ".." no permitida en el tar: ${name}`);
  return segs.join('/');
}

const TYPE_NAMES = { 1: 'enlace duro', 2: 'enlace simbólico', 3: 'dispositivo de caracteres', 4: 'dispositivo de bloques', 6: 'FIFO' };

/**
 * Extrae `source` (iterable asíncrono de Buffers, p. ej. un http.IncomingMessage)
 * en `dest` (carpeta existente y vacía). Devuelve { files, dirs, bytes }.
 */
export async function extractTar(source, dest, { maxBytes = 200 * 1024 * 1024, maxEntries = MAX_ENTRIES } = {}) {
  const r = new ByteReader(source, maxBytes);
  const root = path.resolve(dest);
  let entries = 0;
  let files = 0;
  let dirs = 0;
  let pax = null; // siguiente entrada
  let longName = null;

  const target = (rel) => {
    const abs = path.resolve(root, ...rel.split('/'));
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new TarError(`Ruta fuera del destino: ${rel}`);
    return abs;
  };

  for (;;) {
    const h = await r.read(BLOCK);
    if (!h) throw new TarError('Tar vacío o sin bloque final');
    if (isZero(h)) {
      // Fin de archivo (dos bloques de ceros; toleramos que falte el segundo).
      await r.drain();
      break;
    }
    if (!checksumOk(h)) throw new TarError('Checksum de cabecera tar incorrecto');
    if (++entries > maxEntries) throw new TarError(`Demasiadas entradas en el tar (máx. ${maxEntries})`);

    const type = String.fromCharCode(h[156] || 0x30); // '\0' = archivo regular (tar antiguo)
    let size = octal(h, 124, 12, 'size');
    const magic = cstr(h, 257, 6);
    let name = cstr(h, 0, 100);
    if (magic === 'ustar') {
      const prefix = cstr(h, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }

    if (type === 'x' || type === 'g' || type === 'L') {
      if (size > 1024 * 1024) throw new TarError('Cabecera extendida demasiado grande');
      const data = await r.read(Math.ceil(size / BLOCK) * BLOCK || 0);
      const body = data ? data.subarray(0, size) : Buffer.alloc(0);
      if (type === 'x') pax = parsePax(body);
      else if (type === 'L') longName = cstr(body, 0, body.length);
      continue; // 'g' (global) se ignora
    }

    if (longName !== null) name = longName;
    if (pax?.path !== undefined) name = pax.path;
    if (pax?.size !== undefined) {
      if (!/^\d+$/.test(pax.size)) throw new TarError('Tamaño PAX inválido');
      size = Number(pax.size);
    }
    pax = null;
    longName = null;

    if (type !== '0' && type !== '7' && type !== '5') {
      const what = TYPE_NAMES[type] ?? `tipo "${type}"`;
      throw new TarError(`Entrada no permitida en el tar (${what}): ${name}`);
    }
    const rel = safeEntryPath(name);
    if (type === '5') {
      if (size !== 0) throw new TarError(`Carpeta con datos en el tar: ${name}`);
      if (rel) await fs.mkdir(target(rel), { recursive: true });
      dirs++;
      continue;
    }
    if (!rel) throw new TarError('Archivo sin nombre en el tar');
    const abs = target(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Solo creamos carpetas y archivos regulares: no puede haber symlinks en el destino.
    // 'w' (no 'wx'): una entrada repetida sobrescribe la anterior, como tar.
    const fh = await fs.open(abs, 'w', 0o644);
    try {
      let left = size;
      while (left > 0) {
        const chunk = await r.readUpTo(Math.min(left, 1024 * 1024));
        await fh.write(chunk);
        left -= chunk.length;
      }
    } finally {
      await fh.close();
    }
    const pad = (BLOCK - (size % BLOCK)) % BLOCK;
    if (pad) await r.read(pad);
    files++;
  }
  return { files, dirs, bytes: r.total };
}
