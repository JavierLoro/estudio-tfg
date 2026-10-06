// Actualizar plantilla (v0.6): lleva una memoria existente a la plantilla actual sin tocar lo
// que ha escrito el usuario. Vista previa (plan), aplicación con copia en el historial y
// commit solo de los archivos afectados, y deshacer la última actualización.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import type { Ctx } from './context.ts';
import { HttpError, badRequest } from './errors.ts';
import { ADDED_MARK, DATOS_REL, INSTITUCION_REL, applyChanges, fieldsOf, findCommand, parseDatos } from './datos.ts';
import { atomicWrite, backup, createExclusive, rev, type KeyedLock } from './fsutil.ts';
import { resolveSafe } from './paths.ts';
import {
  DEFAULT_PERFIL,
  GIT_IDENTITY,
  PLANTILLA_VERSION,
  claseDe,
  hashesDe,
  listPerfiles,
  readManifiestos,
  sha256,
  templateFiles,
  type Manifiesto,
} from '../../scripts/memoria-template.mjs';

export type Accion = 'crear' | 'sustituir' | 'editar' | 'retirar';
export type EstadoPlantilla = 'actual' | 'desactualizada' | 'desconocida';

export interface Cambio {
  archivo: string;
  accion: Accion;
  motivo: string;
  /** Revisión del archivo en el momento de la vista previa (null = no existe). */
  rev: string | null;
}

export interface Revisar {
  archivo: string;
  motivo: string;
}

export interface PlanPlantilla {
  estado: EstadoPlantilla;
  versionMemoria: string | null;
  versionPlantilla: string;
  perfil: string;
  cambios: Cambio[];
  revisar: Revisar[];
}

interface Plan extends PlanPlantilla {
  /** Contenido nuevo de cada archivo afectado (null = se retira). */
  next: Map<string, Buffer | null>;
}

export interface ResultadoActualizar {
  aplicados: Cambio[];
  revisar: Revisar[];
  commit: string | null;
  deshacer: string;
}

// ---- Lo que la plantilla v0.3 tenía en tfg.tex (para la edición puntual) ----

const OLD_DOCCLASS_RE = /^[ \t]*\\documentclass(\[[^\]]*\])?\{estilo\/esi-tfg\}/;
const OLD_DOCCLASS_LINE = '\\documentclass{estilo/esi-tfg}           % formato oficial de la ESI (no tocar)';
const OLD_INDICES = [
  '\\tableofcontents                         % índice general',
  '\\listoffigures                           % índice de figuras',
  '\\listoftables                            % índice de tablas',
  '\\lstlistoflistings                       % índice de listados de código',
];

/** Contenido del usuario: solo se sustituye si está sin tocar. */
const isContenido = (rel: string) => /^(0-inicio|1-capitulos|2-anexos)\//.test(rel) || rel === 'bibliografia.bib' || rel === 'LEEME.md';

/** Qué trae la versión nueva de cada archivo de contenido (desde la plantilla v0.3). */
const NOVEDADES_V03: Record<string, string> = {
  '0-inicio/abstract.tex': 'las keywords salen de datos.tex (\\mostrarPalabrasClave)',
  '0-inicio/resumen.tex': 'separación en sílabas en español aunque el documento esté en inglés',
  '0-inicio/acronimos.tex': 'ejemplos y guía actualizados',
  'bibliografia.bib': 'ejemplos para biber (@online con url y urldate)',
  'LEEME.md': 'guía actualizada (institucion.tex, \\modo, \\licencia…)',
};

/** Motivo de «revisar a mano» para un archivo de contenido con cambios del usuario. */
function motivoRevisar(rel: string, src: string): string {
  if (rel === '0-inicio/abstract.tex' && /keywords/i.test(src) && !src.includes('\\mostrarPalabrasClave')) {
    return 'abstract.tex escribe las keywords a mano: usa \\mostrarPalabrasClave (las toma de \\keywords en datos.tex)';
  }
  if (rel === '0-inicio/resumen.tex' && !src.includes('otherlanguage')) {
    return 'la plantilla nueva envuelve el resumen en \\begin{otherlanguage}{spanish} … \\end{otherlanguage}';
  }
  if (rel === 'bibliografia.bib' && /howpublished/i.test(src)) {
    return 'ahora se procesa con biber: para páginas web usa @online con url y urldate en vez de howpublished y note';
  }
  return 'tiene cambios tuyos y la plantilla nueva también lo cambia: compáralo con la versión nueva';
}

