import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { distributionTag, UPDATE_TAG } from '../desktop/distribution.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const yaml = require('yaml');
const exec = promisify(execFile);
const repository = 'JavierLoro/estudio-tfg';
const feedNames = ['offline.yml', 'online.yml', 'offline-mac.yml', 'online-mac.yml', 'offline-linux.yml', 'online-linux.yml'];

export async function publishDistribution(tag, gh = async args => (await exec('gh', args)).stdout) {
  const auxiliaryTag = distributionTag(tag);
  const release = JSON.parse(await gh(['release', 'view', tag, '--json', 'isDraft,isPrerelease,body']));
  if (release.isDraft) throw new Error('La release principal sigue en borrador');
  // Las releases anteriores conservan sus assets y su proceso de publicación.
  if (!release.body.includes(`<!-- distribucion:${auxiliaryTag} -->`)) return 'Release anterior: no se modifican sus archivos';
  const auxiliary = JSON.parse(await gh(['release', 'view', auxiliaryTag, '--json', 'isDraft,isPrerelease']));
  if (!auxiliary.isPrerelease) throw new Error('La distribución técnica debe estar marcada como prerelease');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-publish-'));
  try {
    await gh(['release', 'download', auxiliaryTag, '--dir', root, '--pattern', '*.yml', '--pattern', 'manifest.json']);
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    if (manifest.tag !== tag || manifest.auxiliaryTag !== auxiliaryTag) throw new Error('Manifiesto de otra distribución');
    for (const name of feedNames) {
      const feed = yaml.parse(await fs.readFile(path.join(root, name), 'utf8'));
      if (feed.version !== tag.slice(1) || !feed.files?.length) throw new Error(`Feed de otra versión o vacío: ${name}`);
      for (const file of feed.files) if (!manifest.assets.some(asset => asset.url === file.url && asset.sha512 === file.sha512))
        throw new Error(`Feed sin asset verificado: ${name}`);
      if (feed.path && !manifest.assets.some(asset => asset.url === feed.path && asset.sha512 === feed.sha512))
        throw new Error(`Feed heredado sin asset verificado: ${name}`);
    }
    if (auxiliary.isDraft) await gh(['release', 'edit', auxiliaryTag, '--draft=false', '--prerelease', '--latest=false']);
    if (release.isPrerelease || tag.includes('-')) return 'Distribución de prueba habilitada; canal estable sin cambios';
    const latest = JSON.parse(await gh(['api', `repos/${repository}/releases/latest`]));
    if (latest.tag_name !== tag) return 'Distribución habilitada; una release posterior conserva el canal estable';
    let channel;
    try { channel = JSON.parse(await gh(['release', 'view', UPDATE_TAG, '--json', 'isDraft,isPrerelease'])); }
    catch (error) {
      if (!/HTTP 404|release not found/i.test(error.stderr ?? '')) throw error;
      await gh(['release', 'create', UPDATE_TAG, '--prerelease', '--latest=false',
        '--title', 'Canales de actualización (archivos técnicos)', '--notes', 'Metadatos del actualizador. Descarga los instaladores desde las releases de Estudio TFG.']);
    }
    if (channel && (channel.isDraft || !channel.isPrerelease)) throw new Error('El canal técnico tiene un estado inesperado');
    await gh(['release', 'upload', UPDATE_TAG, ...feedNames.map(name => path.join(root, name)), '--clobber']);
    return 'Distribución habilitada y canales estables actualizados';
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(await publishDistribution(process.argv[2]));
}
