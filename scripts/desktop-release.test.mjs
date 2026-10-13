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
const require = createRequire(new URL('../server/package.json', import.meta.url));
const yaml = require('yaml');
const exec = promisify(execFile);

test('la release reúne arquitecturas y rechaza una plataforma pendiente o feeds ajenos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-release-'));
  const tag = 'v0.2.0-rc.1';
  try {
    for (const platform of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
      const dir = path.join(root, 'input', platform); await fs.mkdir(dir, { recursive: true });
      const content = Buffer.from(`Asset ficticio ${platform}`);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      await fs.writeFile(path.join(dir, `estudio-tfg-0.2.0-rc.1-tex-${platform}.tar.gz`), content);
      for (const variant of ['offline', 'online']) {
        const sub = path.join(dir, variant); await fs.mkdir(sub);
        await fs.writeFile(path.join(sub, 'verificacion.json'), JSON.stringify({ platform, variant, sha256, bytes: content.length,
          installedBytes: content.length, results: ['generico', 'esi-uclm'].map(perfil => ({ perfil, diagnostics: [] })), biblioteca: true }));
        if (platform.startsWith('darwin')) {
          const name = `estudio-${platform}-${variant}.zip`;
          await fs.writeFile(path.join(sub, name), content);
          await fs.writeFile(path.join(sub, `${variant}-mac.yml`), yaml.stringify({ version: tag.slice(1), files: [{ url: name,
            sha512: crypto.createHash('sha512').update(content).digest('base64') }] }));
        }
      }
    }
    const run = output => exec(process.execPath, [fileURLToPath(new URL('./desktop-release.mjs', import.meta.url)), path.join(root, 'input'), path.join(root, output), tag]);
    await run('release');
    assert.equal(yaml.parse(await fs.readFile(path.join(root, 'release/offline-mac.yml'), 'utf8')).files.length, 2);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'release/manifest.json'), 'utf8')).checks.length, 8);
    const feed = path.join(root, 'input/darwin-arm64/offline/offline-mac.yml');
    const original = await fs.readFile(feed, 'utf8');
    await fs.writeFile(feed, original.replace('estudio-darwin-arm64-offline.zip', 'inexistente.zip'));
    await assert.rejects(run('bad-feed'), /sin asset verificado/);
    await fs.writeFile(feed, original);
    await fs.rm(path.join(root, 'input/win32-x64/online/verificacion.json'));
    await assert.rejects(run('pending'), /win32-x64\/online/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
