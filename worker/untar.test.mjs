// node --test worker/untar.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { extractTar, safeEntryPath } from './untar.mjs';

// ---------- constructor de tar mínimo (para fabricar tars maliciosos) ----------

function header(name, { type = '0', size = 0, linkname = '', prefix = '', magic = 'ustar' } = {}) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write(linkname, 157, 100, 'utf8');
  if (magic === 'ustar') {
    h.write('ustar\0', 257);
    h.write('00', 263);
  }
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);

function entry(name, content = '', opts = {}) {
  const data = Buffer.from(content);
  return Buffer.concat([header(name, { size: data.length, ...opts }), pad(data)]);
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  const blen = Buffer.byteLength(body);
  let len = blen + 1;
  while (String(len).length + blen !== len) len = String(len).length + blen;
  return `${len}${body}`;
}

const archive = (...parts) => Buffer.concat([...parts, Buffer.alloc(1024)]);
const src = (buf, chunk = 700) => Readable.from((function* () {
  for (let i = 0; i < buf.length; i += chunk) yield buf.subarray(i, i + chunk);
})());

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'untar-test-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const freshDir = () => fs.mkdtempSync(path.join(tmp, 'd-'));

// ---------- casos válidos ----------

test('extrae archivos y carpetas (trozos irregulares)', async () => {
  const dest = freshDir();
  const big = 'x'.repeat(5000);
  const r = await extractTar(src(archive(
    entry('cap/', '', { type: '5' }),
    entry('main.tex', '\\documentclass{article}'),
    entry('./cap/intro.tex', big),
    entry('vacio.txt', ''),
  ), 333), dest);
  assert.deepEqual({ files: r.files, dirs: r.dirs }, { files: 3, dirs: 1 });
  assert.equal(fs.readFileSync(path.join(dest, 'main.tex'), 'utf8'), '\\documentclass{article}');
  assert.equal(fs.readFileSync(path.join(dest, 'cap/intro.tex'), 'utf8'), big);
  assert.equal(fs.readFileSync(path.join(dest, 'vacio.txt'), 'utf8'), '');
});

test('prefijo ustar, nombre largo GNU (L) y PAX path con tildes', async () => {
  const dest = freshDir();
  const long = 'a/'.repeat(60) + 'largo.tex';
  const paxBody = Buffer.from(paxRecord('path', 'capítulos/introducción.tex') + paxRecord('mtime', '1700000000.5'));
  await extractTar(src(archive(
    entry('fig.pdf', 'PDF', { prefix: 'figuras/sub' }),
    Buffer.concat([header('././@LongLink', { type: 'L', size: long.length + 1 }), pad(Buffer.from(long + '\0'))]),
    entry('truncado', 'largo'),
    Buffer.concat([header('PaxHeader/x', { type: 'x', size: paxBody.length }), pad(paxBody)]),
    entry('ascii-name.tex', 'hola'),
    Buffer.concat([header('pax_global_header', { type: 'g', size: paxBody.length }), pad(paxBody)]),
  )), dest);
  assert.equal(fs.readFileSync(path.join(dest, 'figuras/sub/fig.pdf'), 'utf8'), 'PDF');
  assert.equal(fs.readFileSync(path.join(dest, long), 'utf8'), 'largo');
  assert.equal(fs.readFileSync(path.join(dest, 'capítulos/introducción.tex'), 'utf8'), 'hola');
  assert.ok(!fs.existsSync(path.join(dest, 'ascii-name.tex')));
});

