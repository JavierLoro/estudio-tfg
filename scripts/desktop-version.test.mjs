import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, nextRelease } from './desktop-version.mjs';

test('incrementa el parche y permite elevar manualmente la versión base', () => {
  const tags = [{ name: 'v0.2.9', commit: 'anterior' }, { name: 'v0.2.10', commit: 'último' },
    { name: 'v9.0.0-rc.1', commit: 'candidata' }, { name: 'distribucion-v9.0.0', commit: 'técnico' }];
  assert.equal(nextRelease('0.2.0', tags, 'nuevo'), 'v0.2.11');
  assert.equal(nextRelease('0.3.0', tags, 'nuevo'), 'v0.3.0');
  assert.equal(nextRelease('1.0.0', tags, 'nuevo'), 'v1.0.0');
  assert.equal(nextRelease('0.2.0', [], 'nuevo'), 'v0.2.0');
});

test('un reintento reutiliza la reserva aunque haya entregas posteriores', () => {
  const tags = [{ name: 'v0.2.1', commit: 'reintento' }, { name: 'v0.2.2', commit: 'posterior' }];
  assert.equal(nextRelease('0.3.0', tags, 'reintento'), 'v0.2.1');
  assert.equal(nextRelease('0.2.0', tags, 'siguiente'), 'v0.2.3');
});

test('compara numéricamente y rechaza versiones ambiguas o candidatas', () => {
  assert.ok(compareVersions('v0.2.10', 'v0.2.9') > 0);
  assert.ok(compareVersions('v0.3.0', 'v0.2.999') > 0);
  assert.equal(compareVersions('v1.0.0', 'v1.0.0'), 0);
  for (const version of ['v0.02.1', 'v0.2', 'v0.2.0-rc.1', 'texto\ntag=otro'])
    assert.throws(() => compareVersions(version, 'v0.2.0'), /no válida/);
  assert.throws(() => nextRelease('0.2.0-rc.1', [], 'nuevo'), /no válida/);
});