// ---- Lectura de la memoria ----

async function readMem(cfg: Config, rel: string): Promise<Buffer | null> {
  const r = await resolveSafe(cfg, 'memoria', rel);
  if (!r.exists) return null;
  try {
    return await fs.readFile(r.abs);
  } catch (e: any) {
    if (e?.code === 'ENOENT' || e?.code === 'EISDIR') return null;
    throw e;
  }
}

/** Hashes «sin tocar» de un archivo para un perfil (clave "<perfil>:<ruta>" o "<ruta>"). */
function known(m: Manifiesto, perfil: string, rel: string): string[] {
  return [...hashesDe(m.archivos[`${perfil}:${rel}`]), ...hashesDe(m.archivos[rel])];
}

/** Todos los hashes que la plantilla tuvo para esa ruta (cualquier perfil). */
function knownAny(m: Manifiesto, rel: string): string[] {
  return Object.entries(m.archivos)
    .filter(([k]) => k === rel || k.endsWith(`:${rel}`))
    .flatMap(([, v]) => hashesDe(v));
}

function perfilIds(): string[] {
  return listPerfiles().map((p) => p.id);
}

/** `esi-uclm` si usa el logo de la ESI; si no, `generico`. */
async function deducePerfil(cfg: Config, inst: Buffer | null): Promise<string> {
  const usaEsi = inst
    ? parseDatos(inst.toString('utf8'), 'institucion').logo === 'esi_logo.pdf'
    : (await readMem(cfg, 'estilo/esi_logo.pdf')) !== null;
  const ids = perfilIds();
  const p = usaEsi ? 'esi-uclm' : 'generico';
  return ids.includes(p) ? p : ids.includes(DEFAULT_PERFIL) ? DEFAULT_PERFIL : ids[0];
}

/** Línea del template que empieza por `re` (o el valor por defecto). */
const tplLine = (lines: string[], re: RegExp, def: string) => lines.find((l) => re.test(l)) ?? def;

/** Añade a las líneas recién añadidas bajo la marca el comentario que llevan en la plantilla. */
function withTemplateComments(src: string, tplSrc: string, cmds: string[]): string {
  const mark = src.indexOf(ADDED_MARK);
  if (mark < 0) return src;
  const head = src.slice(0, mark);
  const lines = src.slice(mark).split('\n');
  for (const cmd of cmds) {
    const t = new RegExp(`^\\\\${cmd}(?![A-Za-z]).*?(\\s+%.*)$`, 'm').exec(tplSrc);
    if (!t) continue;
    const col = t[0].length - t[1].length + (t[1].length - t[1].trimStart().length);
    const i = lines.findIndex((l) => new RegExp(`^\\\\${cmd}(\\{[^%\\n]*\\})+$`).test(l));
    if (i >= 0) lines[i] = lines[i].padEnd(Math.max(col, lines[i].length + 2)) + t[1].trimStart();
  }
  return head + lines.join('\n');
}

/**
 * Calcula qué haría la actualización (no escribe nada). `perfilPedido` solo se usa si la
 * memoria no tiene institucion.tex; si no, se deduce.
 */