test('acepta un tar real hecho con el binario tar del sistema', async (t) => {
  const srcDir = path.join(freshDir(), 'p');
  fs.mkdirSync(path.join(srcDir, 'cap'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'main.tex'), 'main');
  fs.writeFileSync(path.join(srcDir, 'cap', 'intro.tex'), 'intro');
  let buf;
  try {
    buf = execFileSync('tar', ['-cf', '-', '-C', srcDir, 'main.tex', 'cap'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  } catch {
    t.skip('sin binario tar');
    return;
  }
  const dest = freshDir();
  await extractTar(src(buf), dest);
  assert.equal(fs.readFileSync(path.join(dest, 'cap/intro.tex'), 'utf8'), 'intro');
});

// ---------- tars maliciosos ----------

const rejects = async (buf, re, status = 400) => {
  const dest = freshDir();
  await assert.rejects(extractTar(src(buf), dest, { maxBytes: 64 * 1024 }), (e) => {
    assert.match(e.message, re);
    assert.equal(e.status, status);
    return true;
  });
  return dest;
};

test('rechaza rutas absolutas', async () => {
  await rejects(archive(entry('/etc/evil.tex', 'x')), /absoluta/);
  await rejects(archive(entry('C:/evil.tex', 'x')), /absoluta/);
});

test('rechaza ".." (también vía prefijo, PAX y nombre largo)', async () => {
  const outside = path.join(tmp, 'escapado.tex');
  await rejects(archive(entry('../escapado.tex', 'x')), /\.\./);
  await rejects(archive(entry('a/../../escapado.tex', 'x')), /\.\./);
  await rejects(archive(entry('escapado.tex', 'x', { prefix: '..' })), /\.\./);
  const pax = Buffer.from(paxRecord('path', '../../escapado.tex'));
  await rejects(archive(Buffer.concat([header('h', { type: 'x', size: pax.length }), pad(pax)]), entry('ok.tex', 'x')), /\.\./);
  const ln = Buffer.from('../escapado.tex\0');
  await rejects(archive(Buffer.concat([header('././@LongLink', { type: 'L', size: ln.length }), pad(ln)]), entry('ok.tex', 'x')), /\.\./);
  assert.ok(!fs.existsSync(outside));
});

test('rechaza symlinks, hardlinks, dispositivos y FIFOs', async () => {
  const d = await rejects(archive(entry('link', '', { type: '2', linkname: '/etc/passwd' }), entry('link', 'pwn')), /simbólico/);
  assert.ok(!fs.existsSync(path.join(d, 'link')));
  await rejects(archive(entry('main.tex', 'x'), entry('hard', '', { type: '1', linkname: 'main.tex' })), /enlace duro/);
  await rejects(archive(entry('dev', '', { type: '3' })), /dispositivo/);
  await rejects(archive(entry('blk', '', { type: '4' })), /dispositivo/);
  await rejects(archive(entry('fifo', '', { type: '6' })), /FIFO/);
  await rejects(archive(entry('raro', '', { type: 'S' })), /no permitida/);
});

test('rechaza checksum incorrecto, tar truncado, backslash y NUL', async () => {
  const bad = archive(entry('main.tex', 'x'));
  bad[0] = 'n'.charCodeAt(0);
  await rejects(bad, /Checksum/);
  await rejects(entry('main.tex', 'x'.repeat(2000)).subarray(0, 1000), /truncado/);
  await rejects(archive(entry('a\\..\\b.tex', 'x')), /no permitida/);
  await rejects(Buffer.alloc(0), /vacío/);
});

test('límite de tamaño → 413', async () => {
  await rejects(archive(entry('grande.bin', 'x'.repeat(100 * 1024))), /máximo/, 413);
});

test('safeEntryPath normaliza ./ y / finales', () => {
  assert.equal(safeEntryPath('./a/b/'), 'a/b');
  assert.throws(() => safeEntryPath('a/../../b'));
});

// ---------- HTTP del worker: rechazos antes de compilar (no necesita latexmk) ----------

test('POST /compile: 415 sin tar, 400 X-Main inválido, 400 tar malicioso', async () => {
  process.env.OUT_DIR = freshDir();
  const { server } = await import('./server.mjs');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/compile`;
  try {
    let res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"main":"main.tex"}' });
    assert.equal(res.status, 415);
    const tarHeaders = (main) => ({ 'content-type': 'application/x-tar', 'x-main': main });
    res = await fetch(url, { method: 'POST', headers: tarHeaders('..%2Fetc%2Fx.tex'), body: archive(entry('main.tex', 'x')) });
    assert.equal(res.status, 400);
    res = await fetch(url, { method: 'POST', headers: tarHeaders('-shell-escape.tex'), body: archive(entry('main.tex', 'x')) });
    assert.equal(res.status, 400);
    res = await fetch(url, { method: 'POST', headers: tarHeaders('main.tex'), body: archive(entry('../x.tex', 'x')) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /\.\./);
    res = await fetch(url, { method: 'POST', headers: tarHeaders('main.tex'), body: archive(entry('l', '', { type: '2', linkname: '/etc' })) });
    assert.equal(res.status, 400);
    const status413 = await new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'POST', headers: { ...tarHeaders('main.tex'), 'content-length': String(300 * 1024 * 1024) } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      });
      req.on('error', reject);
      req.write(Buffer.alloc(512));
    });
    assert.equal(status413, 413);
    assert.ok(fs.readdirSync(process.env.OUT_DIR).length === 0, 'no se crea ningún build');
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
