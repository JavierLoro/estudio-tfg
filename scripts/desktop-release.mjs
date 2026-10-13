import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const yaml = require('yaml');
const [input, output, tag] = process.argv.slice(2);
if (!input || !output || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag ?? '')) throw new Error('Uso: desktop-release.mjs <artefactos> <salida> <tag>');
async function files(root) {
  const result = [];
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    if (item.isDirectory()) result.push(...await files(file)); else if (item.isFile()) result.push(file);
  }
  return result;
}
const entries = await files(input);
const checks = await Promise.all(entries.filter(file => path.basename(file) === 'verificacion.json').map(async file => JSON.parse(await fs.readFile(file, 'utf8'))));
for (const platform of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) for (const variant of ['offline', 'online']) {
  const check = checks.find(check => check.platform === platform && check.variant === variant);
  if (!check || !['generico', 'esi-uclm'].every(profile => check.results.some(result => result.perfil === profile && result.diagnostics.length === 0)) || !check.biblioteca)
    throw new Error(`Falta verificación completa de ${platform}/${variant}`);
}
await fs.mkdir(output, { recursive: true });
const assets = [];
const feeds = new Map();
for (const file of entries) {
  const name = path.basename(file);
  if (/^(offline|online)(?:-mac|-linux)?\.yml$/.test(name)) {
    const feed = yaml.parse(await fs.readFile(file, 'utf8'));
    if (feed.version !== tag.slice(1)) throw new Error(`Feed de otra versión: ${file}`);
    const merged = feeds.get(name);
    if (merged) {
      for (const item of feed.files) if (!merged.files.some(existing => existing.url === item.url)) merged.files.push(item);
    } else feeds.set(name, feed);
  } else if (/\.(dmg|zip|exe|AppImage|blockmap|tar\.gz)$/.test(name) || /^engine-.*\.json$/.test(name)) {
    if (assets.some(asset => asset.name === name)) throw new Error(`Asset duplicado: ${name}`);
    const hash = crypto.createHash('sha256'), updateHash = crypto.createHash('sha512');
    for await (const chunk of createReadStream(file)) { hash.update(chunk); updateHash.update(chunk); }
    const bytes = (await fs.stat(file)).size;
    assets.push({ name, bytes, sha256: hash.digest('hex'), sha512: updateHash.digest('base64') });
    await fs.copyFile(file, path.join(output, name));
  }
}
for (const [name, feed] of feeds) {
  for (const file of feed.files) {
    const asset = assets.find(asset => asset.name === decodeURIComponent(file.url));
    if (!asset || asset.sha512 !== file.sha512) throw new Error(`Feed de actualización sin asset verificado: ${file.url}`);
  }
  await fs.writeFile(path.join(output, name), yaml.stringify(feed));
}
for (const check of checks) {
  const archive = assets.find(asset => asset.name.endsWith(`-tex-${check.platform}.tar.gz`));
  if (!archive || archive.sha256 !== check.sha256 || archive.bytes !== check.bytes) throw new Error(`El asset no coincide con el paquete verificado: ${check.platform}`);
}
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schema: 1, tag, commit: process.env.GITHUB_SHA, assets, checks }, null, 2));
await fs.writeFile(path.join(output, 'NOTAS.md'), `# Estudio TFG ${tag}\n\nRelease borrador de prueba sin firma. No se publica automáticamente.\n\n` +
  `Completa/offline incluye TeX; ligera/online descarga el paquete de esta misma release una vez. Ambas compilan localmente y luego funcionan sin red, sin TeX/Docker/Perl externos.\n\n` +
  `Código fuente: https://github.com/JavierLoro/estudio-tfg/tree/${tag}\n\n` +
  `| Plataforma | Variante | Perfiles | TeX descarga (MB) | TeX descomprimido (MB) |\n|---|---|---|---:|---:|\n` +
  checks.map(check => `| ${check.platform} | ${check.variant} | generico / esi-uclm, 0 diagnósticos | ${(check.bytes / 1e6).toFixed(1)} | ${(check.installedBytes / 1e6).toFixed(1)} |`).join('\n') +
  '\n\nSHA-256 y tamaños de los instaladores/portables: `manifest.json`. Citas, figuras y copias trasladadas comprobadas por plataforma. Firma/notarización y actualización automática macOS corresponden a G6.\n');
