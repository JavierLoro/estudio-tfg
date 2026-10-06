// node --test worker/svg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { MAX_SVG_BYTES, checkSvg } from './svg.mjs';

const svg = (inner, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${attrs}>${inner}</svg>`;

test('acepta SVG como los de Mermaid (marcadores url(#…), href internos, data:)', () => {
  assert.equal(checkSvg(svg('<path marker-end="url(#m_pointEnd)"/><use href="#a"/><use xlink:href="#b"/>')), null);
  assert.equal(checkSvg(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- comentario -->\n${svg('<text>Diseño</text>')}`), null);
  assert.equal(checkSvg(svg('<style>#d .node rect{fill:#eee;stroke:url(#g);font-family:"Source Sans 3",sans-serif}</style>')), null);
  assert.equal(checkSvg(svg('<image href="data:image/png;base64,iVBORw0KGgo="/>')), null);
  assert.equal(checkSvg(svg('<rect style="fill:url(&quot;#g&quot;)"/>')), null);
});

test('rechaza lo que no es SVG, vacío, NUL y tamaño', () => {
  assert.match(checkSvg(''), /vacío/);
  assert.match(checkSvg('<html><svg/></html>'), /raíz/);
  assert.match(checkSvg('hola'), /raíz/);
  assert.match(checkSvg(svg('a\0b')), /NUL/);
  assert.match(checkSvg(svg('x'.repeat(MAX_SVG_BYTES))), /máximo/);
});

test('rechaza DOCTYPE, entidades y hojas de estilo enlazadas', () => {
  assert.match(checkSvg(`<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${svg('&x;')}`), /DOCTYPE/);
  assert.match(checkSvg(`<?xml-stylesheet href="http://e.com/a.css"?>${svg('')}`), /hojas de estilo/);
});

test('rechaza referencias externas en href/src', () => {
  for (const ref of ['http://e.com/a.png', 'https://e.com/a.png', 'file:///etc/passwd', 'a.png', '../x.svg', '/etc/passwd', '&#104;ttp://e.com/']) {
    assert.match(checkSvg(svg(`<image href="${ref}"/>`)) ?? '', /externa/, ref);
    assert.match(checkSvg(svg(`<image xlink:href='${ref}'/>`)) ?? '', /externa/, ref);
  }
  assert.match(checkSvg(svg('<use href = "otro.svg#a"/>')) ?? '', /externa/);
  assert.match(checkSvg(svg('<feImage src="http://e.com/x"/>')) ?? '', /externa/);
});

test('rechaza @import, url() externas y escapes CSS', () => {
  assert.match(checkSvg(svg('<style>@import url(https://fonts.googleapis.com/css);</style>')) ?? '', /@import/);
  assert.match(checkSvg(svg('<style>@font-face{src:url(https://e.com/f.woff)}</style>')) ?? '', /externa/);
  assert.match(checkSvg(svg('<rect style="fill:url(\'file:///x\')"/>')) ?? '', /externa/);
  assert.match(checkSvg(svg('<rect fill="url(http://e.com/#g)"/>')) ?? '', /externa/);
  assert.match(checkSvg(svg('<style>rect{background:u\\72l(http://e.com)}</style>')) ?? '', /escapes/);
  assert.match(checkSvg(svg('<rect style="fill:u\\72l(http://e.com)"/>')) ?? '', /escapes/);
});

test('POST /svg2pdf: 405, 415, 413 y 400 antes de llamar a rsvg-convert', async () => {
  process.env.OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-test-'));
  const { server } = await import('./server.mjs');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/svg2pdf`;
  const post = (body, type = 'image/svg+xml') => fetch(url, { method: 'POST', headers: { 'content-type': type }, body });
  try {
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await post(svg(''), 'application/json')).status, 415);
    let res = await post(svg('<image href="http://e.com/x.png"/>'));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /externa/);
    res = await post('<!DOCTYPE svg>' + svg(''));
    assert.equal(res.status, 400);
    // Content-Length mayor que el máximo: 413 sin esperar al cuerpo.
    const status413 = await new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'POST', headers: { 'content-type': 'image/svg+xml', 'content-length': String(MAX_SVG_BYTES + 10) } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      });
      req.on('error', reject);
      req.write('<svg>');
    });
    assert.equal(status413, 413);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fs.rmSync(process.env.OUT_DIR, { recursive: true, force: true });
  }
});