export async function computePlan(cfg: Config, perfilPedido?: string): Promise<Plan> {
  const manifiestos = readManifiestos();
  const actual = manifiestos.find((m) => m.version === PLANTILLA_VERSION);
  if (!actual) throw new Error(`Falta el manifiesto de la plantilla ${PLANTILLA_VERSION}`);

  const inst = await readMem(cfg, INSTITUCION_REL);
  let perfil: string;
  if (perfilPedido !== undefined && perfilPedido !== '' && !inst) {
    if (!perfilIds().includes(perfilPedido)) throw new HttpError(400, `Perfil de plantilla desconocido: ${perfilPedido}`, { field: 'perfil' });
    perfil = perfilPedido;
  } else {
    perfil = await deducePerfil(cfg, inst);
  }

  const cambios: Cambio[] = [];
  const revisar: Revisar[] = [];
  const next = new Map<string, Buffer | null>();
  const plan = (estado: EstadoPlantilla, versionMemoria: string | null): Plan => ({
    estado,
    versionMemoria,
    versionPlantilla: actual.version,
    perfil,
    cambios,
    revisar,
    next,
  });

  const memCls = await readMem(cfg, 'estilo/memoria.cls');
  const oldCls = await readMem(cfg, 'estilo/esi-tfg.cls');
  const clase = (memCls ?? oldCls) ? claseDe((memCls ?? oldCls)!.toString('utf8')) : null;
  const desde = clase ? manifiestos.find((m) => m.clase === clase) : undefined;
  if (!desde) return plan('desconocida', null);
  const migra = desde.version !== actual.version;

  const tpl = templateFiles(perfil);
  const tplBuf = (rel: string) => fs.readFile(tpl.get(rel)!);
  const add = (archivo: string, accion: Accion, motivo: string, cur: Buffer | null, data: Buffer | null) => {
    cambios.push({ archivo, accion, motivo, rev: cur ? rev(cur) : null });
    next.set(archivo, data);
  };

  // tfg.tex: edición puntual (\documentclass y bloque de índices si sigue como en la plantilla).
  const mainRel = cfg.memoriaMain;
  const mainBuf = await readMem(cfg, mainRel);
  let sigueClaseAntigua = false;
  if (mainBuf) {
    const src = mainBuf.toString('utf8');
    const nl = src.includes('\r\n') ? '\r\n' : '\n';
    const lines = src.split(/\r?\n/);
    const tplLines = tpl.has('tfg.tex') ? (await tplBuf('tfg.tex')).toString('utf8').split(/\r?\n/) : [];
    const hechos: string[] = [];
    const di = lines.findIndex((l) => OLD_DOCCLASS_RE.test(l));
    if (di >= 0) {
      lines[di] =
        lines[di].trimEnd() === OLD_DOCCLASS_LINE
          ? tplLine(tplLines, /^\\documentclass\{estilo\/memoria\}/, '\\documentclass{estilo/memoria}')
          : lines[di].replace('{estilo/esi-tfg}', '{estilo/memoria}');
      hechos.push('\\documentclass{estilo/memoria}');
    }
    if (migra && desde.clase?.startsWith('estilo/esi-tfg ')) {
      const ii = lines.findIndex((_, i) => OLD_INDICES.every((o, k) => (lines[i + k] ?? '').trimEnd() === o));
      if (ii >= 0) {
        lines.splice(ii, OLD_INDICES.length, tplLine(tplLines, /^\\indices(?![A-Za-z])/, '\\indices'));
        hechos.push('los índices pasan a \\indices');
      } else if (lines.some((l) => /^[ \t]*\\(tableofcontents|listoffigures|listoftables|lstlistoflistings)(?![A-Za-z])/.test(l))) {
        revisar.push({
          archivo: mainRel,
          motivo: 'los índices no siguen como en la plantilla: puedes cambiar \\tableofcontents, \\listoffigures… por \\indices, que solo pone los que hagan falta',
        });
      }
    }
    if (hechos.length) add(mainRel, 'editar', hechos.join('; '), mainBuf, Buffer.from(lines.join(nl), 'utf8'));
    sigueClaseAntigua = lines.some((l) => OLD_DOCCLASS_RE.test(l));
    if (oldCls && !memCls && di < 0 && !lines.some((l) => /^[ \t]*\\documentclass(\[[^\]]*\])?\{estilo\/memoria\}/.test(l))) {
      revisar.push({ archivo: mainRel, motivo: 'no se encontró \\documentclass{estilo/esi-tfg}: pon \\documentclass{estilo/memoria}' });
    }
  }

  // Clase (zona «no tocar»): se sustituye; la antigua se retira.
  const tplCls = await tplBuf('estilo/memoria.cls');
  if (!memCls) add('estilo/memoria.cls', 'crear', `clase de la plantilla ${actual.version}`, null, tplCls);
  else if (!memCls.equals(tplCls)) {
    add('estilo/memoria.cls', 'sustituir', `clase nueva (${actual.clase})`, memCls, tplCls);
    if (!known(desde, perfil, 'estilo/memoria.cls').includes(sha256(memCls))) {
      revisar.push({ archivo: 'estilo/memoria.cls', motivo: 'tenía cambios tuyos: se sustituye por la de la plantilla (queda una copia en el historial)' });
    }
  }
  if (oldCls) {
    if (sigueClaseAntigua) {
      revisar.push({ archivo: 'estilo/esi-tfg.cls', motivo: `se conserva porque ${mainRel} aún la usa` });
    } else {
      add('estilo/esi-tfg.cls', 'retirar', 'la sustituye estilo/memoria.cls', oldCls, null);
      const mOld = manifiestos.find((m) => m.clase === claseDe(oldCls.toString('utf8')));
      if (!mOld || !knownAny(mOld, 'estilo/esi-tfg.cls').includes(sha256(oldCls))) {
        revisar.push({ archivo: 'estilo/esi-tfg.cls', motivo: 'tenía cambios tuyos: se retira igualmente (queda una copia en el historial)' });
      }
    }
  }

  // institucion.tex del perfil (y su logo) si no existe; nunca se pisa.
  if (!inst && tpl.has(INSTITUCION_REL)) {
    const tplInst = await tplBuf(INSTITUCION_REL);
    const nombre = listPerfiles().find((p) => p.id === perfil)?.nombre ?? perfil;
    add(INSTITUCION_REL, 'crear', `datos de la institución (perfil ${nombre})`, null, tplInst);
    const logo = parseDatos(tplInst.toString('utf8'), 'institucion').logo;
    if (logo && tpl.has(`estilo/${logo}`) && !(await readMem(cfg, `estilo/${logo}`))) {
      add(`estilo/${logo}`, 'crear', 'logo del perfil', null, await tplBuf(`estilo/${logo}`));
    }
  }

  // datos.tex: se conservan los valores y se añaden los comandos nuevos.
  const datosBuf = migra ? await readMem(cfg, DATOS_REL) : null;
  if (datosBuf && tpl.has('datos.tex')) {
    const src = datosBuf.toString('utf8');
    const tplSrc = (await tplBuf('datos.tex')).toString('utf8');
    const tplVals = parseDatos(tplSrc, 'datos');
    const memVals = parseDatos(src, 'datos');
    const changes: Record<string, string> = {};
    const added: string[] = [];
    for (const cmd of actual.comandosDatos.filter((c) => !desde.comandosDatos.includes(c))) {
      const defs = fieldsOf('datos').filter((f) => f.cmd === cmd);
      if (!defs.length || findCommand(src, cmd, defs[0].nargs ?? 1)) continue;
      for (const f of defs) changes[f.key] = tplVals[f.key] ?? '';
      // Las keywords de ejemplo solo si las palabras clave también son las de ejemplo.
      if (cmd === 'keywords' && memVals.palabrasClave !== tplVals.palabrasClave) changes.keywords = '';
      added.push(cmd);
    }
    // La clase de la ESI ponía «Ciudad Real» por defecto.
    if (perfil === 'esi-uclm' && desde.clase?.startsWith('estilo/esi-tfg ') && !findCommand(src, 'ciudad')) {
      changes.ciudad = 'Ciudad Real';
      added.push('ciudad');
    }
    if (added.length) {
      const out = withTemplateComments(applyChanges(src, 'datos', changes), tplSrc, added);
      add(DATOS_REL, 'editar', `añade ${added.map((c) => `\\${c}`).join(', ')}`, datosBuf, Buffer.from(out, 'utf8'));
    }
  }

  // Contenido: solo lo que sigue sin tocar.
  for (const [rel, abs] of tpl) {
    if (!isContenido(rel)) continue;
    const cur = await readMem(cfg, rel);
    if (!cur) continue;
    const nuevo = await fs.readFile(abs);
    if (cur.equals(nuevo)) continue;
    if (known(desde, perfil, rel).includes(sha256(cur))) {
      const nov = desde.version === 'v0.3' ? NOVEDADES_V03[rel] : undefined;
      add(rel, 'sustituir', nov ? `sin cambios tuyos: ${nov}` : 'sin cambios tuyos: versión nueva de la plantilla', cur, nuevo);
    } else if (!knownAny(desde, rel).includes(sha256(cur))) {
      // (Si coincide con el de otro perfil, sigue sin tocar pero no es de este perfil: se deja.)
      const antes = knownAny(desde, rel);
      if (antes.length && !antes.includes(sha256(nuevo))) revisar.push({ archivo: rel, motivo: motivoRevisar(rel, cur.toString('utf8')) });
    }
  }

  // .gitignore: se añaden las líneas que falten.
  if (migra && tpl.has('.gitignore')) {
    const tplGi = await tplBuf('.gitignore');
    const gi = await readMem(cfg, '.gitignore');
    if (!gi) add('.gitignore', 'crear', 'archivos generados que git debe ignorar', null, tplGi);
    else {
      const have = new Set(gi.toString('utf8').split(/\r?\n/).map((l) => l.trim()));
      const missing = tplGi
        .toString('utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !have.has(l));
      if (missing.length) {
        const s = gi.toString('utf8');
        const out = s + (s.length && !s.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n';
        add('.gitignore', 'editar', `añade ${missing.join(' ')}`, gi, Buffer.from(out, 'utf8'));
      }
    }
  }

  return plan(cambios.length ? 'desactualizada' : 'actual', desde.version);
}

export function publicPlan(p: Plan): PlanPlantilla {
  const { next: _next, ...rest } = p;
  return rest;
}

// ---- Git ----

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: env ?? process.env, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr) }));
      else resolve(String(stdout));
    });
  });
}

