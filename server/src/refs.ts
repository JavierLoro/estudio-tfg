import fs from 'node:fs/promises';
import type { Config } from './config.ts';
import type { ChangeEvent, EventBus } from './events.ts';
import { walkFiles } from './fsutil.ts';
import { stripComment } from './outline.ts';

// Autocompletado (v0.8): citas (.bib), etiquetas (\label) y acrónimos (\acro) de la memoria.
// Análisis aproximado por diseño (sin expandir TeX), tolerante con entradas mal formadas.

export interface Cita {
  key: string;
  tipo: string;
  titulo: string;
  autor: string;
  anio: string;
  archivo: string;
}

export type EtiquetaTipo = 'capitulo' | 'seccion' | 'figura' | 'tabla' | 'listado' | 'ecuacion' | 'anexo' | 'otro';

export interface Etiqueta {
  label: string;
  tipo: EtiquetaTipo;
  texto: string;
  archivo: string;
  linea: number;
}

export interface Acronimo {
  sigla: string;
  significado: string;
  archivo: string;
  linea: number;
}

export interface Refs {
  citas: Cita[];
  etiquetas: Etiqueta[];
  acronimos: Acronimo[];
}

// ---------------------------------------------------------------------------
// Texto LaTeX → texto para mostrar

const ACCENTS: Record<string, string> = {
  '`': '̀', "'": '́', '^': '̂', '~': '̃', '"': '̈', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊',
};
const SPECIAL: Record<string, string> = {
  ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ',
  '&': '&', '%': '%', $: '$', '#': '#', _: '_', '{': '{', '}': '}',
};

