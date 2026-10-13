import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lock, packagesFrom, packTex } from './desktop-tex.mjs';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { extractTar } from '../worker/untar.mjs';

test('la resolución TeX fija la arquitectura y rechaza dependencias sin registro', () => {
  const entries = ['scheme-basic', 'texlive.infra', 'texlive-scripts', ...lock.packages]
    .map(name => `name ${name}\nrevision 1${name === 'biber' ? '\ndepend biber.ARCH' : ''}`);
  const source = [...entries, 'name biber.universal-darwin\nrevision 2', 'name biber.windows\nrevision 3', ...['tlperl.windows', 'tlgs.windows'].map(name => `name ${name}\nrevision 1`)].join('\n\n');
  const selected = packagesFrom(source, 'universal-darwin');
  assert.equal(selected.get('biber.universal-darwin').revision[0], '2');
  assert.equal(selected.has('biber.windows'), false);
  const windows = packagesFrom(source.replace('name scheme-basic\nrevision 1', 'name scheme-basic\nrevision 1\ndepend xdvi.ARCH') + '\n\nname xdvi.universal-darwin\nrevision 1', 'windows');
  assert.equal(windows.has('biber.windows'), true); assert.equal(windows.has('xdvi.windows'), false);
  assert.throws(() => packagesFrom(source.replace('depend biber.ARCH', 'depend ausente'), 'universal-darwin'), /desconocida/);
});

test('el archivo gzip termina y puede extraerse con el lector de la app', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-pack-'));
  try {
    const tree = path.join(root, 'tree'), unpacked = path.join(root, 'unpacked');
    await fs.mkdir(path.join(tree, 'bin'), { recursive: true }); await fs.mkdir(unpacked);
    await fs.writeFile(path.join(tree, 'bin/perl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await fs.link(path.join(tree, 'bin/perl'), path.join(tree, 'bin/perl-alias'));
    for (let n = 0; n < 100; n++) await fs.writeFile(path.join(tree, `fixture-${n}.txt`), 'Contenido ficticio\n'.repeat(100));
    const archive = path.join(root, 'engine.tar.gz'); await packTex(tree, archive);
    await extractTar(createReadStream(archive).pipe(createGunzip()), unpacked, { preserveMode: true });
    assert.equal(await fs.readFile(path.join(unpacked, 'fixture-99.txt'), 'utf8'), 'Contenido ficticio\n'.repeat(100));
    assert.equal(await fs.readFile(path.join(unpacked, 'bin/perl-alias'), 'utf8'), '#!/bin/sh\nexit 0\n');
    if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(unpacked, 'bin/perl'))).mode & 0o777, 0o755);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