/** Con identidad genérica si git no tiene una configurada (como al crear la memoria). */
async function gitWithIdentity(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    return await git(cwd, args, env);
  } catch {
    return git(cwd, [...GIT_IDENTITY, ...args], env);
  }
}

/** La memoria es un repositorio git (su raíz es la de la memoria). */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const top = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
    return (await fs.realpath(top)) === (await fs.realpath(dir));
  } catch {
    return false;
  }
}

async function gitHead(dir: string): Promise<string | null> {
  try {
    return (await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null;
  } catch {
    return null;
  }
}

/** Commit solo de `paths` (lo demás que haya en el índice o en la carpeta no se incluye). */
async function commitPaths(dir: string, cambios: Cambio[], msg: string): Promise<string | null> {
  const paths = cambios.map((c) => c.archivo);
  const tracked = new Set((await git(dir, ['ls-files', '-z', '--', ...paths])).split('\0').filter(Boolean));
  const nuevos = cambios.filter((c) => c.accion !== 'retirar' && !tracked.has(c.archivo)).map((c) => c.archivo);
  const ignored = new Set(
    nuevos.length ? (await git(dir, ['check-ignore', '-z', '--', ...nuevos]).catch(() => '')).split('\0').filter(Boolean) : [],
  );
  const toAdd = nuevos.filter((p) => !ignored.has(p));
  const todo = paths.filter((p) => tracked.has(p) || toAdd.includes(p));
  if (!todo.length) return null;
  if (toAdd.length) await git(dir, ['add', '--', ...toAdd]);
  try {
    await gitWithIdentity(dir, ['commit', '-q', '-m', msg, '--', ...todo]);
  } catch (e) {
    if (toAdd.length) await git(dir, ['reset', '-q', '--', ...toAdd]).catch(() => undefined);
    throw e;
  }
  return gitHead(dir);
}

/**
 * Commit nuevo que revierte `commit` (debe ser HEAD) sin tocar la carpeta ni el resto del
 * índice: se construye el árbol con un índice temporal.
 */
async function revertHead(dir: string, commit: string, msg: string, tmpDir: string): Promise<string | null> {
  const parent = (await git(dir, ['rev-parse', '--verify', '-q', `${commit}^`]).catch(() => '')).trim();
  if (!parent) return null;
  const paths = (await git(dir, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', parent, commit])).split('\0').filter(Boolean);
  if (!paths.length) return null;
  await fs.mkdir(tmpDir, { recursive: true });
  const index = path.join(tmpDir, `index-${crypto.randomBytes(6).toString('hex')}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    await git(dir, ['read-tree', commit], env);
    for (const p of paths) {
      const ls = (await git(dir, ['ls-tree', '-z', parent, '--', p])).split('\0')[0];
      if (ls) {
        const [meta] = ls.split('\t');
        const [mode, , sha] = meta.split(' ');
        await git(dir, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${p}`], env);
      } else {
        await git(dir, ['update-index', '--force-remove', '--', p], env);
      }
    }
    const tree = (await git(dir, ['write-tree'], env)).trim();
    const c = (await gitWithIdentity(dir, ['commit-tree', tree, '-p', commit, '-m', msg])).trim();
    await git(dir, ['update-ref', '-m', msg, 'HEAD', c, commit]);
    // El índice real de esas rutas vuelve a coincidir con HEAD.
    await git(dir, ['reset', '-q', '--', ...paths]);
    return c;
  } finally {
    await fs.rm(index, { force: true });
  }
}

