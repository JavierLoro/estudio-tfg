// Panel «Datos del trabajo» (v0.5): lectura y escritura de datos.tex y estilo/institucion.tex.
// Cada campo se lee de la primera línea no comentada que empieza por su comando y al escribir
// solo se reemplaza su argumento (llaves equilibradas), conservando el resto de la línea.

export type DatosFile = 'datos' | 'institucion';

export const DATOS_REL = 'datos.tex';
export const INSTITUCION_REL = 'estilo/institucion.tex';
export const ADDED_MARK = '%% Añadido por Estudio TFG';

export type FieldKind = 'text' | 'enum' | 'length' | 'year' | 'logo';

export interface FieldDef {
  /** Clave en la API. */
  key: string;
  /** Comando LaTeX sin la barra. */
  cmd: string;
  file: DatosFile;
  kind: FieldKind;
  /** Valores permitidos (kind enum). */
  values?: string[];
  /** Posición del argumento dentro del comando (0 por defecto). */
  arg?: number;
  /** Número de argumentos del comando. */
  nargs?: number;
}

const BIB_VALUES = ['ieee', 'apa', 'numeric', 'authoryear', 'alphabetic', 'ieeetr', 'plain', 'alpha', 'apalike'];

const text = (file: DatosFile, key: string): FieldDef => ({ key, cmd: key, file, kind: 'text' });
const en = (file: DatosFile, key: string, values: string[]): FieldDef => ({ key, cmd: key, file, kind: 'enum', values });

export const FIELDS: FieldDef[] = [
  text('datos', 'titulo'),
  text('datos', 'autor'),
  text('datos', 'email'),
  text('datos', 'tutor'),
  text('datos', 'cotutor'),
  text('datos', 'departamento'),
  text('datos', 'intensificacion'),
  { key: 'fechaMes', cmd: 'fecha', file: 'datos', kind: 'text', arg: 0, nargs: 2 },
  { key: 'fechaAnio', cmd: 'fecha', file: 'datos', kind: 'year', arg: 1, nargs: 2 },
  text('datos', 'ciudad'),
  text('datos', 'palabrasClave'),
  text('datos', 'keywords'),
  en('datos', 'idioma', ['espanol', 'ingles']),
  en('datos', 'formato', ['impresion', 'pantalla']),
  en('datos', 'estiloBibliografia', BIB_VALUES),
  en('datos', 'modo', ['borrador', 'final']),
  en('datos', 'licencia', ['reservados', 'cc-by', 'cc-by-sa', 'cc-by-nc-sa', 'ninguna']),
  en('datos', 'atribucion', ['si', 'no']),

  text('institucion', 'universidad'),
  text('institucion', 'escuela'),
  { key: 'logo', cmd: 'logo', file: 'institucion', kind: 'logo' },
  en('institucion', 'tipoTrabajo', ['tfg', 'tfm', 'tesis', 'otro']),
  text('institucion', 'nombreTrabajo'),
  text('institucion', 'titulacion'),
  text('institucion', 'etiquetaEspecialidad'),
  en('institucion', 'idiomaPortadas', ['espanol', 'ingles', 'documento']),
  en('institucion', 'tamanoLetra', ['10pt', '11pt', '12pt']),
  ...(['margenInterior', 'margenExterior', 'margenSuperior', 'margenInferior'] as const).map(
    (key, arg): FieldDef => ({ key, cmd: 'margenes', file: 'institucion', kind: 'length', arg, nargs: 4 }),
  ),
  en('institucion', 'interlineado', ['1', '1.15', '1.25', '1.5', '2']),
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [`${f.file}:${f.key}`, f]));

export function fieldsOf(file: DatosFile): FieldDef[] {
  return FIELDS.filter((f) => f.file === file);
}

// ---- Escapado ----

const ESC: Record<string, string> = {
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '\\': '\\textbackslash{}',
};

