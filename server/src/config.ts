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

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = REPO_ROOT): Config {
  const buildDir = expandPath(str(env.BUILD_DIR, './data/builds'), repoRoot);
  const resourcesSubdir = str(env.RESOURCES_SUBDIR, 'Recursos').replace(/^\/+|\/+$/g, '');
  if (resourcesSubdir.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error('RESOURCES_SUBDIR no válido');
  }
  return {
    port: Number(str(env.PORT, '8787')),
    host: str(env.HOST, '127.0.0.1'),
    repoRoot,
    notesDir: expandPath(str(env.NOTES_DIR, './test/fixtures/notes'), repoRoot),
    resourcesSubdir,
    memoriaDir: expandPath(str(env.MEMORIA_DIR, './test/fixtures/memoria'), repoRoot),
    memoriaMain: str(env.MEMORIA_MAIN, 'main.tex'),
    buildDir,
    historyDir: path.join(path.dirname(buildDir), 'history'),
    workerUrl: str(env.WORKER_URL, 'http://localhost:8090').replace(/\/+$/, ''),
    authToken: (env.AUTH_TOKEN ?? '').trim(),
    webDist: path.join(repoRoot, 'web', 'dist'),
  };
}
