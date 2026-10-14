import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { distributionTag, RELEASES_URL } from '../desktop/distribution.mjs';
import { compareVersions } from './desktop-version.mjs';

const exec = promisify(execFile);
export async function deliverRelease(root, tag, commit, publish, gh = async args => (await exec('gh', args)).stdout) {
  const auxiliaryTag = distributionTag(tag);
  if (publish) compareVersions(tag, tag);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'app/manifest.json'), 'utf8'));
  if (manifest.tag !== tag || manifest.auxiliaryTag !== auxiliaryTag || manifest.commit !== commit)
    throw new Error('El manifiesto no corresponde al tag y commit de esta entrega');
  const optional = async args => {
    try { return JSON.parse(await gh(args)); }
    catch (error) { if (/HTTP 404|release not found/i.test(error.stderr ?? '')) return null; throw error; }
  };
  const view = id => optional(['release', 'view', id, '--json', 'isDraft,isPrerelease']);
  const main = await view(tag);
  if (main && !main.isDraft) {
    if (publish && main.isPrerelease) throw new Error('La versión reservada ya es una prerelease pública');
    return 'Release ya publicada: se conservan todos sus archivos';
  }
  const auxiliary = await view(auxiliaryTag);
  if (auxiliary && !auxiliary.isDraft) throw new Error('Los auxiliares ya están publicados; no se reemplaza la app con otro build');
  if (auxiliary && !auxiliary.isPrerelease) throw new Error('Los auxiliares deben conservarse como prerelease técnica');
  if (!auxiliary) await gh(['release', 'create', auxiliaryTag, '--draft', '--prerelease', '--latest=false', '--target', commit,
    '--title', `Distribución técnica ${tag}`, '--notes', `Archivos técnicos de Estudio TFG ${tag}. Instaladores: ${RELEASES_URL}/tag/${tag}`]);
  if (!main) await gh(['release', 'create', tag, '--draft', '--verify-tag', '--title', `Estudio TFG ${tag} (sin firma)`,
    '--notes-file', path.join(root, 'NOTAS.md'), ...(tag.includes('-') ? ['--prerelease'] : [])]);
  for (const [id, folder] of [[auxiliaryTag, 'auxiliares'], [tag, 'app']]) {
    const files = (await fs.readdir(path.join(root, folder))).map(name => path.join(root, folder, name));
    await gh(['release', 'upload', id, ...files, '--clobber']);
  }
  await gh(['release', 'edit', tag, '--notes-file', path.join(root, 'NOTAS.md'), `--prerelease=${tag.includes('-')}`]);
  if (!publish) return 'Borradores verificados preparados para publicación manual';
  const latest = await optional(['api', 'repos/JavierLoro/estudio-tfg/releases/latest']);
  const isLatest = !latest || compareVersions(tag, latest.tag_name) >= 0;
  await gh(['release', 'edit', tag, '--draft=false', '--prerelease=false', `--latest=${isLatest}`]);
  return `Release estable publicada: ${tag}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, tag, mode] = process.argv.slice(2);
  if (!root || (mode && mode !== '--publish')) throw new Error('Uso: desktop-deliver.mjs <salida-verificada> <tag> [--publish]');
  console.log(await deliverRelease(root, tag, process.env.GITHUB_SHA, mode === '--publish'));
}
