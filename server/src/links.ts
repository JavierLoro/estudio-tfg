import { attachmentCandidates } from './attachments.ts';
import path from 'node:path';
import YAML from 'yaml';
import { splitFrontmatter } from './frontmatter.ts';
import { cleanTarget, makeResolver, nameKey, type Resolver } from './notes.ts';

/**
 * Mantener enlaces al mover (contrato v0.7). Funciones puras: reciben el contenido
 * de un archivo, su ruta antes y después de mover y el mapa de archivos movidos,
 * y devuelven el contenido con solo los destinos de enlace cambiados.
 */

interface Edit {
  start: number;
  end: number;
  text: string;
}

type Range = [number, number];

function applyEdits(src: string, edits: Edit[]): string {
  if (!edits.length) return src;
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const e of edits) {
    if (e.start < pos) continue; // solapado: se ignora
    out += src.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + src.slice(pos);
}

function inRanges(ranges: Range[], i: number): boolean {
  for (const [a, b] of ranges) if (i >= a && i < b) return true;
  return false;
}

const posixDir = (p: string) => {
  const d = path.posix.dirname(p);
  return d === '.' ? '' : d;
};
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Contexto común de una operación de mover. */
export interface MoveMap {
  resourcesSubdir?: string;
  /** Ruta anterior → ruta nueva de cada archivo movido. */
  map: Map<string, string>;
  /** Archivos de la raíz antes de mover. */
  preFiles: string[];
  /** Archivos de la raíz después de mover. */
  postFiles: string[];
}

// ───────────────────────────── Markdown (notas) ─────────────────────────────

