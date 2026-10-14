import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function parts(tag) {
  const match = stable.exec(tag ?? '');
  if (!match) throw new Error(`Versión estable no válida: ${tag}`);
  return match.slice(1).map(BigInt);
}

export function compareVersions(left, right) {
  const a = parts(left), b = parts(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export function nextRelease(baseVersion, tags, commit) {
  const base = `v${baseVersion}`; parts(base);
  const ordered = tags.filter(tag => stable.test(tag.name)).sort((a, b) => compareVersions(b.name, a.name));
  // Un reintento conserva el tag reservado para ese mismo commit.
  const existing = ordered.find(tag => tag.commit === commit);
  if (existing) return existing.name;
  const latest = ordered[0]?.name;
  if (!latest || compareVersions(base, latest) > 0) return base;
  const [major, minor, patch] = parts(latest);
  return `v${major}.${minor}.${patch + 1n}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const commit = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !process.env.GITHUB_OUTPUT) throw new Error('Falta el commit o la salida de GitHub Actions');
  const { version } = JSON.parse(await fs.readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  const names = (await exec('git', ['tag', '--list', 'v*'])).stdout.trim().split('\n').filter(name => stable.test(name));
  const tags = [];
  for (const name of names) tags.push({ name, commit: (await exec('git', ['rev-list', '-n', '1', name])).stdout.trim() });
  const tag = nextRelease(version, tags, commit);
  if (!tags.some(item => item.name === tag)) await exec('gh', ['api', 'repos/JavierLoro/estudio-tfg/git/refs', '--method', 'POST',
    '-f', `ref=refs/tags/${tag}`, '-f', `sha=${commit}`]);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
  console.log(`Versión reservada: ${tag} (${commit})`);
}
