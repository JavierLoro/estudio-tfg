import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboutOptions } from './about.mjs';
import { licenseHtml } from './credits.mjs';

test('Acerca de identifica versión, licencia y código correspondiente a la release', () => {
  const info = aboutOptions('0.2.0-rc.1', 'v0.2.0-rc.1');
  assert.match(info.message, /0\.2\.0-rc\.1/); assert.match(info.detail, /AGPL-3\.0/);
  assert.equal(info.source, 'https://github.com/JavierLoro/estudio-tfg/tree/v0.2.0-rc.1');
  assert.match(info.detail, /ARCO \(GPL-2\.0\+\)/);
});

test('el inventario conserva avisos y escapa HTML de componentes y textos legales', () => {
  const html = licenseHtml([{ name: '<script>componente', version: '1', license: 'MIT', notices: [{ name: 'LICENSE', text: 'Copyright <autor>' }] }], [], { AGPL: 'Texto original <legal>' });
  assert(html.includes('Copyright &lt;autor&gt;')); assert(html.includes('Texto original &lt;legal&gt;'));
  assert(!html.includes('<script>componente')); assert(html.includes('Licencias y componentes'));
});
