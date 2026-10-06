// WOFF (1.0) → SFNT (.ttf/.otf) sin dependencias. Se usa al construir la imagen del worker:
// fontconfig indexa los .woff, pero Pango/HarfBuzz (lo que usa rsvg-convert para el texto) no
// los abre y caería en otra fuente. Las tablas se copian tal cual (descomprimidas): mismos
// glifos y métricas que el .woff que usa la web.
//
//   node woff2sfnt.mjs entrada.woff salida.ttf

import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** @param {Buffer} woff @returns {Buffer} */
export function woffToSfnt(woff) {
  if (woff.length < 44 || woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('No es un archivo WOFF 1.0');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const d = 44 + i * 20;
    const tag = woff.toString('latin1', d, d + 4);
    const offset = woff.readUInt32BE(d + 4);
    const compLength = woff.readUInt32BE(d + 8);
    const origLength = woff.readUInt32BE(d + 12);
    const checksum = woff.readUInt32BE(d + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? zlib.inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error(`Tabla ${tag}: tamaño inesperado`);
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  let pow = 1;
  let log = 0;
  while (pow * 2 <= numTables) {
    pow *= 2;
    log++;
  }
  const head = Buffer.alloc(12 + numTables * 16);
  head.writeUInt32BE(flavor, 0);
  head.writeUInt16BE(numTables, 4);
  head.writeUInt16BE(pow * 16, 6);
  head.writeUInt16BE(log, 8);
  head.writeUInt16BE(numTables * 16 - pow * 16, 10);
  const parts = [head];
  let offset = head.length;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    head.write(t.tag, r, 4, 'latin1');
    head.writeUInt32BE(t.checksum, r + 4);
    head.writeUInt32BE(offset, r + 8);
    head.writeUInt32BE(t.data.length, r + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    parts.push(t.data, Buffer.alloc(pad));
    offset += t.data.length + pad;
  });
  return Buffer.concat(parts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Uso: node woff2sfnt.mjs entrada.woff salida.ttf');
    process.exit(2);
  }
  fs.writeFileSync(output, woffToSfnt(fs.readFileSync(input)));
}
