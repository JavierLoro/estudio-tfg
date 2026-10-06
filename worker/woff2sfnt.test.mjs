// node --test worker/woff2sfnt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { woffToSfnt } from './woff2sfnt.mjs';

/** WOFF mínimo con dos tablas: una comprimida y otra sin comprimir. */
function makeWoff(tables) {
  const dir = Buffer.alloc(tables.length * 20);
  const datas = [];
  let offset = 44 + dir.length;
  tables.forEach((t, i) => {
    const data = t.compress ? zlib.deflateSync(t.data) : t.data;
    dir.write(t.tag, i * 20, 4, 'latin1');
    dir.writeUInt32BE(offset, i * 20 + 4);
    dir.writeUInt32BE(data.length, i * 20 + 8);
    dir.writeUInt32BE(t.data.length, i * 20 + 12);
    dir.writeUInt32BE(0x12345678 + i, i * 20 + 16);
    const pad = Buffer.alloc((4 - (data.length % 4)) % 4);
    datas.push(data, pad);
    offset += data.length + pad.length;
  });
  const head = Buffer.alloc(44);
  head.write('wOFF', 0, 'latin1');
  head.writeUInt32BE(0x00010000, 4);
  head.writeUInt32BE(offset, 8);
  head.writeUInt16BE(tables.length, 12);
  return Buffer.concat([head, dir, ...datas]);
}

test('WOFF → SFNT: tablas descomprimidas, ordenadas y alineadas, con su checksum', () => {
  const name = Buffer.from('nombre de la fuente '.repeat(10));
  const head = Buffer.from('cabecera');
  const out = woffToSfnt(makeWoff([{ tag: 'name', data: name, compress: true }, { tag: 'head', data: head }]));
  assert.equal(out.readUInt32BE(0), 0x00010000);
  assert.equal(out.readUInt16BE(4), 2);
  const rec = (i) => ({ tag: out.toString('latin1', 12 + i * 16, 16 + i * 16), sum: out.readUInt32BE(16 + i * 16), off: out.readUInt32BE(20 + i * 16), len: out.readUInt32BE(24 + i * 16) });
  const [a, b] = [rec(0), rec(1)];
  assert.deepEqual([a.tag, b.tag], ['head', 'name']);
  assert.equal(a.sum, 0x12345679);
  assert.deepEqual(out.subarray(a.off, a.off + a.len), head);
  assert.deepEqual(out.subarray(b.off, b.off + b.len), name);
  assert.equal(a.off % 4, 0);
  assert.equal(b.off % 4, 0);
});

test('rechaza lo que no es WOFF 1.0', () => {
  assert.throws(() => woffToSfnt(Buffer.from('wOF2' + ' '.repeat(60))), /WOFF/);
});

test('la fuente real de los diagramas (si web/node_modules está instalado)', (t) => {
  const f = path.join(import.meta.dirname, '..', 'web', 'node_modules', '@fontsource', 'source-sans-3', 'files', 'source-sans-3-latin-400-normal.woff');
  if (!fs.existsSync(f)) return t.skip('sin web/node_modules');
  const woff = fs.readFileSync(f);
  const out = woffToSfnt(woff);
  assert.equal(out.length, woff.readUInt32BE(16)); // totalSfntSize de la cabecera WOFF
  const tags = Array.from({ length: out.readUInt16BE(4) }, (_, i) => out.toString('latin1', 12 + i * 16, 16 + i * 16));
  for (const tag of ['cmap', 'head', 'hmtx', 'name']) assert.ok(tags.includes(tag), tag);
});
