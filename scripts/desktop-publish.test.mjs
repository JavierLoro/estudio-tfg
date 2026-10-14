import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { publishDistribution } from './desktop-publish.mjs';
import { assetUrl, distributionTag } from '../desktop/distribution.mjs';

function fixture({ tag = 'v0.2.0', draft = false, prerelease = false, legacy = false, auxiliaryDraft = true,
  latest = tag, badFeed = false, existingChannel = false, channelError = false } = {}) {
  const calls = [];
  const auxiliaryTag = distributionTag(tag);
  const gh = async args => {
    calls.push(args);
    if (args[0] === 'api') return JSON.stringify({ tag_name: latest });
    const [, command, target] = args;
    if (command === 'view') {
      if (target === tag) return JSON.stringify({ isDraft: draft, isPrerelease: prerelease,
        body: legacy ? 'Notas anteriores' : `<!-- distribucion:${auxiliaryTag} -->` });
      if (target === auxiliaryTag) return JSON.stringify({ isDraft: auxiliaryDraft, isPrerelease: true });
      if (existingChannel) return JSON.stringify({ isDraft: false, isPrerelease: true });
      throw Object.assign(new Error('gh falló'), { stderr: channelError ? 'HTTP 403: forbidden' : 'HTTP 404: Not Found' });
    }
    if (command === 'download') {
      const root = args[args.indexOf('--dir') + 1];
      const url = assetUrl(auxiliaryTag, `estudio-tfg-${tag.slice(1)}-win-x64-online.exe`);
      await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ tag, auxiliaryTag, assets: [{ url, sha512: 'hash-verificado' }] }));
      for (const variant of ['offline', 'online']) for (const suffix of ['', '-mac', '-linux'])
        await fs.writeFile(path.join(root, `${variant}${suffix}.yml`), JSON.stringify({ version: badFeed ? '9.9.9' : tag.slice(1),
          files: [{ url, sha512: 'hash-verificado' }], path: url, sha512: 'hash-verificado' }));
    }
    if (command === 'upload') {
      assert.equal(target, 'actualizaciones');
      const files = args.slice(3, -1);
      assert.equal(files.length, 6);
      for (const file of files) assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).version, tag.slice(1));
    }
    return '';
  };
  return { tag, gh, calls };
}

test('publicar la última estable habilita auxiliares y sus seis feeds; permite reintentar', async () => {
  for (const existingChannel of [false, true]) {
    const f = fixture({ existingChannel, auxiliaryDraft: !existingChannel });
    assert.match(await publishDistribution(f.tag, f.gh), /canales estables actualizados/);
    assert.equal(f.calls.filter(args => args[1] === 'edit').length, existingChannel ? 0 : 1);
    assert.equal(f.calls.filter(args => args[1] === 'create').length, existingChannel ? 0 : 1);
    assert.equal(f.calls.filter(args => args[1] === 'upload').length, 1);
    const create = f.calls.find(args => args[1] === 'create');
    if (create) { assert.ok(create.includes('--prerelease')); assert.ok(create.includes('--latest=false')); }
  }
});

test('una candidata o estable antigua habilita sus motores y conserva el canal vigente', async () => {
  for (const options of [{ tag: 'v0.2.0-rc.4', prerelease: true }, { latest: 'v0.3.0' }]) {
    const f = fixture(options);
    await publishDistribution(f.tag, f.gh);
    assert.equal(f.calls.filter(args => args[1] === 'edit').length, 1);
    assert.ok(!f.calls.some(args => ['create', 'upload'].includes(args[1])));
  }
});

test('borradores, releases anteriores y feeds incorrectos no se publican', async () => {
  for (const options of [{ draft: true }, { legacy: true }, { badFeed: true }]) {
    const f = fixture(options);
    if (options.legacy) assert.match(await publishDistribution(f.tag, f.gh), /anterior/);
    else await assert.rejects(publishDistribution(f.tag, f.gh), /borrador|otra versión/);
    assert.ok(!f.calls.some(args => ['edit', 'create', 'upload'].includes(args[1])));
  }
});

test('un error de permisos no se interpreta como un canal inexistente', async () => {
  const f = fixture({ channelError: true });
  await assert.rejects(publishDistribution(f.tag, f.gh), /gh falló/);
  assert.ok(!f.calls.some(args => ['create', 'upload'].includes(args[1])));
});