// ---- Registro para deshacer (data/history/plantilla/<id>.json) ----

interface Registro {
  id: string;
  fecha: string;
  version: string;
  perfil: string;
  archivos: { archivo: string; antes: string | null; despues: string | null }[];
  commit: string | null;
  deshecho: boolean;
}

const regDir = (cfg: Config) => path.join(cfg.historyDir, 'plantilla');
const ID_RE = /^[0-9A-Za-z-]{8,80}$/;

async function saveRegistro(cfg: Config, r: Registro): Promise<void> {
  await fs.mkdir(regDir(cfg), { recursive: true });
  await atomicWrite(path.join(regDir(cfg), `${r.id}.json`), JSON.stringify(r));
}

async function lastRegistro(cfg: Config): Promise<Registro | null> {
  let names: string[];
  try {
    names = (await fs.readdir(regDir(cfg))).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return null;
  }
  const last = names.at(-1);
  if (!last) return null;
  return JSON.parse(await fs.readFile(path.join(regDir(cfg), last), 'utf8')) as Registro;
}

/** Ejecuta `fn` con los bloqueos de todas las claves (en orden fijo). */
function withLocks<T>(locks: KeyedLock, keys: string[], fn: () => Promise<T>): Promise<T> {
  return [...new Set(keys)]
    .sort()
    .reduceRight<() => Promise<T>>((inner, k) => () => locks.run(k, inner), fn)();
}

