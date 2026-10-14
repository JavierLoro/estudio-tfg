import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { RELEASES_URL, assetUrl, distributionTag } from '../desktop/distribution.mjs';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const yaml = require('yaml');
const [input, output, tag] = process.argv.slice(2);
if (!input || !output || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag ?? '')) throw new Error('Uso: desktop-release.mjs <artefactos> <salida> <tag>');
const auxiliaryTag = distributionTag(tag);
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
for (const folder of ['app', 'auxiliares']) await fs.mkdir(path.join(output, folder), { recursive: true });
const assets = [];
const feeds = new Map();
const engines = new Map();
for (const file of entries) {
  const name = path.basename(file);
  // El actualizador de macOS utiliza el ZIP, no el blockmap del DMG.
  if (name.endsWith('.dmg.blockmap')) continue;
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
    const download = /\.(dmg|exe|AppImage)$/.test(name);
    // NSIS busca el blockmap junto al ejecutable: conserva ambos en la publicación técnica.
    const auxiliary = !download || (name.endsWith('.exe') && !name.endsWith('-portable.exe'));
    const url = assetUrl(auxiliary ? auxiliaryTag : tag, name);
    assets.push({ name, bytes, sha256: hash.digest('hex'), sha512: updateHash.digest('base64'), url,
      ...(download ? { downloadUrl: assetUrl(tag, name) } : {}) });
    if (download) await fs.copyFile(file, path.join(output, 'app', name));
    if (auxiliary) await fs.copyFile(file, path.join(output, 'auxiliares', name));
    if (/^engine-.*\.json$/.test(name)) engines.set(name, JSON.parse(await fs.readFile(file, 'utf8')));
  }
}
for (const [name, feed] of feeds) {
  for (const file of feed.files) {
    const asset = assets.find(asset => asset.name === decodeURIComponent(file.url));
    if (!asset || asset.sha512 !== file.sha512) throw new Error(`Feed de actualización sin asset verificado: ${file.url}`);
    file.url = asset.url;
  }
  if (feed.path) {
    const asset = assets.find(asset => asset.name === decodeURIComponent(feed.path));
    if (!asset || asset.sha512 !== feed.sha512) throw new Error(`Feed heredado sin asset verificado: ${feed.path}`);
    feed.path = asset.url;
  }
  await fs.writeFile(path.join(output, 'auxiliares', name), yaml.stringify(feed));
}
for (const check of checks) {
  const archive = assets.find(asset => asset.name.endsWith(`-tex-${check.platform}.tar.gz`));
  if (!archive || archive.sha256 !== check.sha256 || archive.bytes !== check.bytes) throw new Error(`El asset no coincide con el paquete verificado: ${check.platform}`);
  const engine = engines.get(`engine-${check.platform}.json`);
  if (!engine || engine.platform !== check.platform || engine.url !== archive.url || engine.sha256 !== archive.sha256 || engine.bytes !== archive.bytes)
    throw new Error(`El manifiesto TeX no coincide con la distribución: ${check.platform}`);
}
for (const variant of ['offline', 'online']) {
  for (const suffix of ['', '-mac', '-linux']) if (!feeds.has(`${variant}${suffix}.yml`)) throw new Error(`Falta el feed ${variant}${suffix}.yml`);
  for (const [platform, os, arch, formats] of [
    ['darwin-arm64', 'mac', 'arm64', ['dmg', 'zip']], ['darwin-x64', 'mac', 'x64', ['dmg', 'zip']],
    ['win32-x64', 'win', 'x64', ['exe', 'portable.exe']], ['linux-x64', 'linux', 'x86_64', ['AppImage']],
  ]) for (const format of formats) {
    const name = `estudio-tfg-${tag.slice(1)}-${os}-${arch}-${variant}${format === 'portable.exe' ? '-portable.exe' : '.' + format}`;
    if (!assets.some(asset => asset.name === name)) throw new Error(`Falta el paquete ${platform}/${variant}: ${name}`);
    if (['zip', 'exe'].includes(format) && !assets.some(asset => asset.name === name + '.blockmap')) throw new Error(`Falta el blockmap: ${name}`);
  }
}
const manifest = JSON.stringify({ schema: 1, tag, auxiliaryTag, commit: process.env.GITHUB_SHA, assets, checks }, null, 2);
for (const folder of ['app', 'auxiliares']) await fs.writeFile(path.join(output, folder, 'manifest.json'), manifest);
await fs.writeFile(path.join(output, 'NOTAS.md'), `# Estudio TFG ${tag}\n\nRelease borrador de prueba sin firma. No se publica automáticamente.\n\n` +
  `<!-- distribucion:${auxiliaryTag} -->\n\n` +
  `Completa/offline incluye TeX; ligera/online descarga el paquete verificado una vez. Ambas compilan localmente y luego funcionan sin red, sin TeX/Docker/Perl externos.\n\n` +
  `## Descargas\n\n| Archivo | Tamaño (MB) |\n|---|---:|\n` +
  assets.filter(asset => asset.downloadUrl).map(asset => `| [${asset.name}](${asset.downloadUrl}) | ${(asset.bytes / 1e6).toFixed(1)} |`).join('\n') + '\n\n' +
  `Los motores TeX y auxiliares se conservan en la [distribución técnica](${RELEASES_URL}/tag/${auxiliaryTag}); no necesitas descargarlos a mano.\n\n` +
  `Código fuente: https://github.com/JavierLoro/estudio-tfg/tree/${tag}\n\n` +
  `| Plataforma | Variante | Perfiles | TeX descarga (MB) | TeX descomprimido (MB) |\n|---|---|---|---:|---:|\n` +
  checks.map(check => `| ${check.platform} | ${check.variant} | generico / esi-uclm, 0 diagnósticos | ${(check.bytes / 1e6).toFixed(1)} | ${(check.installedBytes / 1e6).toFixed(1)} |`).join('\n') +
  '\n\nSHA-256, tamaños, enlaces y evidencia: `manifest.json`. Al publicar esta release se habilita su distribución técnica; las versiones estables actualizan el canal únicamente si son la release estable más reciente. Firma/notarización y actualización automática macOS corresponden a G6.\n');
