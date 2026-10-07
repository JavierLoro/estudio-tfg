import crypto from 'node:crypto';
import fss from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';
import {
  SETTING_KEYS,
  realpathLoose,
  repoGuardError,
  type Config,
  type SettingKey,
  type SettingValues,
} from './config.ts';
import { isAuthorized } from './auth.ts';
import { HttpError } from './errors.ts';
import type { EventBus } from './events.ts';
import { atomicWrite } from './fsutil.ts';
import { isInside } from './paths.ts';
import { DEFAULT_PERFIL, createMemoriaFromTemplate, isEmptyDir, listPerfiles } from '../../scripts/memoria-template.mjs';

export type Source = 'settings' | 'env' | 'default';

export interface Check {
  key: SettingKey | 'settings';
  level: 'ok' | 'warning' | 'error';
  message: string;
}

export interface SettingsView {
  pathSep: '/' | '\\';
  values: SettingValues;
  sources: Record<SettingKey, Source>;
  allowedRoots: string[];
  checks: Check[];
}

const LABEL: Record<SettingKey, string> = {
  notesDir: 'Carpeta de notas',
  resourcesSubdir: 'Subcarpeta de recursos',
  memoriaDir: 'Carpeta de la memoria',
  memoriaMain: 'Archivo principal',
};

/** 400 `{ error, field }`. */
export const fieldError = (field: string, message: string) => new HttpError(400, message, { field });

export const NOT_CONFIGURED = 'Configura las carpetas en Ajustes';

export function expandUserPath(v: string): string {
  const home = os.homedir();
  let p = v.trim();
  if (p === '~') p = home;
  else if (/^~[\\/]/.test(p)) p = path.join(home, p.slice(2));
  return p;
}

