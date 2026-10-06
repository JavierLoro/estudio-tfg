// Lógica compartida por `npm run init` (scripts/init.mjs) y el server
// (POST /api/settings/init-memoria): crear la memoria desde la plantilla.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');
export const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates', 'esi-tfg');

/** Vacía = no existe o solo contiene dotfiles (p. ej. `.git`, `.DS_Store`). */
export function isEmptyDir(dir) {
  if (!fs.existsSync(dir)) return true;
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length === 0;
}

const IDENTITY = ['-c', 'user.name=Estudio TFG', '-c', 'user.email=estudio-tfg@localhost'];

/**
 * Crea `dir` (si hace falta), copia la plantilla y, si no tiene `.git`, crea su
 * propio repositorio con un commit inicial. Nunca sobrescribe: si `dir` no está
 * vacía lanza un error con `code = 'ENOTEMPTY'`.
 * @returns {{ dir: string, git: boolean }} git = se creó el repositorio.
 */
export function createMemoriaFromTemplate(dir, { template = TEMPLATE_DIR } = {}) {
  if (!isEmptyDir(dir)) {
    throw Object.assign(new Error(`La carpeta no está vacía: ${dir}`), { code: 'ENOTEMPTY' });
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(template, dir, { recursive: true, force: false });
  if (fs.existsSync(path.join(dir, '.git'))) return { dir, git: false };
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
  return { dir, git: true };
}
