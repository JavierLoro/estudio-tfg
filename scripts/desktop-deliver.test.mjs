import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deliverRelease } from './desktop-deliver.mjs';
import { distributionTag } from '../desktop/distribution.mjs';

async function fixture(t, { tag = 'v0.2.1', latest = 'v0.2.0', published = false, deny = false, interrupted = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-deliver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const commit = 'a'.repeat(40), auxiliaryTag = distributionTag(tag);
  const manifest = { tag, auxiliaryTag, commit };
  for (const folder of ['app', 'auxiliares']) {
    await fs.mkdir(path.join(root, folder));
    await fs.writeFile(path.join(root, folder, 'manifest.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(root, folder, 'asset-ficticio'), 'No es un instalador');
  }
  await fs.writeFile(path.join(root, 'NOTAS.md'), 'Notas ficticias');
  const releases = new Map(published ? [[tag, { isDraft: false, isPrerelease: false }]] : []);
  const calls = [];
  const gh = async args => {
    calls.push(args);
    if (deny) throw Object.assign(new Error('Sin permisos'), { stderr: 'HTTP 403: Forbidden' });
    if (args[0] === 'api') {
      if (latest) return JSON.stringify({ tag_name: latest });
      throw Object.assign(new Error('Sin estable'), { stderr: 'HTTP 404: Not Found' });
    }
    const [, command, id] = args;
    if (command === 'view') {
      if (releases.has(id)) return JSON.stringify(releases.get(id));
      throw Object.assign(new Error('No existe'), { stderr: 'release not found' });
    }
    if (command === 'create') {
      assert.ok(!releases.has(id), 'No se crean borradores duplicados');
      releases.set(id, { isDraft: true, isPrerelease: args.includes('--prerelease') });
    }
    if (command === 'upload') {
      assert.ok(releases.get(id).isDraft, 'Nunca se sobrescriben archivos públicos');
      assert.ok(args.includes('--clobber'));
      if (interrupted && id === tag) { interrupted = false; throw new Error('Subida interrumpida'); }
    }
    if (command === 'edit' && args.includes('--draft=false')) releases.get(id).isDraft = false;
    return '';
  };
  return { root, tag, commit, gh, calls, releases };
}

test('publica una estable tras subir ambos borradores y marca Latest', async t => {
  for (const latest of [null, 'v0.2.0']) {
    const f = await fixture(t, { latest });
    assert.match(await deliverRelease(f.root, f.tag, f.commit, true, f.gh), /estable publicada/);
    const publication = f.calls.findIndex(args => args.includes('--draft=false'));
    assert.ok(publication > f.calls.findLastIndex(args => args[1] === 'upload'));
    assert.ok(f.calls[publication].includes('--latest=true'));
    assert.equal(f.releases.get(f.tag).isDraft, false);
    assert.equal(f.releases.get(distributionTag(f.tag)).isDraft, true);
  }
});

test('una candidata manual se conserva en borrador y no toca Latest', async t => {
  const f = await fixture(t, { tag: 'v0.3.0-rc.1' });
  assert.match(await deliverRelease(f.root, f.tag, f.commit, false, f.gh), /publicación manual/);
  assert.equal(f.releases.get(f.tag).isDraft, true);
  assert.equal(f.releases.get(f.tag).isPrerelease, true);
  assert.ok(!f.calls.some(args => args.includes('--draft=false')));
  await assert.rejects(deliverRelease(f.root, f.tag, f.commit, true, f.gh), /no válida/);
});

test('reintenta una subida parcial sin duplicar releases ni publicar archivos incompletos', async t => {
  const f = await fixture(t, { interrupted: true });
  await assert.rejects(deliverRelease(f.root, f.tag, f.commit, true, f.gh), /interrumpida/);
  assert.ok(!f.calls.some(args => args.includes('--draft=false')));
  await deliverRelease(f.root, f.tag, f.commit, true, f.gh);
  assert.equal(f.calls.filter(args => args[1] === 'create').length, 2);
  assert.equal(f.releases.get(f.tag).isDraft, false);
});

test('un reintento antiguo o ya publicado conserva la estable más reciente y sus archivos', async t => {
  const old = await fixture(t, { latest: 'v0.3.0' });
  await deliverRelease(old.root, old.tag, old.commit, true, old.gh);
  assert.ok(old.calls.find(args => args.includes('--draft=false')).includes('--latest=false'));
  const done = await fixture(t, { published: true });
  assert.match(await deliverRelease(done.root, done.tag, done.commit, true, done.gh), /ya publicada/);
  assert.ok(!done.calls.some(args => ['upload', 'edit', 'create'].includes(args[1])));
});

test('un commit distinto o un error de permisos detiene la entrega', async t => {
  const f = await fixture(t);
  await assert.rejects(deliverRelease(f.root, f.tag, 'b'.repeat(40), true, f.gh), /manifiesto/);
  assert.equal(f.calls.length, 0);
  const denied = await fixture(t, { deny: true });
  await assert.rejects(deliverRelease(denied.root, denied.tag, denied.commit, true, denied.gh), /Sin permisos/);
  assert.equal(denied.calls.length, 1);
});

test('no publica con auxiliares incompatibles ni modifica una prerelease pública', async t => {
  for (const auxiliary of [{ isDraft: false, isPrerelease: true }, { isDraft: true, isPrerelease: false }]) {
    const f = await fixture(t);
    f.releases.set(distributionTag(f.tag), auxiliary);
    await assert.rejects(deliverRelease(f.root, f.tag, f.commit, true, f.gh), /auxiliares/);
    assert.ok(!f.calls.some(args => ['upload', 'edit', 'create'].includes(args[1])));
  }
  const f = await fixture(t, { published: true });
  f.releases.get(f.tag).isPrerelease = true;
  await assert.rejects(deliverRelease(f.root, f.tag, f.commit, true, f.gh), /prerelease pública/);
});
