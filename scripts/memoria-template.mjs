// Lógica compartida por `npm run init` (scripts/init.mjs) y el server
// (POST /api/settings/init-memoria): crear la memoria desde la plantilla.
// La plantilla es templates/base/ más un perfil (templates/perfiles/<id>/)
// copiado encima.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');
export const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');
export const BASE_DIR = path.join(TEMPLATES_DIR, 'base');
export const PERFILES_DIR = path.join(TEMPLATES_DIR, 'perfiles');
export const DEFAULT_PERFIL = 'esi-uclm';

const PERFIL_ID = /^[a-z0-9][a-z0-9-]*$/;

/** Vacía = no existe o solo contiene dotfiles (p. ej. `.git`, `.DS_Store`). */
export function isEmptyDir(dir) {
  if (!fs.existsSync(dir)) return true;
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length === 0;
}

/**
 * Perfiles disponibles (templates/perfiles/<id>/perfil.json), ordenados con el
 * de por defecto primero.
 * @returns {{ id: string, nombre: string, descripcion: string }[]}
 */
export function listPerfiles() {
  if (!fs.existsSync(PERFILES_DIR)) return [];
  const out = [];
  for (const ent of fs.readdirSync(PERFILES_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory() || !PERFIL_ID.test(ent.name)) continue;
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(PERFILES_DIR, ent.name, 'perfil.json'), 'utf8'));
    } catch {
      continue; // sin perfil.json válido no es un perfil
    }
    out.push({
      id: ent.name,
      nombre: typeof meta.nombre === 'string' ? meta.nombre : ent.name,
      descripcion: typeof meta.descripcion === 'string' ? meta.descripcion : '',
    });
  }
  return out.sort((a, b) => (a.id === DEFAULT_PERFIL ? -1 : b.id === DEFAULT_PERFIL ? 1 : a.id.localeCompare(b.id)));
}

/** Error con `code = 'EPERFIL'` si `perfil` no es un perfil existente. */
export function perfilDir(perfil) {
  if (typeof perfil !== 'string' || !PERFIL_ID.test(perfil) || !listPerfiles().some((p) => p.id === perfil)) {
    throw Object.assign(new Error(`Perfil de plantilla desconocido: ${perfil}`), { code: 'EPERFIL' });
  }
  return path.join(PERFILES_DIR, perfil);
}

/**
 * Copia base/ y encima el perfil (sin su perfil.json) en `dir`, que debe
 * existir. Sin git ni comprobaciones de carpeta vacía (para tests y herramientas).
 */
export function copyTemplate(dir, { perfil = DEFAULT_PERFIL } = {}) {
  const src = perfilDir(perfil);
  fs.cpSync(BASE_DIR, dir, { recursive: true, force: false, errorOnExist: false });
  fs.cpSync(src, dir, {
    recursive: true,
    force: true,
    filter: (from) => path.relative(src, from) !== 'perfil.json',
  });
}

const IDENTITY = ['-c', 'user.name=Estudio TFG', '-c', 'user.email=estudio-tfg@localhost'];

/**
 * Crea `dir` (si hace falta), copia la plantilla con el perfil indicado y, si
 * no tiene `.git`, crea su propio repositorio con un commit inicial. Nunca
 * sobrescribe: si `dir` no está vacía lanza un error con `code = 'ENOTEMPTY'`;
 * si el perfil no existe, con `code = 'EPERFIL'` (antes de crear nada).
 * @returns {{ dir: string, git: boolean, perfil: string }} git = se creó el repositorio.
 */
export function createMemoriaFromTemplate(dir, { perfil = DEFAULT_PERFIL } = {}) {
  perfilDir(perfil);
  if (!isEmptyDir(dir)) {
    throw Object.assign(new Error(`La carpeta no está vacía: ${dir}`), { code: 'ENOTEMPTY' });
  }
  fs.mkdirSync(dir, { recursive: true });
  copyTemplate(dir, { perfil });
  if (fs.existsSync(path.join(dir, '.git'))) return { dir, git: false, perfil };
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  const msg = 'Memoria creada desde la plantilla de Estudio TFG';
  try {
    git('commit', '-qm', msg);
  } catch {
    // Sin identidad git configurada: usa una genérica solo para este commit.
    git(...IDENTITY, 'commit', '-qm', msg);
  }
  return { dir, git: true, perfil };
}
