import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_ORIGIN, isAppUrl, isExternalUrl } from './security.mjs';

test('solo la app usa el proxy y los enlaces externos nunca ejecutan protocolos del sistema', () => {
  assert(isAppUrl(APP_ORIGIN + '/api/status'));
  assert(isAppUrl('blob:' + APP_ORIGIN + '/ficticio'));
  for (const value of ['http://estudio-tfg.localhost.ejemplo.invalid', 'http://usuario@estudio-tfg.localhost', 'http://estudio-tfg.localhost:8080', 'javascript:alert(1)', 'file:///ficticio', 'dato inválido']) assert.equal(isAppUrl(value), false, value);
  assert(isExternalUrl('https://ejemplo.invalid/recurso'));
  assert(isExternalUrl('http://ejemplo.invalid/'));
  for (const value of [APP_ORIGIN, 'javascript:alert(1)', 'file:///ficticio', 'data:text/html,ficticio', 'https://usuario:secreto@ejemplo.invalid/', 'dato inválido']) assert.equal(isExternalUrl(value), false, value);
});
