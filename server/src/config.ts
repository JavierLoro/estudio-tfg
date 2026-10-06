import os from 'node:os';
import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  repoRoot: string;
  notesDir: string;
  resourcesSubdir: string;
  memoriaDir: string;
  memoriaMain: string;
  buildDir: string;
  /** BUILD_DIR/../history */
  historyDir: string;
  workerUrl: string;
  authToken: string;
  webDist: string;
}

/** Repo root = parent of server/. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

export function expandPath(p: string, base: string): string {
  let v = p.trim();
  if (v === '~') v = os.homedir();
  else if (v.startsWith('~/')) v = path.join(os.homedir(), v.slice(2));
  return path.resolve(base, v);
}

function str(v: string | undefined, def: string): string {
  const t = (v ?? '').trim();
  return t === '' ? def : t;
}

/**
 * Personal content must never end up in this repo's git history: inside the repo,
 * NOTES_DIR / MEMORIA_DIR may only live under the git-ignored workspace/ folder.
 */
function assertOutsideRepo(name: string, dir: string, repoRoot: string): void {
  const rel = path.relative(repoRoot, dir);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (inside && !(rel === 'workspace' || rel.startsWith(`workspace${path.sep}`))) {
    throw new Error(`${name} (${dir}) está dentro del repositorio: usa una carpeta externa o workspace/ (ignorada por git)`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = REPO_ROOT): Config {
  const buildDir = expandPath(str(env.BUILD_DIR, './data/builds'), repoRoot);
  const resourcesSubdir = str(env.RESOURCES_SUBDIR, 'Recursos').replace(/^\/+|\/+$/g, '');
  if (resourcesSubdir.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error('RESOURCES_SUBDIR no válido');
  }
  const notesDir = expandPath(str(env.NOTES_DIR, './workspace/notes'), repoRoot);
  const memoriaDir = expandPath(str(env.MEMORIA_DIR, './workspace/memoria'), repoRoot);
  assertOutsideRepo('NOTES_DIR', notesDir, REPO_ROOT);
  assertOutsideRepo('MEMORIA_DIR', memoriaDir, REPO_ROOT);
  return {
    port: Number(str(env.PORT, '8787')),
    host: str(env.HOST, '127.0.0.1'),
    repoRoot,
    notesDir,
    resourcesSubdir,
    memoriaDir,
    memoriaMain: str(env.MEMORIA_MAIN, 'main.tex'),
    buildDir,
    historyDir: path.join(path.dirname(buildDir), 'history'),
    workerUrl: str(env.WORKER_URL, 'http://localhost:8090').replace(/\/+$/, ''),
    authToken: (env.AUTH_TOKEN ?? '').trim(),
    webDist: path.join(repoRoot, 'web', 'dist'),
  };
}