export function isDirSync(p: string): boolean {
  try {
    return fss.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFileSync(p: string): boolean {
  try {
    return fss.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function insideAllowed(cfg: Config, abs: string): boolean {
  const real = realpathLoose(abs);
  return cfg.allowedRoots.some((r) => isInside(r, real));
}

/** notesDir and memoriaDir exist (as folders). */
export function isConfigured(cfg: Config): boolean {
  return isDirSync(cfg.notesDir) && isDirSync(cfg.memoriaDir);
}

/** Short hash of notesDir|memoriaDir (web uses it to key drafts). */
export function instanceId(cfg: Config): string {
  return crypto.createHash('sha256').update(`${cfg.notesDir}|${cfg.memoriaDir}`).digest('hex').slice(0, 12);
}

/**
 * PUT /api/settings, POST /api/settings/reset, POST /api/settings/init-memoria and GET /api/fs/dirs:
 * AUTH_TOKEN configured and valid, or (no AUTH_TOKEN) a request from loopback.
 * Uses the socket's remote address, never X-Forwarded-For.
 */
export function canAdminister(req: FastifyRequest, cfg: Config): boolean {
  if (cfg.authToken) return isAuthorized(req, cfg.authToken);
  const addr = req.raw.socket?.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function requireAdmin(req: FastifyRequest, cfg: Config): void {
  if (!canAdminister(req, cfg)) {
    throw new HttpError(403, 'Solo se puede cambiar la configuración desde este equipo (o con AUTH_TOKEN)');
  }
}

function requireStringField(key: string, v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw fieldError(key, `${key} debe ser un texto no vacío`);
  if (v.includes('\0')) throw fieldError(key, `${key} no válido`);
  return v.trim();
}

/** Folder setting: absolute after expanding `~`, inside ALLOWED_ROOTS (realpath), outside the repo (except workspace/). */
function normalizeDir(cfg: Config, key: string, raw: unknown, mustExist: boolean): string {
  const label = (LABEL as Record<string, string>)[key] ?? key;
  const v = expandUserPath(requireStringField(key, raw));
  if (!path.isAbsolute(v)) throw fieldError(key, `${label}: la ruta debe ser absoluta (o empezar por ~)`);
  const abs = path.resolve(v);
  if (mustExist) {
    let st: fss.Stats;
    try {
      st = fss.statSync(abs);
    } catch {
      throw fieldError(key, `${label}: no existe ${abs}`);
    }
    if (!st.isDirectory()) throw fieldError(key, `${label}: no es una carpeta (${abs})`);
  }
  if (!insideAllowed(cfg, abs)) {
    throw fieldError(key, `${label}: ${abs} está fuera de las carpetas permitidas (${cfg.allowedRoots.join(', ')})`);
  }
  const repoErr = repoGuardError(label, abs);
  if (repoErr) throw fieldError(key, repoErr);
  return abs;
}

function normalizeRelative(key: string, raw: unknown): string {
  const v = requireStringField(key, raw);
  if (v.startsWith('/') || v.startsWith('~') || /^[a-zA-Z]:/.test(v) || v.includes('\\')) {
    throw fieldError(key, `${LABEL[key as SettingKey] ?? key}: debe ser una ruta relativa con "/"`);
  }
  const segs = v.split('/').filter((s) => s !== '');
  if (!segs.length || segs.some((s) => s === '..' || s === '.')) {
    throw fieldError(key, `${LABEL[key as SettingKey] ?? key}: ruta no permitida`);
  }
  return segs.join('/');
}

/** Validate and normalise one setting. `mustExist` = strict (PUT); false = loading settings.json. */
export function normalizeSetting(cfg: Config, key: SettingKey, raw: unknown, mustExist: boolean): string {
  switch (key) {
    case 'notesDir':
    case 'memoriaDir':
      return normalizeDir(cfg, key, raw, mustExist);
    case 'resourcesSubdir':
      return normalizeRelative(key, raw);
    case 'memoriaMain': {
      const rel = normalizeRelative(key, raw);
      if (!/\.tex$/i.test(rel)) throw fieldError(key, 'Archivo principal: debe terminar en .tex');
      if (rel.split('/').some((s) => s.startsWith('-'))) throw fieldError(key, 'Archivo principal: nombre no válido');
      return rel;
    }
  }
}

function hasObsidianUp(dir: string): boolean {
  let d = path.resolve(dir);
  for (;;) {
    if (isDirSync(path.join(d, '.obsidian'))) return true;
    const parent = path.dirname(d);
    if (parent === d) return false;
    d = parent;
  }
}

export interface SettingsHooks {
  /** Called after values change (restart watcher, invalidate caches…). */
  onApply?: () => Promise<void> | void;
}

/**
 * Settings: settings.json > .env > defaults, applied in place on the shared
 * Config object (every route reads ctx.cfg live). Writes are serialised.
 */
export class Settings {
  private readonly base: SettingValues;
  private stored: Partial<SettingValues> = {};
  private loadChecks: Check[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private cfg: Config,
    private bus: EventBus,
    private hooks: SettingsHooks = {},
  ) {
    this.base = this.pick(cfg);
  }

  private pick(c: SettingValues): SettingValues {
    return Object.fromEntries(SETTING_KEYS.map((k) => [k, c[k]])) as SettingValues;
  }

  /** Read settings.json at startup. Invalid values fall back to .env/default and are reported as error checks. */
  load(): void {
    this.loadChecks = [];
    this.stored = {};
    let raw: unknown = {};
    try {
      raw = JSON.parse(fss.readFileSync(this.cfg.settingsFile, 'utf8'));
    } catch (e: any) {
      if (e?.code !== 'ENOENT') {
        this.loadChecks.push({ key: 'settings', level: 'error', message: `No se pudo leer ${this.cfg.settingsFile}: ${e?.message ?? e}` });
      }
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const key of SETTING_KEYS) {
        const v = (raw as Record<string, unknown>)[key];
        if (v === undefined) continue;
        try {
          this.stored[key] = normalizeSetting(this.cfg, key, v, false);
        } catch (e: any) {
          this.loadChecks.push({ key, level: 'error', message: `Valor de ajustes ignorado (se usa .env/defecto): ${e?.message ?? e}` });
        }
      }
    }
    Object.assign(this.cfg, this.effective());
  }

  private effective(): SettingValues {
    return { ...this.base, ...this.stored };
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async persist(next: Partial<SettingValues>): Promise<void> {
    await fs.mkdir(path.dirname(this.cfg.settingsFile), { recursive: true });
    await atomicWrite(this.cfg.settingsFile, JSON.stringify(next, null, 2) + '\n');
    this.stored = next;
  }

  private async apply(): Promise<SettingsView> {
    Object.assign(this.cfg, this.effective());
    // Values were validated: drop stale startup errors for keys now set explicitly.
    this.loadChecks = this.loadChecks.filter((c) => c.key === 'settings' || !(c.key in this.stored));
    try {
      await this.hooks.onApply?.();
    } catch {
      /* the watcher must never break a settings change */
    }
    const view = await this.view();
    this.bus.emit('settings', view);
    return view;
  }

  /** Create resourcesSubdir inside notesDir (if notesDir exists), never escaping it. */
  private async ensureResources(notesDir: string, sub: string): Promise<void> {
    if (!isDirSync(notesDir)) return;
    const base = await fs.realpath(notesDir);
    const target = path.join(base, ...sub.split('/'));
    const real = realpathLoose(target);
    if (!isInside(base, real)) throw fieldError('resourcesSubdir', 'Subcarpeta de recursos: sale de la carpeta de notas');
    await fs.mkdir(real, { recursive: true });
    if (!isInside(base, await fs.realpath(real))) throw fieldError('resourcesSubdir', 'Subcarpeta de recursos: sale de la carpeta de notas');
  }

  update(body: unknown): Promise<SettingsView> {
    return this.serial(async () => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Cuerpo no válido');
      const b = body as Record<string, unknown>;
      const changes: Partial<SettingValues> = {};
      for (const key of SETTING_KEYS) {
        if (b[key] === undefined) continue;
        changes[key] = normalizeSetting(this.cfg, key, b[key], true);
      }
      if (!Object.keys(changes).length) return this.view();
      const eff = { ...this.effective(), ...changes };
      if (changes.resourcesSubdir !== undefined || changes.notesDir !== undefined) {
        await this.ensureResources(eff.notesDir, eff.resourcesSubdir);
      }
      await this.persist({ ...this.stored, ...changes });
      return this.apply();
    });
  }

  reset(body: unknown): Promise<SettingsView> {
    return this.serial(async () => {
      const keys = (body as { keys?: unknown } | null)?.keys;
      if (!Array.isArray(keys) || keys.some((k) => !(SETTING_KEYS as readonly unknown[]).includes(k))) {
        throw fieldError('keys', `keys debe ser una lista con: ${SETTING_KEYS.join(', ')}`);
      }
      const next = { ...this.stored };
      for (const k of keys as SettingKey[]) delete next[k];
      await this.persist(next);
      this.loadChecks = this.loadChecks.filter((c) => !(keys as string[]).includes(c.key));
      return this.apply();
    });
  }

  /** Create a memoria from templates/base + templates/perfiles/<perfil> in `dir` (missing or empty) and select it. */
  initMemoria(body: unknown): Promise<SettingsView & { warning?: string }> {
    return this.serial(async () => {
      const { dir: raw, perfil: rawPerfil } = (body as { dir?: unknown; perfil?: unknown } | null) ?? {};
      const perfil = rawPerfil === undefined || rawPerfil === null || rawPerfil === '' ? DEFAULT_PERFIL : rawPerfil;
      if (typeof perfil !== 'string' || !listPerfiles().some((p) => p.id === perfil)) {
        throw fieldError('perfil', `Perfil de plantilla desconocido: ${String(perfil)}`);
      }
      const dir = normalizeDir(this.cfg, 'dir', raw, false);
      if (fss.existsSync(dir) && !isDirSync(dir)) throw fieldError('dir', `No es una carpeta: ${dir}`);
      if (!isEmptyDir(dir)) throw new HttpError(409, `La carpeta no está vacía: ${dir}`, { field: 'dir' });
      let warning: string | undefined;
      try {
        ({ warning } = createMemoriaFromTemplate(dir, { perfil }));
      } catch (e: any) {
        if (e?.code === 'ENOTEMPTY') throw new HttpError(409, `La carpeta no está vacía: ${dir}`, { field: 'dir' });
        throw new HttpError(500, `No se pudo crear la memoria: ${e?.message ?? e}`);
      }
      // Re-validate after creation (realpath now resolvable).
      const memoriaDir = normalizeDir(this.cfg, 'dir', dir, true);
      await this.persist({ ...this.stored, memoriaDir });
      const view = await this.apply();
      return warning ? { ...view, warning } : view;
    });
  }

  sources(): Record<SettingKey, Source> {
    return Object.fromEntries(
      SETTING_KEYS.map((k) => [k, k in this.stored ? 'settings' : this.cfg.envSources[k]]),
    ) as Record<SettingKey, Source>;
  }

  checks(): Check[] {
    const c = this.cfg;
    const out: Check[] = [...this.loadChecks];
    const sources = this.sources();
    const notesOk = isDirSync(c.notesDir);
    const memOk = isDirSync(c.memoriaDir);

    if (notesOk) {
      out.push({ key: 'notesDir', level: 'ok', message: `Carpeta de notas: ${c.notesDir}` });
      if (!hasObsidianUp(c.notesDir)) {
        out.push({ key: 'notesDir', level: 'warning', message: 'No se encuentra un vault de Obsidian (.obsidian) en la carpeta ni en sus padres' });
      }
    } else {
      out.push({ key: 'notesDir', level: 'error', message: `La carpeta de notas no existe: ${c.notesDir}` });
    }

    if (notesOk) {
      const res = path.join(c.notesDir, ...c.resourcesSubdir.split('/'));
      out.push(
        isDirSync(res)
          ? { key: 'resourcesSubdir', level: 'ok', message: `Recursos en ${res}` }
          : { key: 'resourcesSubdir', level: 'warning', message: `La subcarpeta de recursos no existe (se creará al capturar): ${res}` },
      );
    }

    if (memOk) {
      out.push({ key: 'memoriaDir', level: 'ok', message: `Carpeta de la memoria: ${c.memoriaDir}` });
      const main = path.join(c.memoriaDir, ...c.memoriaMain.split('/'));
      out.push(
        isFileSync(main)
          ? { key: 'memoriaMain', level: 'ok', message: `Archivo principal: ${c.memoriaMain}` }
          : { key: 'memoriaMain', level: 'error', message: `No se encuentra ${c.memoriaMain} en la carpeta de la memoria` },
      );
    } else {
      out.push({ key: 'memoriaDir', level: 'error', message: `La carpeta de la memoria no existe: ${c.memoriaDir}` });
    }

    const rn = realpathLoose(c.notesDir);
    const rm = realpathLoose(c.memoriaDir);
    if (isInside(rn, rm)) {
      out.push({ key: 'memoriaDir', level: 'warning', message: 'La memoria está dentro de la carpeta de notas' });
    } else if (isInside(rm, rn)) {
      out.push({ key: 'notesDir', level: 'warning', message: 'La carpeta de notas está dentro de la memoria' });
    }

    for (const key of ['notesDir', 'memoriaDir'] as const) {
      if (sources[key] !== 'settings' && !insideAllowed(c, c[key])) {
        out.push({ key, level: 'warning', message: `${LABEL[key]} (de ${sources[key] === 'env' ? '.env' : 'defecto'}) está fuera de ALLOWED_ROOTS` });
      }
    }
    return out;
  }

  async view(): Promise<SettingsView> {
    return {
      pathSep: path.sep as '/' | '\\',
      values: this.pick(this.cfg),
      sources: this.sources(),
      allowedRoots: [...this.cfg.allowedRoots],
      checks: this.checks(),
    };
  }
}
