import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type WatchPolling = 'auto' | 'on' | 'off';
export type CompileEngine = 'auto' | 'docker' | 'local';

export interface Config {
  port: number;
  host: string;
  repoRoot: string;
  checkoutRoot: string | null;
  dataDir: string;
  templatesDir: string;
  notesDir: string;
  resourcesSubdir: string;
  memoriaDir: string;
  memoriaMain: string;
  buildDir: string;
  /** DATA_DIR/history (por defecto junto a BUILD_DIR). */
  historyDir: string;
  workerUrl: string;
  compileEngine: CompileEngine;
  watchPolling: WatchPolling;
  authToken: string;
  webDist: string;
  /** ALLOWED_ROOTS (realpath when they exist). No configurable/browsable folder may leave them. */
  allowedRoots: string[];
  /** DATA_DIR/settings.json. */
  settingsFile: string;
  /** Where each UI-editable value came from before settings.json is applied. */
  envSources: Record<SettingKey, 'env' | 'default'>;
}

/** Keys editable from the UI (settings.json > .env > default). */
export const SETTING_KEYS = ['notesDir', 'resourcesSubdir', 'memoriaDir', 'memoriaMain', 'compileEngine'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingValues = Record<SettingKey, string>;

/** Repo root = parent of server/. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

export function checkoutRoot(root = REPO_ROOT): string | null {
  return fs.existsSync(path.join(root, '.git')) ? root : null;
}

/** Datos de la app por sistema; no crea carpetas ni cambia el entorno. */
export function userDataDir(platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  if (platform === 'win32') return path.win32.join(env.APPDATA && path.win32.isAbsolute(env.APPDATA) ? env.APPDATA : path.win32.join(home, 'AppData', 'Roaming'), 'Estudio TFG');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'Estudio TFG');
  return path.posix.join(env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.posix.join(home, '.local', 'share'), 'estudio-tfg');
}

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
export function repoGuardError(name: string, dir: string, repoRoot: string | null = checkoutRoot(), paths = path): string | null {
  if (repoRoot === null) return null;
  const realRepo = realpathLoose(repoRoot, paths);
  if (insideRepoNotWorkspace(dir, repoRoot, paths) || insideRepoNotWorkspace(realpathLoose(dir, paths), realRepo, paths)) {
    return `${name} (${dir}) está dentro del repositorio: usa una carpeta externa o workspace/ (ignorada por git)`;
  }
  return null;
}

function assertOutsideRepo(name: string, dir: string, root: string | null): void {
  const err = repoGuardError(name, dir, root);
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
  const compileEngine = str(env.COMPILE_ENGINE, 'docker');
  if (!['auto', 'docker', 'local'].includes(compileEngine)) throw new Error('COMPILE_ENGINE debe ser auto, docker o local');
  const checkout = checkoutRoot();
  const legacyData = env.BUILD_DIR?.trim() ? path.dirname(expandPath(env.BUILD_DIR, repoRoot)) : './data';
  const dataDir = expandPath(str(env.DATA_DIR, legacyData), repoRoot);
  const buildDir = expandPath(str(env.BUILD_DIR, path.join(dataDir, 'builds')), repoRoot);
  const resourcesSubdir = str(env.RESOURCES_SUBDIR, 'Recursos').replace(/^\/+|\/+$/g, '');
  if (resourcesSubdir.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error('RESOURCES_SUBDIR no válido');
  }
  const notesDir = expandPath(str(env.NOTES_DIR, './workspace/notes'), repoRoot);
  const memoriaDir = expandPath(str(env.MEMORIA_DIR, './workspace/memoria'), repoRoot);
  assertOutsideRepo('NOTES_DIR', notesDir, checkout);
  assertOutsideRepo('MEMORIA_DIR', memoriaDir, checkout);
  return {
    port: Number(str(env.PORT, '8787')),
    host: str(env.HOST, '127.0.0.1'),
    repoRoot,
    checkoutRoot: checkout,
    dataDir,
    templatesDir: expandPath(str(env.TEMPLATES_DIR, path.join(REPO_ROOT, 'templates')), repoRoot),
    notesDir,
    resourcesSubdir,
    memoriaDir,
    memoriaMain: str(env.MEMORIA_MAIN, 'tfg.tex'),
    buildDir,
    historyDir: path.join(dataDir, 'history'),
    workerUrl: str(env.WORKER_URL, 'http://localhost:8090').replace(/\/+$/, ''),
    compileEngine: compileEngine as CompileEngine,
    watchPolling: watchPolling as WatchPolling,
    authToken: (env.AUTH_TOKEN ?? '').trim(),
    webDist: expandPath(str(env.WEB_DIST, './web/dist'), repoRoot),
    allowedRoots: parseAllowedRoots(env.ALLOWED_ROOTS, repoRoot),
    settingsFile: path.join(dataDir, 'settings.json'),
    envSources: {
      notesDir: src(env.NOTES_DIR),
      resourcesSubdir: src(env.RESOURCES_SUBDIR),
      memoriaDir: src(env.MEMORIA_DIR),
      memoriaMain: src(env.MEMORIA_MAIN),
      compileEngine: src(env.COMPILE_ENGINE),
    },
  };
}