const lockKeys = (archivos: string[]) => archivos.map((a) => `memoria:${a}`);

function parseCambios(v: unknown): { archivo: string; accion: string; motivo?: string; rev?: string | null }[] {
  if (!Array.isArray(v)) throw badRequest('cambios es obligatorio (la lista de la vista previa)');
  return v.map((c) => {
    if (!c || typeof c !== 'object' || typeof c.archivo !== 'string' || typeof c.accion !== 'string') throw badRequest('cambios no es válido');
    return c;
  });
}

/** Mismos archivos, acciones y motivos (y revisiones, si el cliente las envía) que la vista previa. */
function samePlan(plan: Plan, perfil: string, cambios: ReturnType<typeof parseCambios>): boolean {
  if (plan.perfil !== perfil || plan.cambios.length !== cambios.length) return false;
  const key = (c: { archivo: string; accion: string }) => `${c.archivo}\0${c.accion}`;
  const mine = new Map(plan.cambios.map((c) => [key(c), c]));
  return cambios.every((c) => {
    const m = mine.get(key(c));
    return !!m && (c.rev === undefined || c.rev === m.rev) && (c.motivo === undefined || c.motivo === m.motivo);
  });
}

const PLANTILLA_LOCK = 'memoria-plantilla';

export async function aplicarPlantilla(ctx: Ctx, body: unknown): Promise<ResultadoActualizar> {
  const { cfg, locks } = ctx;
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.perfil !== 'string' || !b.perfil) throw badRequest('perfil es obligatorio');
  const perfil = b.perfil;
  const enviados = parseCambios(b.cambios);

  return locks.run(PLANTILLA_LOCK, async () => {
    const pre = await computePlan(cfg, perfil);
    const keys = lockKeys([...pre.cambios.map((c) => c.archivo), ...enviados.map((c) => c.archivo)]);
    return withLocks(locks, keys, async () => {
      const plan = await computePlan(cfg, perfil);
      if (plan.estado !== 'desactualizada') {
        throw new HttpError(
          409,
          plan.estado === 'actual' ? 'La memoria ya usa la plantilla actual' : 'No se reconoce la clase de esta memoria: no se puede actualizar',
          { actual: publicPlan(plan) },
        );
      }
      if (!samePlan(plan, perfil, enviados)) {
        throw new HttpError(409, 'La memoria ha cambiado desde la vista previa: revisa los cambios de nuevo', { actual: publicPlan(plan) });
      }

      // Registro para deshacer (con el contenido anterior) antes de escribir nada.
      const archivos: Registro['archivos'] = [];
      const actuales = new Map<string, Buffer | null>();
      for (const c of plan.cambios) {
        const cur = await readMem(cfg, c.archivo);
        actuales.set(c.archivo, cur);
        const data = plan.next.get(c.archivo) ?? null;
        archivos.push({ archivo: c.archivo, antes: cur ? cur.toString('base64') : null, despues: data ? sha256(data) : null });
      }
      const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
      const reg: Registro = { id, fecha: new Date().toISOString(), version: plan.versionPlantilla, perfil, archivos, commit: null, deshecho: false };
      await saveRegistro(cfg, reg);

      const ordered = [...plan.cambios].sort((x, y) => Number(x.accion === 'retirar') - Number(y.accion === 'retirar'));
      for (const c of ordered) {
        const r = await resolveSafe(cfg, 'memoria', c.archivo);
        const cur = actuales.get(c.archivo) ?? null;
        if (cur) await backup(cfg, 'memoria', c.archivo, cur);
        const data = plan.next.get(c.archivo) ?? null;
        if (data === null) {
          await fs.rm(r.abs, { force: true });
          continue;
        }
        await fs.mkdir(path.dirname(r.abs), { recursive: true });
        await resolveSafe(cfg, 'memoria', c.archivo); // la carpeta nueva sigue dentro de la raíz
        if (cur) await atomicWrite(r.abs, data);
        else if (!(await createExclusive(r.abs, data))) await atomicWrite(r.abs, data);
      }

      const revisar = [...plan.revisar];
      let commit: string | null = null;
      if (await isGitRepo(cfg.memoriaDir)) {
        try {
          commit = await commitPaths(cfg.memoriaDir, plan.cambios, `Actualizar plantilla a ${plan.versionPlantilla}`);
        } catch (e: any) {
          revisar.push({ archivo: '.git', motivo: `no se pudo hacer el commit: ${String(e?.stderr || e?.message || e).trim().split('\n')[0]}` });
        }
      }
      if (commit) await saveRegistro(cfg, { ...reg, commit });
      return { aplicados: plan.cambios, revisar, commit, deshacer: id };
    });
  });
}

