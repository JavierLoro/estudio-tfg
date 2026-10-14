import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assetUrl, distributionTag } from '../desktop/distribution.mjs';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const yaml = require('yaml');
const exec = promisify(execFile);

test('separa instaladores y auxiliares, fija enlaces y rechaza una distribución incompleta', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-release-'));
  const tag = 'v0.2.0-rc.1';
  try {
    for (const platform of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
      const dir = path.join(root, 'input', platform); await fs.mkdir(dir, { recursive: true });
      const content = Buffer.from(`Asset ficticio ${platform}`);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      const archive = `estudio-tfg-0.2.0-rc.1-tex-${platform}.tar.gz`;
      await fs.writeFile(path.join(dir, archive), content);
      await fs.writeFile(path.join(dir, `engine-${platform}.json`), JSON.stringify({ platform, sha256, bytes: content.length,
        url: assetUrl(distributionTag(tag), archive) }));
      for (const variant of ['offline', 'online']) {
        const sub = path.join(dir, variant); await fs.mkdir(sub);
        await fs.writeFile(path.join(sub, 'verificacion.json'), JSON.stringify({ platform, variant, sha256, bytes: content.length,
          installedBytes: content.length, results: ['generico', 'esi-uclm'].map(perfil => ({ perfil, diagnostics: [] })), biblioteca: true }));
        const [os, arch, formats, suffix] = platform.startsWith('darwin') ? ['mac', platform.split('-')[1], ['zip', 'dmg'], '-mac'] :
          platform.startsWith('win32') ? ['win', 'x64', ['exe', 'portable.exe'], ''] : ['linux', 'x86_64', ['AppImage'], '-linux'];
        const names = [];
        for (const format of formats) {
          const name = `estudio-tfg-${tag.slice(1)}-${os}-${arch}-${variant}${format === 'portable.exe' ? '-portable.exe' : '.' + format}`;
          await fs.writeFile(path.join(sub, name), content);
          if (['zip', 'dmg', 'exe'].includes(format)) await fs.writeFile(path.join(sub, name + '.blockmap'), content);
          if (format !== 'portable.exe') names.push(name);
        }
        const sha512 = crypto.createHash('sha512').update(content).digest('base64');
        await fs.writeFile(path.join(sub, `${variant}${suffix}.yml`), yaml.stringify({ version: tag.slice(1),
          files: names.map(url => ({ url, sha512 })), path: names[0], sha512 }));
      }
    }
    const run = output => exec(process.execPath, [fileURLToPath(new URL('./desktop-release.mjs', import.meta.url)), path.join(root, 'input'), path.join(root, output), tag]);
    await run('release');
    const mainFiles = await fs.readdir(path.join(root, 'release/app'));
    const technicalFiles = await fs.readdir(path.join(root, 'release/auxiliares'));
    assert.equal(mainFiles.length, 11);
    assert.equal(technicalFiles.length, 27);
    assert.ok(mainFiles.every(name => /\.(dmg|exe|AppImage)$/.test(name) || name === 'manifest.json'));
    assert.ok(!technicalFiles.some(name => name.endsWith('.dmg.blockmap') || name.endsWith('-portable.exe')));
    const mac = yaml.parse(await fs.readFile(path.join(root, 'release/auxiliares/offline-mac.yml'), 'utf8'));
    assert.equal(mac.files.length, 4);
    assert.ok(mac.files.filter(file => file.url.endsWith('.zip')).every(file => file.url.includes(`/distribucion-${tag}/`)));
    assert.ok(mac.files.filter(file => file.url.endsWith('.dmg')).every(file => file.url.includes(`/download/${tag}/`)));
    assert.ok(mac.path.endsWith('.zip'));
    const windows = yaml.parse(await fs.readFile(path.join(root, 'release/auxiliares/online.yml'), 'utf8'));
    assert.ok(windows.files[0].url.includes(`/distribucion-${tag}/`));
    assert.equal(windows.path, windows.files[0].url);
    const linux = yaml.parse(await fs.readFile(path.join(root, 'release/auxiliares/online-linux.yml'), 'utf8'));
    assert.ok(linux.files[0].url.includes(`/download/${tag}/`));
    const manifest = await fs.readFile(path.join(root, 'release/app/manifest.json'), 'utf8');
    assert.equal(manifest, await fs.readFile(path.join(root, 'release/auxiliares/manifest.json'), 'utf8'));
    assert.equal(JSON.parse(manifest).checks.length, 8);
    const notes = await fs.readFile(path.join(root, 'release/NOTAS.md'), 'utf8');
    assert.ok(notes.includes(`<!-- distribucion:distribucion-${tag} -->`));
    for (const file of mainFiles.filter(name => name !== 'manifest.json')) assert.ok(notes.includes(assetUrl(tag, file)));
    const feed = path.join(root, 'input/darwin-arm64/offline/offline-mac.yml');
    const original = await fs.readFile(feed, 'utf8');
    await fs.writeFile(feed, original.replace('estudio-tfg-0.2.0-rc.1-mac-arm64-offline.zip', 'inexistente.zip'));
    await assert.rejects(run('bad-feed'), /sin asset verificado/);
    await fs.writeFile(feed, original);
    const engine = path.join(root, 'input/linux-x64/engine-linux-x64.json');
    const engineOriginal = await fs.readFile(engine, 'utf8');
    await fs.writeFile(engine, engineOriginal.replace(`/distribucion-${tag}/`, `/${tag}/`));
    await assert.rejects(run('bad-engine'), /manifiesto TeX no coincide/);
    await fs.writeFile(engine, engineOriginal);
    const blockmap = path.join(root, 'input/win32-x64/online/estudio-tfg-0.2.0-rc.1-win-x64-online.exe.blockmap');
    await fs.rm(blockmap);
    await assert.rejects(run('missing-blockmap'), /Falta el blockmap/);
    await fs.writeFile(blockmap, 'ficticio');
    await fs.rm(path.join(root, 'input/win32-x64/online/verificacion.json'));
    await assert.rejects(run('pending'), /win32-x64\/online/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