/** Simplifica campos LaTeX/BibTeX para mostrarlos: sin llaves, acentos resueltos, sin comandos. */
export function cleanTex(input: string): string {
  let s = input;
  // Acentos: \'{a}, \'a, {\'a}, \'{\i}
  s = s.replace(/\\([`'^~"=.uvHckr])\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|(\\[ij]|[A-Za-z]))/g, (m, acc: string, a1?: string, a2?: string) => {
    let ch = (a1 ?? a2)!;
    if (ch === '\\i') ch = 'i';
    else if (ch === '\\j') ch = 'j';
    // `\c c` / `\v s` con letra: la forma con espacio ya se consumió con \s*
    return (ch + ACCENTS[acc]).normalize('NFC');
  });
  s = s.replace(/\\(ss|oe|OE|ae|AE|aa|AA|[oOlLij])(?![A-Za-z])\s*/g, (_m, c: string) => SPECIAL[c] ?? c);
  s = s.replace(/\\([&%$#_{}])/g, (_m, c: string) => SPECIAL[c]);
  s = s.replace(/\\(?:textendash|textemdash)\b/g, '–');
  s = s.replace(/---/g, '—').replace(/--/g, '–');
  s = s.replace(/``|''/g, '"');
  s = s.replace(/\\(La)?TeX(?![A-Za-z])\s*/g, (_m, la?: string) => (la ? 'LaTeX' : 'TeX'));
  // Comandos con argumento (\textit{x}, \emph{x}, \url{x}) → su contenido; el resto desaparece.
  s = s.replace(/\\[A-Za-z]+\*?(?:\s*\[[^\]]*\])?/g, '');
  s = s.replace(/\\[,;:! ]/g, ' ').replace(/\\\\/g, ' ').replace(/\\/g, '');
  s = s.replace(/[{}]/g, '').replace(/\$/g, '').replace(/~/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Utilidades de lectura con llaves equilibradas

/** `text[i] === open`: devuelve el contenido y la posición siguiente al cierre (o null). */
function readGroup(text: string, i: number, open = '{', close = '}'): { content: string; end: number } | null {
  if (text[i] !== open) return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{' && open === '{') depth++;
    else if (c === '}' && open === '{') {
      depth--;
      if (depth === 0) return { content: text.slice(i + 1, j), end: j + 1 };
    } else if (open === '[') {
      if (c === '{') {
        const g = readGroup(text, j);
        if (!g) return null;
        j = g.end - 1;
      } else if (c === ']') return { content: text.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

const skipWs = (text: string, i: number) => {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
};

/** Con `%` de comentario eliminado línea a línea (conserva los saltos de línea). */
function stripComments(text: string): string {
  return text.split('\n').map(stripComment).join('\n');
}

// ---------------------------------------------------------------------------
// .bib

/** Divide por `and` al nivel superior (fuera de llaves). */
function splitAuthors(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  const words = raw.split(/(\s+)/);
  for (const w of words) {
    if (depth === 0 && w === 'and') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    for (const c of w) {
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
    }
    cur += w;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

function lastName(author: string): string {
  const a = author.trim();
  if (/^\{.*\}$/s.test(a) && readGroup(a, 0)?.end === a.length) return cleanTex(a);
  // Coma al nivel superior: «Apellido, Nombre».
  let depth = 0;
  for (let i = 0; i < a.length; i++) {
    const c = a[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth === 0) return cleanTex(a.slice(0, i));
  }
  // «Nombre Apellido»: última palabra fuera de llaves.
  const parts: string[] = [];
  let cur = '';
  depth = 0;
  for (const c of a) {
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (/\s/.test(c) && depth === 0) {
      if (cur) parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) parts.push(cur);
  return cleanTex(parts[parts.length - 1] ?? a);
}

export function abbreviateAuthors(raw: string): string {
  const list = splitAuthors(raw);
  if (!list.length) return '';
  const others = list[list.length - 1] === 'others';
  const names = (others ? list.slice(0, -1) : list).map(lastName).filter(Boolean);
  if (!names.length) return '';
  if (others || names.length >= 3) return `${names[0]} et al.`;
  return names.length === 2 ? `${names[0]} y ${names[1]}` : names[0];
}

interface RawEntry {
  tipo: string;
  key: string;
  fields: Map<string, string>;
}

/** Valor de un campo: llaves, comillas, números y macros de @string unidos con `#`. */
function readValue(text: string, i: number, macros: Map<string, string>): { value: string; end: number } | null {
  let out = '';
  for (;;) {
    i = skipWs(text, i);
    const c = text[i];
    if (c === '{') {
      const g = readGroup(text, i);
      if (!g) return null;
      out += g.content;
      i = g.end;
    } else if (c === '"') {
      let depth = 0;
      let j = i + 1;
      for (; j < text.length; j++) {
        const d = text[j];
        if (d === '\\') j++;
        else if (d === '{') depth++;
        else if (d === '}') depth--;
        else if (d === '"' && depth <= 0) break;
      }
      if (j >= text.length) return null;
      out += text.slice(i + 1, j);
      i = j + 1;
    } else {
      const m = /^[^\s,#{}"=()]+/.exec(text.slice(i, i + 200));
      if (!m) return out || i === text.length ? { value: out, end: i } : null;
      out += macros.get(m[0].toLowerCase()) ?? m[0];
      i += m[0].length;
    }
    const j = skipWs(text, i);
    if (text[j] === '#') {
      i = j + 1;
      continue;
    }
    return { value: out, end: i };
  }
}

/** Entradas de un .bib. Ignora @comment, @string (las guarda como macros), @preamble y texto suelto. */
export function parseBib(text: string): RawEntry[] {
  const macros = new Map<string, string>();
  const entries: RawEntry[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const at = text.indexOf('@', i);
    if (at < 0) break;
    // Un `@` en una línea comentada (`% @book{…`) no abre entrada.
    const ls = text.lastIndexOf('\n', at - 1) + 1;
    if (/^\s*%/.test(text.slice(ls, at))) {
      const nl = text.indexOf('\n', at);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    const m = /^@\s*([A-Za-z]+)\s*([{(])/.exec(text.slice(at, at + 80));
    if (!m) {
      i = at + 1;
      continue;
    }
    const tipo = m[1].toLowerCase();
    const open = m[2];
    const closeCh = open === '{' ? '}' : ')';
    let p = at + m[0].length;
    if (tipo === 'comment' || tipo === 'preamble') {
      // Saltar el bloque equilibrado.
      const g = open === '{' ? readGroup(text, p - 1) : null;
      if (g) i = g.end;
      else {
        const e = text.indexOf(closeCh, p);
        i = e < 0 ? n : e + 1;
      }
      continue;
    }
    if (tipo === 'string') {
      const nm = /^\s*([^\s=]+)\s*=/.exec(text.slice(p, p + 200));
      if (nm) {
        const v = readValue(text, p + nm[0].length, macros);
        if (v) {
          macros.set(nm[1].toLowerCase(), v.value);
          p = v.end;
        }
      }
      const g = open === '{' ? readGroup(text, at + m[0].length - 1) : null;
      if (g) i = g.end;
      else {
        const e = text.indexOf(closeCh, p);
        i = e < 0 ? n : e + 1;
      }
      continue;
    }
    // Clave
    const km = /^\s*([^\s,{}()]*)\s*,?/.exec(text.slice(p, p + 400));
    if (!km) {
      i = p;
      continue;
    }
    const key = km[1];
    p += km[0].length;
    const fields = new Map<string, string>();
    let ok = true;
    for (;;) {
      p = skipWs(text, p);
      while (text[p] === ',') p = skipWs(text, p + 1);
      if (p >= n) break;
      if (text[p] === closeCh) {
        p++;
        break;
      }
      const fm = /^([A-Za-z][A-Za-z0-9_:\-.]*)\s*=/.exec(text.slice(p, p + 100));
      if (!fm) {
        ok = false;
        break;
      }
      const v = readValue(text, p + fm[0].length, macros);
      if (!v) {
        ok = false;
        break;
      }
      const name = fm[1].toLowerCase();
      if (!fields.has(name)) fields.set(name, v.value);
      p = v.end;
    }
    if (key) entries.push({ tipo, key, fields });
    if (ok) i = p;
    else {
      // Entrada rota: seguir en la siguiente línea que empiece por `@`.
      const nx = /\n\s*@/.exec(text.slice(p));
      i = nx ? p + nx.index + 1 : n;
    }
  }
  return entries;
}

export function citasFromBib(text: string, archivo: string): Cita[] {
  return parseBib(text).map((e) => {
    const f = e.fields;
    const date = f.get('date') ?? '';
    const anio = cleanTex(f.get('year') ?? '') || (/\b(\d{4})\b/.exec(date)?.[1] ?? '');
    return {
      key: e.key,
      tipo: e.tipo,
      titulo: cleanTex(f.get('title') ?? f.get('booktitle') ?? ''),
      autor: abbreviateAuthors(f.get('author') ?? f.get('editor') ?? ''),
      anio,
      archivo,
    };
  });
}

// ---------------------------------------------------------------------------
// .tex

function lineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineAt(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const VERBATIM = new Set(['verbatim', 'verbatim*', 'Verbatim', 'BVerbatim', 'lstlisting', 'minted', 'comment', 'alltt']);
const ENV_TIPO: Record<string, EtiquetaTipo> = {
  figure: 'figura', 'figure*': 'figura', wrapfigure: 'figura', subfigure: 'figura', sidewaysfigure: 'figura', subfloat: 'figura',
  table: 'tabla', 'table*': 'tabla', longtable: 'tabla', sidewaystable: 'tabla', subtable: 'tabla',
  lstlisting: 'listado', listing: 'listado', minted: 'listado',
  equation: 'ecuacion', 'equation*': 'ecuacion', align: 'ecuacion', 'align*': 'ecuacion', gather: 'ecuacion', 'gather*': 'ecuacion',
  multline: 'ecuacion', 'multline*': 'ecuacion', eqnarray: 'ecuacion', 'eqnarray*': 'ecuacion', flalign: 'ecuacion', 'flalign*': 'ecuacion',
  alignat: 'ecuacion', 'alignat*': 'ecuacion', displaymath: 'ecuacion', split: 'ecuacion',
};
const HEADING_TIPO: Record<string, EtiquetaTipo> = {
  chapter: 'capitulo', section: 'seccion', subsection: 'seccion', subsubsection: 'seccion', paragraph: 'seccion', part: 'seccion',
};

/** Sustituye por espacios el cuerpo de los entornos literales (conserva saltos de línea y posiciones). */
function blankVerbatim(text: string): string {
  const re = /\\begin\{([A-Za-z*]+)\}/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!VERBATIM.has(m[1]) || m.index < last) continue;
    let from = m.index + m[0].length;
    // Opciones `[...]` (lstlisting/minted) se conservan para leer label=/caption=.
    const p = skipWs(text, from);
    if (text[p] === '[') {
      const g = readGroup(text, p, '[', ']');
      if (g) from = g.end;
    }
    const endTag = `\\end{${m[1]}}`;
    const e = text.indexOf(endTag, from);
    const to = e < 0 ? text.length : e;
    out += text.slice(last, from) + text.slice(from, to).replace(/[^\n]/g, ' ');
    last = to;
    re.lastIndex = to;
  }
  return out + text.slice(last);
}

interface Env {
  name: string;
  tipo: EtiquetaTipo | null;
  start: number;
  end: number;
}

function parseEnvs(text: string): Env[] {
  const envs: Env[] = [];
  const stack: Env[] = [];
  const re = /\\(begin|end)\{([A-Za-z*]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] === 'begin') {
      stack.push({ name: m[2], tipo: ENV_TIPO[m[2]] ?? null, start: m.index, end: text.length });
    } else {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === m[2]) {
          const [env] = stack.splice(k, 1);
          env.end = m.index + m[0].length;
          envs.push(env);
          break;
        }
      }
    }
  }
  envs.push(...stack);
  return envs;
}

/** Valor de `key=` en una lista de opciones tipo listings (`caption={…}, label=lst:x`). */
function optionValue(opts: string, key: string): string | null {
  const re = new RegExp(`(?:^|[,\\s\\[])${key}\\s*=\\s*`, 'g');
  const m = re.exec(opts);
  if (!m) return null;
  const i = m.index + m[0].length;
  if (opts[i] === '{') return readGroup(opts, i)?.content ?? null;
  return /^[^,\]]*/.exec(opts.slice(i))![0].trim();
}

interface Heading {
  tipo: EtiquetaTipo;
  title: string;
  start: number;
  end: number;
}

function parseHeadings(text: string, appendix: boolean, appendixAt: number): Heading[] {
  const out: Heading[] = [];
  const re = /\\(chapter|section|subsection|subsubsection|paragraph|part)\*?(?![A-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let p = skipWs(text, m.index + m[0].length);
    if (text[p] === '[') {
      const g = readGroup(text, p, '[', ']');
      if (g) p = skipWs(text, g.end);
    }
    const g = readGroup(text, p);
    if (!g) continue;
    const isApp = (appendix || (appendixAt >= 0 && m.index > appendixAt)) && m[1] === 'chapter';
    out.push({ tipo: isApp ? 'anexo' : HEADING_TIPO[m[1]], title: cleanTex(g.content), start: m.index, end: g.end });
    re.lastIndex = g.end;
  }
  return out;
}

export interface TexAnalysis {
  etiquetas: Etiqueta[];
  acronimos: Acronimo[];
  /** Archivos incluidos después de `\appendix` (resueltos por el llamador). */
  appendixIncludes: string[];
}

export function analyzeTex(raw: string, archivo: string, opts: { appendix?: boolean } = {}): TexAnalysis {
  const text = blankVerbatim(stripComments(raw));
  const starts = lineIndex(text);
  const etiquetas: Etiqueta[] = [];
  const acronimos: Acronimo[] = [];

  const appendixMatch = /\\appendix(?![A-Za-z])/.exec(text);
  const appendixAt = appendixMatch ? appendixMatch.index : -1;
  const appendixIncludes: string[] = [];
  if (appendixAt >= 0) {
    const re = /\\(?:include|input)\s*\{([^{}]+)\}/g;
    re.lastIndex = appendixAt;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) appendixIncludes.push(m[1].trim());
  }

  const envs = parseEnvs(text);
  const headings = parseHeadings(text, !!opts.appendix, appendixAt);

  // \caption{…} → entorno flotante más interno que lo contiene.
  const captionOf = new Map<Env, string>();
  const innermost = (pos: number): Env | null => {
    let best: Env | null = null;
    for (const e of envs) {
      if (!e.tipo || pos < e.start || pos >= e.end) continue;
      if (!best || e.start > best.start) best = e;
    }
    return best;
  };
  {
    const re = /\\caption\*?(?![A-Za-z])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      let p = skipWs(text, m.index + m[0].length);
      if (text[p] === '[') {
        const g = readGroup(text, p, '[', ']');
        if (g) p = skipWs(text, g.end);
      }
      const g = readGroup(text, p);
      if (!g) continue;
      const env = innermost(m.index);
      if (env && !captionOf.has(env)) captionOf.set(env, cleanTex(g.content));
    }
  }

  const headingFor = (pos: number): Heading | null => {
    for (let k = headings.length - 1; k >= 0; k--) {
      const h = headings[k];
      if (h.start > pos) continue;
      if (pos <= h.end) return h;
      // Etiqueta justo después del título: solo blancos (como mucho un salto de línea) entre medias.
      const gap = text.slice(h.end, pos);
      if (/^[ \t]*\n?[ \t]*$/.test(gap) || /^(?:[ \t]*\\label\{[^{}]*\})*[ \t]*\n?[ \t]*$/.test(gap)) return h;
      return null;
    }
    return null;
  };

  const re = /\\label\s*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const label = m[1].trim();
    if (!label) continue;
    const linea = lineAt(starts, m.index);
    const env = innermost(m.index);
    let tipo: EtiquetaTipo = 'otro';
    let texto = '';
    if (env) {
      tipo = env.tipo!;
      texto = captionOf.get(env) ?? '';
    } else {
      const h = headingFor(m.index);
      if (h) {
        tipo = h.tipo;
        texto = h.title;
      }
    }
    if (!texto && tipo === 'otro') {
      // Texto de la línea (sin la etiqueta) como contexto.
      const ln = text.slice(starts[linea - 1], starts[linea] ?? text.length).replace(/\\label\s*\{[^{}]*\}/g, '');
      texto = cleanTex(ln).slice(0, 80);
    }
    etiquetas.push({ label, tipo, texto, archivo, linea });
  }

  // lstlisting/minted con `label=` en las opciones; \lstinputlisting[…]{archivo}.
  {
    const lre = /\\begin\{(lstlisting|minted)\}|\\lstinputlisting/g;
    while ((m = lre.exec(text))) {
      const p = skipWs(text, m.index + m[0].length);
      if (text[p] !== '[') continue;
      const g = readGroup(text, p, '[', ']');
      if (!g) continue;
      const label = optionValue(g.content, 'label');
      if (!label) continue;
      const cap = optionValue(g.content, 'caption');
      etiquetas.push({ label, tipo: 'listado', texto: cap ? cleanTex(cap) : '', archivo, linea: lineAt(starts, m.index) });
    }
    etiquetas.sort((a, b) => a.linea - b.linea);
  }

  // \acro{SIGLA}{significado} y \acro{SIGLA}[corto]{significado}
  {
    const are = /\\acro(?![A-Za-z])/g;
    while ((m = are.exec(text))) {
      let p = skipWs(text, m.index + m[0].length);
      const a = readGroup(text, p);
      if (!a) continue;
      p = skipWs(text, a.end);
      if (text[p] === '[') {
        const o = readGroup(text, p, '[', ']');
        if (!o) continue;
        p = skipWs(text, o.end);
      }
      const b = readGroup(text, p);
      if (!b) continue;
      const sigla = cleanTex(a.content);
      if (sigla) acronimos.push({ sigla, significado: cleanTex(b.content), archivo, linea: lineAt(starts, m.index) });
      are.lastIndex = b.end;
    }
  }
  return { etiquetas, acronimos, appendixIncludes };
}

/** `.bib` referenciados por \bibliography{a,b} / \addbibresource[…]{x.bib} (sin resolver). */
export function bibReferences(raw: string): string[] {
  const text = stripComments(raw);
  const out: string[] = [];
  const re = /\\(bibliography|addbibresource|addglobalbib|addsectionbib)(?![A-Za-z])\s*(\[[^\]]*\])?\s*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const f of m[3].split(',')) {
      const t = f.trim();
      if (t) out.push(m[1] === 'bibliography' && !/\.bib$/i.test(t) ? `${t}.bib` : t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

export async function buildRefs(cfg: Config): Promise<Refs> {
  const files = await walkFiles(cfg, 'memoria');
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const tex = files
    .filter((f) => /\.tex$/i.test(f.rel))
    .sort((a, b) => (a.rel === cfg.memoriaMain ? -1 : b.rel === cfg.memoriaMain ? 1 : a.rel.localeCompare(b.rel)));
  const read = (abs: string) => fs.readFile(abs, 'utf8').catch(() => null);

  const texts = new Map<string, string>();
  for (const f of tex) {
    const t = await read(f.abs);
    if (t !== null) texts.set(f.rel, t);
  }

  // Archivos de anexos: los incluidos tras \appendix.
  const appendixFiles = new Set<string>();
  const parsed = new Map<string, TexAnalysis>();
  const bibRefs: string[] = [];
  for (const [rel, t] of texts) {
    bibRefs.push(...bibReferences(t));
    const a = analyzeTex(t, rel);
    parsed.set(rel, a);
    for (const inc of a.appendixIncludes) {
      for (const c of [inc, `${inc}.tex`]) if (byRel.has(c)) appendixFiles.add(c);
    }
  }
  const etiquetas: Etiqueta[] = [];
  const acronimos: Acronimo[] = [];
  for (const [rel, t] of texts) {
    const a = appendixFiles.has(rel) ? analyzeTex(t, rel, { appendix: true }) : parsed.get(rel)!;
    etiquetas.push(...a.etiquetas);
    acronimos.push(...a.acronimos);
  }

  // .bib: los referenciados que existan; si no, todos.
  const allBibs = files.filter((f) => /\.bib$/i.test(f.rel)).sort((a, b) => a.rel.localeCompare(b.rel));
  const chosen: typeof allBibs = [];
  for (const r of bibRefs) {
    const rel = r.replace(/^\.\//, '');
    const f = byRel.get(rel) ?? byRel.get(`${rel}.bib`);
    if (f && !chosen.includes(f)) chosen.push(f);
  }
  const bibs = chosen.length ? chosen : allBibs;
  const citas: Cita[] = [];
  const seen = new Set<string>();
  for (const f of bibs) {
    const t = await read(f.abs);
    if (t === null) continue;
    for (const c of citasFromBib(t, f.rel)) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      citas.push(c);
    }
  }
  return { citas, etiquetas, acronimos };
}

/** Caché de las referencias, invalidada con los cambios de la memoria. */
export class RefsService {
  private cache: Promise<Refs> | null = null;

  private onChange = (e: ChangeEvent) => {
    if (e.root === 'memoria') this.invalidate();
  };
  private onOther = () => this.invalidate();

  constructor(
    private cfg: Config,
    bus: EventBus,
  ) {
    bus.on('change', this.onChange);
    bus.on('settings', this.onOther);
  }

  invalidate(): void {
    this.cache = null;
  }

  get(): Promise<Refs> {
    if (!this.cache) {
      const p = buildRefs(this.cfg);
      this.cache = p;
      p.catch(() => {
        if (this.cache === p) this.cache = null;
      });
    }
    return this.cache;
  }
}
