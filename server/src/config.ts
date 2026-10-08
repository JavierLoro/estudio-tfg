import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type WatchPolling = 'auto' | 'on' | 'off';

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
  watchPolling: WatchPolling;
  authToken: string;
  webDist: string;
  /** ALLOWED_ROOTS (realpath when they exist). No configurable/browsable folder may leave them. */
  allowedRoots: string[];
  /** BUILD_DIR/../settings.json */
  settingsFile: string;
  /** Where each UI-editable value came from before settings.json is applied. */
  envSources: Record<SettingKey, 'env' | 'default'>;
}

/** Keys editable from the UI (settings.json > .env > default). */
export const SETTING_KEYS = ['notesDir', 'resourcesSubdir', 'memoriaDir', 'memoriaMain'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingValues = Record<SettingKey, string>;

/** Repo root = parent of server/. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

export function expandPath(p: string, base: string, paths = path): string {
  let v = p.trim();
  if (v === '~') v = os.homedir();
  else if (/^~[\\/]/.test(v)) v = paths.join(os.homedir(), v.slice(2));
  return paths.resolve(base, v);
}

const src = (v: string | undefined): 'env' | 'default' => ((v ?? '').trim() ? 'env' : 'default');

function str(v: string | undefined, def: string): string {
  const t = (v ?? '').trim();
  return t === '' ? def : t;
}

/** realpath of the deepest existing ancestor + the missing tail (never throws). */
export function realpathLoose(p: string, paths = path): string {
  const missing: string[] = [];
  let probe = paths.resolve(p);
  for (;;) {
    try {
      const real = fs.realpathSync.native(probe);
      return missing.length ? paths.join(real, ...missing.reverse()) : real;
    } catch {
      const parent = paths.dirname(probe);
      if (parent === probe) return paths.resolve(p);
      missing.push(paths.basename(probe));
      probe = parent;
    }
  }
}

function insideRepoNotWorkspace(dir: string, repoRoot: string, paths = path): boolean {
  if (paths.sep === '\\') {
    dir = paths.toNamespacedPath(dir);
    repoRoot = paths.toNamespacedPath(repoRoot);
  }
  const rel = paths.relative(repoRoot, dir);
  const inside = rel === '' || (rel !== '..' && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel));
  const key = paths.sep === '\\' ? rel.toLowerCase() : rel;
  return inside && !(key === 'workspace' || key.startsWith(`workspace${paths.sep}`));
}

/**
 * Personal content must never end up in this repo's git history: inside the repo,
 * NOTES_DIR / MEMORIA_DIR may only live under the git-ignored workspace/ folder.
 * Checked on the lexical path and on its realpath. Returns an error message or null.
 */
export function repoGuardError(name: string, dir: string, repoRoot = REPO_ROOT, paths = path): string | null {
  const realRepo = realpathLoose(repoRoot, paths);
  if (insideRepoNotWorkspace(dir, repoRoot, paths) || insideRepoNotWorkspace(realpathLoose(dir, paths), realRepo, paths)) {
    return `${name} (${dir}) está dentro del repositorio: usa una carpeta externa o workspace/ (ignorada por git)`;
  }
  return null;
}

function assertOutsideRepo(name: string, dir: string): void {
  const err = repoGuardError(name, dir);
  if (err) throw new Error(err);
}

/** ALLOWED_ROOTS: `;` en Windows, `:` en POSIX; por defecto, el home del usuario. */
export function parseAllowedRoots(v: string | undefined, base: string, paths = path): string[] {
  const list = (v ?? '').split(paths.delimiter).map((s) => s.trim()).filter(Boolean);
  const roots = (list.length ? list : [os.homedir()]).map((r) => realpathLoose(expandPath(r, base, paths), paths));
  return [...new Set(roots)];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = REPO_ROOT): Config {
  const watchPolling = str(env.WATCH_POLLING, 'auto');
  if (!['auto', 'on', 'off'].includes(watchPolling)) throw new Error('WATCH_POLLING debe ser auto, on u off');
  const buildDir = expandPath(str(env.BUILD_DIR, './data/builds'), repoRoot);
  const resourcesSubdir = str(env.RESOURCES_SUBDIR, 'Recursos').replace(/^\/+|\/+$/g, '');
  if (resourcesSubdir.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error('RESOURCES_SUBDIR no válido');
  }
  const notesDir = expandPath(str(env.NOTES_DIR, './workspace/notes'), repoRoot);
  const memoriaDir = expandPath(str(env.MEMORIA_DIR, './workspace/memoria'), repoRoot);
  assertOutsideRepo('NOTES_DIR', notesDir);
  assertOutsideRepo('MEMORIA_DIR', memoriaDir);
  return {
    port: Number(str(env.PORT, '8787')),
    host: str(env.HOST, '127.0.0.1'),
    repoRoot,
    notesDir,
    resourcesSubdir,
    memoriaDir,
    memoriaMain: str(env.MEMORIA_MAIN, 'tfg.tex'),
    buildDir,
    historyDir: path.join(path.dirname(buildDir), 'history'),
    workerUrl: str(env.WORKER_URL, 'http://localhost:8090').replace(/\/+$/, ''),
    watchPolling: watchPolling as WatchPolling,
    authToken: (env.AUTH_TOKEN ?? '').trim(),
    webDist: path.join(repoRoot, 'web', 'dist'),
    allowedRoots: parseAllowedRoots(env.ALLOWED_ROOTS, repoRoot),
    settingsFile: path.join(path.dirname(buildDir), 'settings.json'),
    envSources: {
      notesDir: src(env.NOTES_DIR),
      resourcesSubdir: src(env.RESOURCES_SUBDIR),
      memoriaDir: src(env.MEMORIA_DIR),
      memoriaMain: src(env.MEMORIA_MAIN),
    },
  };
}
