// Lógica compartida por `npm run init` (scripts/init.mjs) y el server
// (POST /api/settings/init-memoria): crear la memoria desde la plantilla.
// La plantilla es templates/base/ más un perfil (templates/perfiles/<id>/)
// copiado encima.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');
export const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');
export const BASE_DIR = path.join(TEMPLATES_DIR, 'base');
export const PERFILES_DIR = path.join(TEMPLATES_DIR, 'perfiles');
export const MANIFIESTOS_DIR = path.join(TEMPLATES_DIR, 'manifiestos');
export const DEFAULT_PERFIL = 'esi-uclm';
/**
 * Versión de la plantilla actual (nombre de su manifiesto). Súbela cuando cambie la
 * versión de la clase (\ProvidesClass de estilo/memoria.cls).
 */
export const PLANTILLA_VERSION = 'v0.5';

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
  // La copia nativa de directorios de Node 24 falla con EACCES en Docker Desktop.
  fs.cpSync(BASE_DIR, dir, { recursive: true, force: false, errorOnExist: false, filter: () => true });
  fs.cpSync(src, dir, {
    recursive: true,
    force: true,
    filter: (from) => path.relative(src, from) !== 'perfil.json',
  });
}

export const GIT_IDENTITY = ['-c', 'user.name=Estudio TFG', '-c', 'user.email=estudio-tfg@localhost'];
export const NO_GIT_WARNING = 'La memoria se ha creado sin control de versiones: instala Git para tener historial y actualizaciones de plantilla';

export function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Crea `dir` (si hace falta), copia la plantilla con el perfil indicado y, si
 * no tiene `.git`, crea su propio repositorio con un commit inicial. Nunca
 * sobrescribe: si `dir` no está vacía lanza un error con `code = 'ENOTEMPTY'`;
 * si el perfil no existe, con `code = 'EPERFIL'` (antes de crear nada).
 * @returns {{ dir: string, git: boolean, perfil: string, warning?: string }} git = se creó el repositorio.
 */
export function createMemoriaFromTemplate(dir, { perfil = DEFAULT_PERFIL } = {}) {
  perfilDir(perfil);
  if (!isEmptyDir(dir)) {
    throw Object.assign(new Error(`La carpeta no está vacía: ${dir}`), { code: 'ENOTEMPTY' });
  }
  const available = hasGit(); // Comprobar antes de copiar para no fallar por Git ausente a mitad.
  fs.mkdirSync(dir, { recursive: true });
  copyTemplate(dir, { perfil });
  if (!available) return { dir, git: false, perfil, warning: NO_GIT_WARNING };
  if (fs.existsSync(path.join(dir, '.git'))) return { dir, git: false, perfil };
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  const msg = 'Memoria creada desde la plantilla de Estudio TFG';
  try {
    git('commit', '-qm', msg);
  } catch {
    // Sin identidad git configurada: usa una genérica solo para este commit.
    git(...GIT_IDENTITY, 'commit', '-qm', msg);
  }
  return { dir, git: true, perfil };
}

// ---- Manifiestos (v0.6): hash de cada archivo tal como lo crea la plantilla ----

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Archivos que `copyTemplate` crearía con ese perfil: Map ruta relativa → ruta absoluta
 * (base/ y encima el perfil, sin perfil.json), ordenado por ruta.
 */
export function templateFiles(perfil = DEFAULT_PERFIL) {
  const src = perfilDir(perfil);
  const out = new Map();
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.DS_Store') continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), r);
      else if (ent.isFile() && !(dir === src && ent.name === 'perfil.json')) out.set(r, path.join(dir, ent.name));
    }
  };
  walk(BASE_DIR, '');
  walk(src, '');
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** «estilo/memoria v3.0» a partir del \ProvidesClass de una clase (o null). */
export function claseDe(src) {
  const m = /\\ProvidesClass\{([^}]+)\}\[\s*\S+\s+(v[\d.]+)/.exec(src);
  return m ? `${m[1].trim()} ${m[2]}` : null;
}

/** Comandos (sin barra) de las líneas no comentadas de un datos.tex, en orden. */
export function comandosDatos(src) {
  const out = [];
  for (const m of src.matchAll(/^[ \t]*\\([A-Za-z]+)/gm)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * Manifiesto de la plantilla actual (todos los perfiles). Si un archivo es igual en todos
 * los perfiles que lo tienen y lo tienen todos, clave "<ruta>"; si no, "<perfil>:<ruta>".
 */
export function buildManifest() {
  const perfiles = listPerfiles().map((p) => p.id);
  const porPerfil = new Map(perfiles.map((id) => [id, templateFiles(id)]));
  const rutas = [...new Set([...porPerfil.values()].flatMap((m) => [...m.keys()]))].sort();
  const archivos = {};
  for (const rel of rutas) {
    const hashes = perfiles.map((id) => {
      const abs = porPerfil.get(id).get(rel);
      return abs ? sha256(fs.readFileSync(abs)) : null;
    });
    if (hashes.every((h) => h && h === hashes[0])) archivos[rel] = hashes[0];
    else perfiles.forEach((id, i) => hashes[i] && (archivos[`${id}:${rel}`] = hashes[i]));
  }
  const clase = claseDe(fs.readFileSync(path.join(BASE_DIR, 'estilo', 'memoria.cls'), 'utf8'));
  const cmds = [...new Set(perfiles.flatMap((id) => comandosDatos(fs.readFileSync(porPerfil.get(id).get('datos.tex'), 'utf8'))))];
  return { version: PLANTILLA_VERSION, clase, comandosDatos: cmds, archivos: Object.fromEntries(Object.entries(archivos).sort()) };
}

/** Hashes conocidos de una entrada del manifiesto (string o lista; el primero es el actual). */
export function hashesDe(v) {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/**
 * Une un manifiesto recién generado con el anterior de la misma versión: los hashes
 * antiguos se conservan detrás del actual (las memorias creadas con ellos siguen
 * reconociéndose como «sin tocar»).
 */
export function mergeManifest(fresh, old) {
  if (!old) return fresh;
  const archivos = {};
  for (const k of new Set([...Object.keys(fresh.archivos), ...Object.keys(old.archivos ?? {})])) {
    const all = [...new Set([...hashesDe(fresh.archivos[k]), ...hashesDe(old.archivos?.[k])])];
    archivos[k] = all.length === 1 ? all[0] : all;
  }
  return { ...fresh, archivos: Object.fromEntries(Object.entries(archivos).sort()) };
}

/** Lee templates/manifiestos/*.json. */
export function readManifiestos() {
  if (!fs.existsSync(MANIFIESTOS_DIR)) return [];
  return fs
    .readdirSync(MANIFIESTOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(MANIFIESTOS_DIR, f), 'utf8')));
}

/** Diferencias entre el manifiesto guardado de la versión actual y la plantilla (vacío = al día). */
export function manifestProblems() {
  const fresh = buildManifest();
  const file = path.join(MANIFIESTOS_DIR, `${PLANTILLA_VERSION}.json`);
  if (!fs.existsSync(file)) return [`Falta ${path.relative(REPO_ROOT, file)}`];
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  if (saved.clase !== fresh.clase) out.push(`clase: ${saved.clase} ≠ ${fresh.clase}`);
  if (JSON.stringify(saved.comandosDatos) !== JSON.stringify(fresh.comandosDatos)) out.push('comandosDatos distintos');
  for (const [k, h] of Object.entries(fresh.archivos)) {
    if (hashesDe(saved.archivos?.[k])[0] !== h) out.push(`${k}: hash distinto`);
  }
  return out;
}
