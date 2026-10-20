import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildConfig } from '../desktop/electron-builder.mjs';
import { command } from './desktop-tex.mjs';
import { writeCredits } from '../desktop/credits.mjs';

const require = createRequire(new URL('../desktop/package.json', import.meta.url));
const { build } = require('electron-builder');
const repo = path.resolve(import.meta.dirname, '..');
const [assets, releaseTag, variant, target = 'distribute'] = process.argv.slice(2);
const platform = `${process.platform}-${process.arch}`;
if (!assets || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(releaseTag ?? '') || !['offline', 'online'].includes(variant))
  throw new Error('Uso: node scripts/desktop-build.mjs <assets-TeX> <vX.Y.Z> <offline|online> [dir]');
const root = path.join(repo, 'desktop/dist', platform, variant);
const runtime = path.join(root, 'runtime');
await fs.rm(runtime, { recursive: true, force: true });
await fs.rm(path.join(root, 'release'), { recursive: true, force: true });
await fs.rm(path.join(root, 'verificacion.json'), { force: true });
await fs.mkdir(runtime, { recursive: true });
await fs.copyFile(path.join(repo, 'desktop/runtime-package.json'), path.join(runtime, 'package.json'));
await fs.copyFile(path.join(repo, 'desktop/runtime-package-lock.json'), path.join(runtime, 'package-lock.json'));
const npmCli = process.env.npm_execpath;
if (npmCli) await command(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts'], runtime);
else if (process.platform === 'win32') await command(process.execPath, [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'ci', '--omit=dev', '--ignore-scripts'], runtime);
else await command('npm', ['ci', '--omit=dev', '--ignore-scripts'], runtime);
for (const folder of ['desktop', 'scripts', 'worker']) {
  await fs.mkdir(path.join(runtime, folder), { recursive: true });
  for (const file of await fs.readdir(path.join(repo, folder))) {
    const needed = folder === 'desktop' || (folder === 'scripts' ? ['memoria-template.mjs', 'system-files.mjs'].includes(file) : ['engine.mjs', 'parse-log.mjs', 'untar.mjs', 'svg.mjs'].includes(file));
    if (needed && file.endsWith('.mjs') && !file.endsWith('.test.mjs') && file !== 'electron-builder.mjs')
      await fs.copyFile(path.join(repo, folder, file), path.join(runtime, folder, file));
  }
}
for (const folder of ['server/dist', 'web/dist', 'templates']) await fs.cp(path.join(repo, folder), path.join(runtime, folder), { recursive: true });
await fs.copyFile(path.join(repo, 'LICENSE'), path.join(runtime, 'LICENSE'));
await fs.cp(path.join(repo, 'desktop/icons'), path.join(runtime, 'desktop/icons'), { recursive: true });
await command(process.execPath, ['--input-type=module', '-e', 'import {pathToFileURL} from "node:url"; const file=process.argv[1]; delete process.argv[1]; await import(pathToFileURL(file).href);', path.join(runtime, 'server/dist/server.mjs')], runtime);
const manifest = JSON.parse(await fs.readFile(path.join(assets, `engine-${platform}.json`), 'utf8'));
await writeCredits({ repo, runtime, assets, manifest, source: `https://github.com/JavierLoro/estudio-tfg/tree/${releaseTag}` });
await fs.writeFile(path.join(runtime, 'desktop/engine-manifest.json'), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(runtime, 'desktop/distribution.json'), JSON.stringify({ variant, releaseTag, platform }));
if (variant === 'offline') await fs.copyFile(path.join(assets, new URL(manifest.url).pathname.split('/').at(-1)), path.join(runtime, 'desktop/engine.tar.gz'));
else await fs.rm(path.join(runtime, 'desktop/engine.tar.gz'), { force: true });
const config = buildConfig(runtime, path.join(root, 'release'), variant, releaseTag.slice(1));
await build({ config, ...(target === 'dir' ? { dir: true } : {}), publish: 'never' });
await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ root, runtime, output: config.directories.output, variant, platform, manifest }, null, 2));
console.log(`Paquete ${variant}: ${config.directories.output}`);