/** Rangos de código en Markdown: bloques ``` / ~~~ y código en línea `…`. */
export function markdownCodeRanges(src: string): Range[] {
  const fences: Range[] = [];
  let fence: { ch: string; len: number; start: number } | null = null;
  let pos = 0;
  while (pos < src.length) {
    const nl = src.indexOf('\n', pos);
    const lineEnd = nl < 0 ? src.length : nl + 1;
    const line = src.slice(pos, nl < 0 ? src.length : nl).replace(/\r$/, '');
    if (!fence) {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (m && (m[1][0] !== '`' || !line.slice(m[0].length).includes('`'))) fence = { ch: m[1][0], len: m[1].length, start: pos };
    } else {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len) {
        fences.push([fence.start, lineEnd]);
        fence = null;
      }
    }
    pos = lineEnd;
  }
  if (fence) fences.push([fence.start, src.length]);

  // Código en línea en los huecos entre bloques (sin cruzar una línea en blanco).
  const out: Range[] = [...fences];
  let gapStart = 0;
  for (const gap of [...fences, [src.length, src.length] as Range]) {
    const text = src.slice(gapStart, gap[0]);
    const runs = [...text.matchAll(/`+/g)].map((m) => ({ i: m.index! + gapStart, n: m[0].length }));
    for (let i = 0; i < runs.length; i++) {
      const open = runs[i];
      for (let j = i + 1; j < runs.length; j++) {
        if (/\n[ \t]*\r?\n/.test(src.slice(open.i + open.n, runs[j].i))) break;
        if (runs[j].n === open.n) {
          out.push([open.i, runs[j].i + runs[j].n]);
          i = j;
          break;
        }
      }
    }
    gapStart = gap[1];
  }
  return out;
}

export interface NoteLinkCtx extends MoveMap {
  pre: Resolver;
  post: Resolver;
  preSet: Set<string>;
  prePaths: Map<string, string>;
  postSet: Set<string>;
  /** Nombre de archivo (minúsculas) → cuántos hay después de mover. */
  baseCount: Map<string, number>;
  /** Nombres (minúsculas) de los archivos movidos, antes y después. */
  names: Set<string>;
}

export function noteLinkCtx(m: MoveMap): NoteLinkCtx {
  const baseCount = new Map<string, number>();
  for (const f of m.postFiles) {
    const b = nameKey(baseName(f));
    baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
  }
  const names = new Set<string>();
  for (const [a, b] of m.map) {
    names.add(nameKey(baseName(a)));
    names.add(nameKey(baseName(b)));
  }
  return {
    ...m,
    pre: makeResolver(m.preFiles),
    post: makeResolver(m.postFiles),
    preSet: new Set(m.preFiles),
    prePaths: new Map(m.preFiles.map((p) => [p.normalize('NFC'), p])),
    postSet: new Set(m.postFiles),
    baseCount,
    names,
  };
}

/** Si un destino puede cambiar de significado (su nombre coincide con el de un archivo movido). */
function mayChange(dest: string, c: NoteLinkCtx): boolean {
  const b = nameKey(baseName(cleanTarget(dest)));
  return c.names.has(b) || c.names.has(`${b}.md`);
}

const stripMd = (p: string) => p.replace(/\.md$/i, '');

/** Primer candidato que, desde la nota en su ruta nueva, resuelve al destino. */
function firstResolving(cands: (string | null)[], target: string, newPath: string, c: NoteLinkCtx): string | null {
  for (const cand of cands) if (cand && c.post(cand, newPath) === target) return cand;
  return null;
}

/** Nombre solo si es único tras mover. */
function bareName(target: string, keepMd: boolean, c: NoteLinkCtx): string | null {
  const b = baseName(target);
  if ((c.baseCount.get(nameKey(b)) ?? 0) > 1) return null;
  return keepMd ? b : stripMd(b);
}

/** Nuevo destino de un wikilink (null = no cambia). */
function relinkWiki(dest: string, oldPath: string, newPath: string, c: NoteLinkCtx): string | null {
  const old = c.pre(dest, oldPath);
  if (!old) return null;
  const target = c.map.get(old) ?? old;
  if (c.post(dest, newPath) === target) return null;
  const keepMd = /\.md$/i.test(dest) || !/\.md$/i.test(target);
  const full = keepMd ? target : stripMd(target);
  const cands = cleanTarget(dest).includes('/') ? [full] : [bareName(target, keepMd, c), full];
  return firstResolving(cands, target, newPath, c);
}

function tryDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Codifica una ruta para un enlace Markdown como estaba la original. */
function encodeLike(p: string, raw: string): string {
  if (/%[89a-f][0-9a-f]/i.test(raw)) return p.split('/').map(encodeURIComponent).join('/');
  return p.replace(/[% ()#<>\t]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/**
 * Nuevo destino (ruta decodificada) de un enlace Markdown relativo (null = no cambia).
 * Formas: desde la raíz (`Carpeta/Nota.md`), relativa a la nota (`../Otra.md`,
 * `./img.png`; en la raíz se toma como relativa) o solo el nombre (si no es
 * ninguna de las anteriores y se resolvió por nombre).
 */
function relinkMd(decoded: string, oldPath: string, newPath: string, c: NoteLinkCtx): string | null {
  const old = c.pre(decoded, oldPath);
  if (!old) return null;
  const target = c.map.get(old) ?? old;
  const dotSlash = decoded.startsWith('./');
  const s = decoded.replace(/^(\.\/)+/, '');
  const oldDir = posixDir(oldPath);
  const newDir = posixDir(newPath);
  const same = (p: string, f: string) => p.normalize('NFC') === f.normalize('NFC') || `${p}.md`.normalize('NFC') === f.normalize('NFC');
  const isRel = same(path.posix.normalize(oldDir ? `${oldDir}/${s}` : s), old) && (oldDir === '' || s !== old || dotSlash);
  const isAbs = !isRel && same(s, old);
  // ¿Sigue apuntando al mismo archivo con la misma forma?
  if (isRel ? same(path.posix.normalize(newDir ? `${newDir}/${s}` : s), target) : isAbs ? same(s, target) : c.post(decoded, newPath) === target) return null;
  const keepMd = /\.md$/i.test(s) || !/\.md$/i.test(target);
  const fmt = (p: string) => (keepMd ? p : stripMd(p));
  const absolute = fmt(target);
  let relative = fmt(path.posix.relative(newDir || '.', target));
  if (dotSlash && !relative.startsWith('../')) relative = `./${relative}`;
  const cands = isRel ? [relative, absolute] : isAbs ? [absolute, relative] : [bareName(target, keepMd, c), absolute, relative];
  return firstResolving(cands, target, newPath, c);
}

/** Valor nuevo del campo `attachment:` (relativo a la carpeta de la nota, o desde la raíz). */
function relinkAttachment(val: string, oldPath: string, newPath: string, c: NoteLinkCtx): string | null {
  if (!val || val.includes('[[') || /^[a-z][a-z0-9+.-]*:/i.test(val) || val.startsWith('/')) return null;
  const candidates = attachmentCandidates(oldPath, val, c.resourcesSubdir);
  const candidate = candidates.find((p) => c.preSet.has(p.path) || c.prePaths.has(p.path.normalize('NFC')));
  if (!candidate) return null;
  const old = c.prePaths.get(candidate.path.normalize('NFC')) ?? candidate.path;
  const relForm = candidate.form !== 'vault';
  const target = c.map.get(old) ?? old;
  const next = relForm ? path.posix.relative(posixDir(newPath) || '.', target) : target;
  return next === val ? null : next;
}

function attachmentEdit(src: string, oldPath: string, newPath: string, c: NoteLinkCtx): Edit | null {
  const s = splitFrontmatter(src);
  if (s.yaml === null) return null;
  const m = /^attachment[ \t]*:[ \t]*(\S[^\r\n]*)$/m.exec(s.yaml);
  if (!m) return null;
  const rest = m[1];
  let token: string;
  if (rest[0] === '"') token = /^"(?:[^"\\]|\\.)*"/.exec(rest)?.[0] ?? '';
  else if (rest[0] === "'") token = /^'(?:[^']|'')*'/.exec(rest)?.[0] ?? '';
  else token = rest.replace(/\s+#.*$/, '').trimEnd();
  if (!token) return null;
  let val: unknown;
  try {
    val = YAML.parse(token);
  } catch {
    return null;
  }
  if (typeof val !== 'string') return null;
  const next = relinkAttachment(val, oldPath, newPath, c);
  if (next === null) return null;
  let text: string;
  if (token[0] === "'") text = `'${next.replace(/'/g, "''")}'`;
  else if (token[0] === '"' || /[:#]|^[-?[\]{},&*!|>'"%@`\s]|\s$/.test(next)) text = JSON.stringify(next);
  else text = next;
  const start = s.open.length + m.index + m[0].length - m[1].length;
  return { start, end: start + token.length, text };
}

const WIKI_RE = /!?\[\[([^[\]\n]+?)\]\]/g;
const MD_RE = /!?\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\([ \t]*(<[^<>\n]*>|[^\s()<>]+)(?=[ \t]*(?:"[^"\n]*"|'[^'\n]*')?[ \t]*\))/g;

/** Reescribe los enlaces de una nota (antes en `oldPath`, ahora en `newPath`). */
export function rewriteNote(src: string, oldPath: string, newPath: string, c: NoteLinkCtx): string {
  const moved = oldPath !== newPath;
  if (!moved && !src.includes('[[') && !src.includes('](') && !src.includes('attachment')) return src;
  const code = markdownCodeRanges(src);
  const edits: Edit[] = [];

  for (const m of src.matchAll(WIKI_RE)) {
    if (inRanges(code, m.index!)) continue;
    const inner = m[1];
    const innerStart = m.index! + m[0].indexOf('[[') + 2;
    let cut = inner.search(/[|#^]/);
    if (cut < 0) cut = inner.length;
    let destPart = inner.slice(0, cut);
    if (destPart.endsWith('\\') && inner[cut] === '|') destPart = destPart.slice(0, -1); // \| en tablas
    const lead = destPart.length - destPart.trimStart().length;
    const dest = destPart.trim();
    if (!dest || (!moved && !mayChange(dest, c))) continue;
    const next = relinkWiki(dest, oldPath, newPath, c);
    if (next !== null && next !== dest) edits.push({ start: innerStart + lead, end: innerStart + lead + dest.length, text: next });
  }

  for (const m of src.matchAll(MD_RE)) {
    if (inRanges(code, m.index!)) continue;
    const raw = m[2];
    const rawStart = m.index! + m[0].length - raw.length;
    const angle = raw.startsWith('<');
    const inner = angle ? raw.slice(1, -1) : raw;
    if (!inner || /^[a-z][a-z0-9+.-]*:/i.test(inner) || inner.startsWith('#') || inner.startsWith('/')) continue;
    const hash = inner.indexOf('#');
    const pathRaw = hash < 0 ? inner : inner.slice(0, hash);
    const decoded = tryDecode(pathRaw);
    if (!decoded || (!moved && !mayChange(decoded, c))) continue;
    const next = relinkMd(decoded, oldPath, newPath, c);
    if (next === null || next === decoded) continue;
    const enc = angle ? next : encodeLike(next, pathRaw);
    const off = rawStart + (angle ? 1 : 0);
    edits.push({ start: off, end: off + pathRaw.length, text: enc });
  }

  const att = attachmentEdit(src, oldPath, newPath, c);
  if (att) edits.push(att);
  return applyEdits(src, edits);
}

// ───────────────────────────── LaTeX (memoria) ─────────────────────────────

/** Carpetas de \graphicspath de la plantilla (si la memoria no declara otras). */
export const DEFAULT_GRAPHICSPATH = ['figuras/', 'estilo/'];
const GRAPHIC_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.mps', '.jbig2', '.jb2', '.eps', '.PDF', '.PNG', '.JPG', '.JPEG', '.EPS'];
const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'Verbatim*', 'lstlisting', 'minted', 'comment'];

/** Rangos que no son código LaTeX: comentarios `%`, entornos verbatim, \verb y \lstinline. */
export function latexSkipRanges(src: string): Range[] {
  const out: Range[] = [];
  const re = /\\\\|\\%|%|\\begin[ \t]*\{([A-Za-z]+\*?)\}|\\(?:verb\*?|lstinline)(?![A-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tok = m[0];
    if (tok === '\\\\' || tok === '\\%') continue;
    let end: number;
    if (tok === '%') {
      const nl = src.indexOf('\n', m.index);
      end = nl < 0 ? src.length : nl;
    } else if (tok.startsWith('\\begin')) {
      if (!VERBATIM_ENVS.includes(m[1])) continue;
      const endTag = `\\end{${m[1]}}`;
      const e = src.indexOf(endTag, re.lastIndex);
      end = e < 0 ? src.length : e + endTag.length;
    } else {
      let i = re.lastIndex;
      if (src[i] === '[') {
        const c = src.indexOf(']', i);
        if (c < 0) continue;
        i = c + 1;
      }
      const open = src[i];
      if (!open || /\s/.test(open)) continue;
      const close = open === '{' ? '}' : open;
      const e = src.indexOf(close, i + 1);
      const nl = src.indexOf('\n', i + 1);
      if (e < 0 || (nl >= 0 && nl < e)) continue;
      end = e + 1;
    }
    out.push([m.index, end]);
    re.lastIndex = end;
  }
  return out;
}

/** Carpetas de \graphicspath declaradas en los fuentes (con `/` final). */
export function parseGraphicspath(src: string): string[] {
  const skip = latexSkipRanges(src);
  const out: string[] = [];
  for (const m of src.matchAll(/\\graphicspath[ \t]*\{((?:[ \t\r\n]*\{[^{}]*\})*)[ \t\r\n]*\}/g)) {
    if (inRanges(skip, m.index!)) continue;
    for (const d of m[1].matchAll(/\{([^{}]*)\}/g)) {
      let dir = d[1].trim().replace(/^(\.\/)+/, '');
      if (!dir || dir.startsWith('/') || dir.includes('\\')) continue;
      if (!dir.endsWith('/')) dir += '/';
      if (!out.includes(dir)) out.push(dir);
    }
  }
  return out;
}

type TexCmd = 'input' | 'include' | 'includegraphics' | 'bibliography' | 'addbibresource';

export interface TexLinkCtx extends MoveMap {
  preSet: Set<string>;
  postSet: Set<string>;
  graphicspath: string[];
}

export function texLinkCtx(m: MoveMap, graphicspath: string[]): TexLinkCtx {
  return { ...m, preSet: new Set(m.preFiles), postSet: new Set(m.postFiles), graphicspath };
}

const norm = (p: string) => path.posix.normalize(p).replace(/^(\.\/)+/, '');

/** Extensión que el comando añade o acepta (para conservar «con o sin extensión»). */
function texHasExt(cmd: TexCmd, t: string): boolean {
  if (cmd === 'input') return t.toLowerCase().endsWith('.tex');
  if (cmd === 'include') return false;
  if (cmd === 'includegraphics') return GRAPHIC_EXTS.includes(path.posix.extname(t));
  if (cmd === 'bibliography') return t.toLowerCase().endsWith('.bib');
  return true;
}

/** Archivo al que apunta el argumento (como lo buscaría LaTeX) y la carpeta de \graphicspath usada. */
function resolveTex(cmd: TexCmd, t: string, set: Set<string>, gp: string[]): { file: string; prefix: string } | null {
  const prefixes = cmd === 'includegraphics' ? ['', ...gp] : [''];
  for (const prefix of prefixes) {
    const base = prefix + t;
    let cands: string[];
    if (cmd === 'input') cands = texHasExt(cmd, t) ? [base] : [`${base}.tex`, base];
    else if (cmd === 'include') cands = [`${base}.tex`];
    else if (cmd === 'includegraphics') cands = texHasExt(cmd, t) ? [base] : GRAPHIC_EXTS.map((e) => base + e);
    else if (cmd === 'bibliography') cands = texHasExt(cmd, t) ? [base] : [`${base}.bib`, base];
    else cands = [base];
    for (const cand of cands) {
      const n = norm(cand);
      if (set.has(n)) return { file: n, prefix };
    }
  }
  return null;
}

function relinkTex(cmd: TexCmd, t: string, c: TexLinkCtx): string | null {
  const old = resolveTex(cmd, t, c.preSet, c.graphicspath);
  if (!old) return null;
  const target = c.map.get(old.file) ?? old.file;
  if (resolveTex(cmd, t, c.postSet, c.graphicspath)?.file === target) return null;
  const ext = path.posix.extname(target);
  const noExt = cmd === 'include' || (!texHasExt(cmd, t) && ext !== '' && (cmd !== 'input' || ext.toLowerCase() === '.tex'));
  const fmt = (p: string) => (noExt ? p.slice(0, p.length - ext.length) : p);
  const cands: string[] = [];
  if (old.prefix) {
    const prefixes = [old.prefix, ...c.graphicspath.filter((p) => p !== old.prefix)];
    for (const p of prefixes) if (target.startsWith(p)) cands.push(fmt(target.slice(p.length)));
  }
  cands.push(fmt(target));
  if (noExt && cmd !== 'include') cands.push(target);
  for (const cand of cands) if (resolveTex(cmd, cand, c.postSet, c.graphicspath)?.file === target) return cand;
  return null;
}

const TEX_RE = /\\(input|include|includegraphics\*?|bibliography|addbibresource)(?![A-Za-z])((?:[ \t]*\[[^\]\n]*\])*)[ \t]*\{([^{}\n]*)\}/g;

/** Reescribe \input, \include, \includegraphics, \bibliography y \addbibresource. */
export function rewriteTex(src: string, c: TexLinkCtx): string {
  if (!/\\(input|include|bibliography|addbibresource)/.test(src)) return src;
  const skip = latexSkipRanges(src);
  const edits: Edit[] = [];
  for (const m of src.matchAll(TEX_RE)) {
    if (inRanges(skip, m.index!)) continue;
    const cmd = m[1].replace(/\*$/, '') as TexCmd;
    const arg = m[3];
    const argStart = m.index! + m[0].length - 1 - arg.length;
    const items = cmd === 'bibliography' ? arg.split(',') : [arg];
    let off = argStart;
    for (const item of items) {
      const lead = item.length - item.trimStart().length;
      const t = item.trim();
      if (t && !/[\\#$]/.test(t)) {
        const next = relinkTex(cmd, t, c);
        if (next !== null && next !== t) edits.push({ start: off + lead, end: off + lead + t.length, text: next });
      }
      off += item.length + 1;
    }
  }
  return applyEdits(src, edits);
}