export function escapeTex(s: string): string {
  return s.replace(/[&%$#_{}~^\\]/g, (c) => ESC[c]);
}

export function unescapeTex(s: string): string {
  return s.replace(/\\textbackslash\{\}|\\textasciitilde\{\}|\\textasciicircum\{\}|\\([&%$#_{}])/g, (m, c) => {
    if (c) return c;
    return m.startsWith('\\textbackslash') ? '\\' : m.startsWith('\\textasciitilde') ? '~' : '^';
  });
}

// ---- Análisis ----

interface Span {
  /** Posición de `{` y de `}` (exclusiva: contenido = [start, end)). */
  start: number;
  end: number;
}

/** Posición del primer `%` de comentario de la línea que empieza en `ls` (o -1). */
function commentPos(src: string, ls: number): number {
  for (let i = ls; i < src.length && src[i] !== '\n'; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '%') return i;
  }
  return -1;
}

/** Lee un grupo `{…}` desde `i` (que debe ser `{`). Devuelve el cierre o -1. */
function readGroup(src: string, i: number): number {
  let depth = 0;
  for (let p = i; p < src.length; p++) {
    const c = src[p];
    if (c === '\\') p++;
    else if (c === '%') {
      const nl = src.indexOf('\n', p);
      if (nl < 0) return -1;
      p = nl;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return p;
  }
  return -1;
}

/** Argumentos de la primera aparición (no comentada) del comando, o null si no está o está mal formada. */
export function findCommand(src: string, cmd: string, nargs = 1): Span[] | null {
  const re = new RegExp(`^[ \\t]*\\\\${cmd}(?![A-Za-z@])`, 'gm');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const cp = commentPos(src, m.index);
    if (cp >= 0 && cp < m.index + m[0].length) continue;
    const spans: Span[] = [];
    let p = m.index + m[0].length;
    let ok = true;
    for (let a = 0; a < nargs; a++) {
      while (p < src.length && (src[p] === ' ' || src[p] === '\t')) p++;
      if (src[p] !== '{') {
        ok = false;
        break;
      }
      const close = readGroup(src, p);
      if (close < 0) {
        ok = false;
        break;
      }
      spans.push({ start: p + 1, end: close });
      p = close + 1;
    }
    if (ok) return spans;
  }
  return null;
}

const decode = (f: FieldDef, raw: string) => (f.kind === 'text' ? unescapeTex(raw.trim()) : raw.trim());

export function parseDatos(src: string, file: DatosFile): Record<string, string> {
  const out: Record<string, string> = {};
  const cache = new Map<string, Span[] | null>();
  for (const f of fieldsOf(file)) {
    if (!cache.has(f.cmd)) cache.set(f.cmd, findCommand(src, f.cmd, f.nargs ?? 1));
    const spans = cache.get(f.cmd);
    const sp = spans?.[f.arg ?? 0];
    out[f.key] = sp ? decode(f, src.slice(sp.start, sp.end)) : '';
  }
  return out;
}

// ---- Validación ----

export class FieldInvalid extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}

const LENGTH_RE = /^(\d+(\.\d+)?|\.\d+)(mm|cm|pt|in|bp|pc|em|ex)$/;
const LOGO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(pdf|png|jpe?g)$/i;
const MAX_TEXT = 2000;

/** Relleno de los argumentos que faltan al añadir un comando de varios argumentos. */
const APPEND_DEFAULTS: Record<string, string> = {
  margenInterior: '30mm',
  margenExterior: '25mm',
  margenSuperior: '25mm',
  margenInferior: '25mm',
};

/** Valida el valor y lo devuelve listo para escribir (ya escapado). */
export function encodeValue(f: FieldDef, value: unknown): string {
  if (typeof value !== 'string') throw new FieldInvalid(f.key, `${f.key}: el valor debe ser texto`);
  const v = f.kind === 'text' ? value.replace(/\s*[\r\n]+\s*/g, ' ').trim() : value.trim();
  switch (f.kind) {
    case 'text':
      if (v.length > MAX_TEXT) throw new FieldInvalid(f.key, `${f.key}: demasiado largo (máx. ${MAX_TEXT} caracteres)`);
      return escapeTex(v);
    case 'enum':
      if (!f.values!.includes(v)) throw new FieldInvalid(f.key, `${f.key}: valor no válido «${v}» (permitidos: ${f.values!.join(', ')})`);
      return v;
    case 'length':
      if (!LENGTH_RE.test(v)) throw new FieldInvalid(f.key, `${f.key}: longitud no válida «${v}» (p. ej. 35mm)`);
      return v;
    case 'year':
      if (v !== '' && !/^\d{4}$/.test(v)) throw new FieldInvalid(f.key, `${f.key}: el año debe tener 4 cifras`);
      return v;
    case 'logo':
      if (v !== '' && !LOGO_RE.test(v)) throw new FieldInvalid(f.key, `${f.key}: debe ser un archivo .pdf, .png o .jpg de estilo/`);
      return v;
  }
}

/**
 * Aplica los cambios (clave → valor sin escapar). Reemplaza solo los argumentos y añade al final
 * los comandos que faltan. Lanza FieldInvalid si algún valor no es válido.
 */
export function applyChanges(src: string, file: DatosFile, changes: Record<string, unknown>): string {
  const defs: FieldDef[] = [];
  for (const k of Object.keys(changes)) {
    const f = FIELD_BY_KEY.get(`${file}:${k}`);
    if (!f) throw new FieldInvalid(k, `Campo desconocido: ${k}`);
    defs.push(f);
  }
  const encoded = new Map<FieldDef, string>();
  for (const f of defs) encoded.set(f, encodeValue(f, changes[f.key]));

  const cmds = [...new Set(defs.map((f) => f.cmd))];
  let out = src;
  const appended: string[] = [];
  for (const cmd of cmds) {
    const all = fieldsOf(file).filter((f) => f.cmd === cmd);
    const nargs = all[0].nargs ?? 1;
    const spans = findCommand(out, cmd, nargs);
    if (spans) {
      // De atrás hacia delante para no desplazar las posiciones.
      const todo = all.filter((f) => encoded.has(f)).sort((a, b) => (b.arg ?? 0) - (a.arg ?? 0));
      for (const f of todo) {
        const sp = spans[f.arg ?? 0];
        out = out.slice(0, sp.start) + encoded.get(f)! + out.slice(sp.end);
      }
    } else {
      const parts = all.map((f) => encoded.get(f) ?? APPEND_DEFAULTS[f.key] ?? '');
      appended.push(`\\${cmd}${parts.map((p) => `{${p}}`).join('')}`);
    }
  }
  if (appended.length) {
    if (out.length && !out.endsWith('\n')) out += '\n';
    if (!out.includes(ADDED_MARK)) out += `${out.length ? '\n' : ''}${ADDED_MARK}\n`;
    out += appended.join('\n') + '\n';
  }
  return out;
}

/** Claves permitidas para un archivo. */
export function validKeys(file: DatosFile): string[] {
  return fieldsOf(file).map((f) => f.key);
}