export interface ResultadoDeshacer {
  restaurados: string[];
  commit: string | null;
}

export async function deshacerPlantilla(ctx: Ctx, body: unknown): Promise<ResultadoDeshacer> {
  const { cfg, locks } = ctx;
  const id = (body as Record<string, unknown> | null)?.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) throw badRequest('id es obligatorio');
  return locks.run(PLANTILLA_LOCK, async () => {
    const reg = await lastRegistro(cfg);
    if (!reg || reg.id !== id) throw new HttpError(409, 'Solo se puede deshacer la última actualización de la plantilla');
    if (reg.deshecho) throw new HttpError(409, 'Esta actualización ya se deshizo');
    return withLocks(locks, lockKeys(reg.archivos.map((a) => a.archivo)), async () => {
      const actuales = new Map<string, Buffer | null>();
      for (const a of reg.archivos) {
        const cur = await readMem(cfg, a.archivo);
        if ((cur ? sha256(cur) : null) !== a.despues) {
          throw new HttpError(409, `«${a.archivo}» ha cambiado después de actualizar: no se puede deshacer automáticamente (las copias están en el historial)`);
        }
        actuales.set(a.archivo, cur);
      }
      let commit: string | null = null;
      if (reg.commit && (await isGitRepo(cfg.memoriaDir)) && (await gitHead(cfg.memoriaDir)) === reg.commit) {
        commit = await revertHead(cfg.memoriaDir, reg.commit, `Deshacer la actualización de la plantilla a ${reg.version}`, regDir(cfg));
      }
      for (const a of reg.archivos) {
        const r = await resolveSafe(cfg, 'memoria', a.archivo);
        const cur = actuales.get(a.archivo) ?? null;
        if (cur) await backup(cfg, 'memoria', a.archivo, cur);
        if (a.antes === null) {
          await fs.rm(r.abs, { force: true });
        } else {
          await fs.mkdir(path.dirname(r.abs), { recursive: true });
          await atomicWrite(r.abs, Buffer.from(a.antes, 'base64'));
        }
      }
      await saveRegistro(cfg, { ...reg, deshecho: true });
      return { restaurados: reg.archivos.map((a) => a.archivo), commit };
    });
  });
}
