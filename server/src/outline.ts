import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import type { CompileResult, Compiler } from './compile.ts';
import type { ChangeEvent, EventBus } from './events.ts';
import { HttpError } from './errors.ts';
import { normalizeRel, resolveSafe } from './paths.ts';

// Vista Documento: outline of the memoria built by following MEMORIA_MAIN through
// \input/\include. Approximate by design (regex scanner, no TeX expansion).

export type OutlineKind = 'datos' | 'frontmatter' | 'chapter' | 'section' | 'subsection' | 'bibliography' | 'appendix';

export interface OutlineItem {
  id: string;
  kind: OutlineKind;
  title: string;
  number: string | null;
  file: string;
  line: number;
  enabled: boolean;
  words: number;
  warnings: string[];
  children: OutlineItem[];
  /** Only for kind "bibliography": entries in the referenced .bib files. */
  entries?: number;
}

export interface Outline {
  main: string;
  items: OutlineItem[];
  words: number;
  generatedAt: string;
  /** Structural problems: missing files, include cycles… */
  warnings: string[];
}

export interface OutlineRef {
  id: string;
  number: string | null;
  title: string;
}

export interface BuiltOutline {
  outline: Outline;
  /** file → item id owning each line (index = line - 1). */
  owners: Map<string, (string | null)[]>;
  byId: Map<string, OutlineItem>;
  /** Items in document order (depth first), including disabled ones. */
  flat: OutlineItem[];
}

export const EMPTY_WARNING = 'vacío';
export const TODO_WARNING = 'TODO';
export const ERRORS_WARNING = 'errores';
export const MISSING_WARNING = 'no encontrado';
const EMPTY_MIN_WORDS = 30;

// ---------------------------------------------------------------------------
// Text helpers

/** Remove a TeX comment (unescaped % to end of line). */
export function stripComment(line: string): string {
  const m = /(^|[^\\])((?:\\\\)*)%/.exec(line);
  return m ? line.slice(0, m.index + m[1].length + m[2].length) : line;
}

/** A fully commented include line: `% \include{x}`, `%\input{x.tex}`, `% {\small \input{x}}`. */
const DISABLED_INCLUDE_RE = /^\s*%+\s*(?:\{\s*(?:\\[a-zA-Z]+\s*)*)?\\(input|include)\s*\{([^{}]+)\}/;

const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'BVerbatim', 'lstlisting', 'minted', 'comment', 'alltt']);
const EXCLUDED_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*',
  'flalign', 'flalign*', 'alignat', 'alignat*', 'displaymath', 'math', 'figure', 'figure*', 'table', 'table*',
  'wrapfigure', 'subfigure', 'sidewaysfigure', 'sidewaystable', 'tikzpicture', 'tabular', 'tabular*', 'tabularx',
  'longtable', 'algorithm', 'algorithmic', 'algorithm2e', 'listing', 'thebibliography',
]);

const NONPROSE_CMD_RE =
  /\\(?:label|ref|eqref|autoref|[cC]ref|pageref|nameref|vref|cite[a-zA-Z]*|nocite|includegraphics|input|include|url|bibliography[a-zA-Z]*|addbibresource|usepackage|RequirePackage|documentclass|chapter|section|subsection|subsubsection|paragraph|part|begin|end|[hv]space|setlength|setcounter|addtocounter|newcommand|renewcommand|providecommand|newenvironment|acrodef|newacronym|todo|lstinputlisting|includepdf|hypersetup|printbibliography|graphicspath|pagestyle|thispagestyle|markboth|addcontentsline|newpage|clearpage|cleardoublepage|drop)\*?(?:\s*\[[^\]]*\])*(?:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*/g;

const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

/** Approximate prose words of a comment-free fragment. */
export function proseWords(s: string): number {
  const t = s
    .replace(/\\verb\*?(.).*?\1/g, ' ')
    .replace(/\$\$.*?\$\$|\$(?:\\.|[^$\\])*\$|\\\(.*?\\\)|\\\[.*?\\\]/g, ' ')
    .replace(NONPROSE_CMD_RE, ' ')
    .replace(/\\href\s*\{[^{}]*\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?(?:\s*\[[^\]]*\])?/g, ' ')
    .replace(/\\./g, ' ');
  return t.match(WORD_RE)?.length ?? 0;
}

/** Words per line (comment-free lines), skipping verbatim/math/float bodies except captions. */
export function wordsPerLine(stripped: string[]): number[] {
  let verb: string | null = null;
  let excluded = 0;
  let capDepth = 0;

  const captionText = (chunk: string): string => {
    let out = '';
    let i = 0;
    while (i < chunk.length) {
      if (capDepth > 0) {
        const ch = chunk[i];
        if (ch === '\\') {
          out += chunk.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (ch === '{') capDepth++;
        else if (ch === '}' && --capDepth === 0) {
          out += ' ';
          i++;
          continue;
        }
        out += ch;
        i++;
        continue;
      }
      const re = /\\caption\*?\s*(?:\[[^\]]*\])?\s*\{/g;
      re.lastIndex = i;
      const m = re.exec(chunk);
      if (!m) break;
      i = m.index + m[0].length;
      capDepth = 1;
    }
    return out;
  };
  const count = (chunk: string) => (excluded > 0 ? proseWords(captionText(chunk)) : proseWords(chunk));

  return stripped.map((line0) => {
    let line = line0;
    if (verb) {
      const end = line.indexOf(`\\end{${verb}}`);
      if (end < 0) return 0;
      line = line.slice(end + verb.length + 6);
      verb = null;
    }
    let n = 0;
    let pos = 0;
    const re = /\\(begin|end)\s*\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      n += count(line.slice(pos, m.index));
      pos = m.index + m[0].length;
      const env = m[2].trim();
      if (m[1] === 'begin') {
        if (VERBATIM_ENVS.has(env)) {
          const end = line.indexOf(`\\end{${env}}`, pos);
          if (end < 0) {
            verb = env;
            return n;
          }
          pos = end + env.length + 6;
          re.lastIndex = pos;
        } else if (EXCLUDED_ENVS.has(env)) excluded++;
      } else if (EXCLUDED_ENVS.has(env) && excluded > 0) {
        excluded--;
        if (excluded === 0) capDepth = 0;
      }
    }
    n += count(line.slice(pos));
    return n;
  });
}

/** Display title: strip simple formatting commands, labels, footnotes. */
export function cleanTitle(s: string): string {
  let t = s
    .replace(/\\(?:label|footnote|index|protect|nocite|cite[a-zA-Z]*)\*?\s*(?:\[[^\]]*\])?\s*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})?/g, '')
    .replace(/\\LaTeXe\b/g, 'LaTeX2e')
    .replace(/\\LaTeX\b/g, 'LaTeX')
    .replace(/\\TeX\b/g, 'TeX')
    .replace(/\\\\/g, ' ')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/\\textasciitilde\b(\{\})?/g, '~')
    .replace(/~/g, ' ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``|''/g, '"')
    .replace(/\\[a-zA-Z@]+\*?\s*(?:\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

export function humanize(file: string): string {
  const base = path.posix.basename(file).replace(/\.tex$/i, '');
  const t = base.replace(/^(?:\d+|[a-zA-Z])[-_](?=.)/, '').replace(/[-_]+/g, ' ').trim() || base;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function slugify(s: string, fallback = 'apartado', max = 40): string {
  const slug = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || fallback;
}

export const letterFor = (n: number): string => {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

/** Read `[opt]{arg}` starting at pos (skipping whitespace). */
function readArgs(text: string, pos: number): { opt?: string; arg?: string; end: number } {
  const LIMIT = 4000;
  let i = pos;
  const skipWs = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const matchGroup = (open: string, close: string): string | undefined => {
    if (text[i] !== open) return undefined;
    let depth = 0;
    let braces = 0;
    const start = i + 1;
    for (let j = i; j < text.length && j - i < LIMIT; j++) {
      const c = text[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (open === '[') {
        // Braces protect ] inside [..].
        if (c === '{') braces++;
        else if (c === '}') braces--;
        else if (braces === 0 && c === '[') depth++;
        else if (braces === 0 && c === ']' && --depth === 0) {
          i = j + 1;
          return text.slice(start, j);
        }
      } else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        i = j + 1;
        return text.slice(start, j);
      }
    }
    return undefined;
  };
  skipWs();
  const save = i;
  const opt = matchGroup('[', ']');
  if (opt === undefined) i = save;
  skipWs();
  const save2 = i;
  const arg = matchGroup('{', '}');
  if (arg === undefined) i = save2;
  return { opt, arg, end: i };
}

type TokName =
  | 'input' | 'include' | 'frontmatter' | 'mainmatter' | 'appendix' | 'backmatter'
  | 'chapter' | 'section' | 'subsection' | 'bibliography' | 'printbibliography' | 'addbibresource' | 'begin';

interface Token {
  name: TokName;
  star: boolean;
  arg?: string;
  line: number; // 0-based
}

const CMD_RE = /\\(input|include|frontmatter|mainmatter|appendix|backmatter|chapter|section|subsection|bibliography|printbibliography|addbibresource|begin)(?![a-zA-Z@])(\*?)/g;
const NEEDS_ARG = new Set<TokName>(['input', 'include', 'chapter', 'section', 'subsection', 'bibliography', 'addbibresource', 'begin']);

function scanTokens(text: string): Map<number, Token[]> {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = (off: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const out = new Map<number, Token[]>();
  CMD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CMD_RE.exec(text))) {
    // Skip escaped backslash (\\input is a line break + "input").
    let bs = 0;
    for (let k = m.index - 1; k >= 0 && text[k] === '\\'; k--) bs++;
    if (bs % 2 === 1) continue;
    const name = m[1] as TokName;
    const tok: Token = { name, star: m[2] === '*', line: lineOf(m.index) };
    if (NEEDS_ARG.has(name)) {
      const a = readArgs(text, m.index + m[0].length);
      if (a.arg === undefined) continue;
      tok.arg = a.arg;
      CMD_RE.lastIndex = Math.max(CMD_RE.lastIndex, name === 'begin' ? m.index + m[0].length : a.end);
    }
    const list = out.get(tok.line) ?? [];
    list.push(tok);
    out.set(tok.line, list);
  }
  return out;
}

export const splitLines = (s: string) => s.split(/\r?\n/);

/** Count @entries (excluding @comment/@string/@preamble) of a .bib text. */
export function countBibEntries(s: string): number {
  return s.match(/^\s*@(?!comment\b|string\b|preamble\b)[a-zA-Z]+\s*[{(]/gim)?.length ?? 0;
}

const normFileKey = (f: string) => f.replace(/^\.\//, '').replace(/\.tex$/i, '');

// ---------------------------------------------------------------------------
// Builder

interface FileData {
  raw: string[];
  stripped: string[];
  words: number[];
  tokens: Map<number, Token[]>;
}

/** Las rutas del worker son POSIX, aunque el servidor se ejecute en Windows. */
export function workerDiagnosticRel(file: string, memoriaDir: string): string {
  let f = file.replace(/\\/g, '/');
  if (path.posix.isAbsolute(f)) f = path.posix.relative(memoriaDir.replace(/\\/g, '/'), f);
  return f.replace(/^(\.\/)+/, '');
}

export async function buildOutline(cfg: Config, last: CompileResult | null): Promise<BuiltOutline> {
  const main = normalizeRel(cfg.memoriaMain);
  const items: OutlineItem[] = [];
  const warnings: string[] = [];
  const owners = new Map<string, (string | null)[]>();
  const byId = new Map<string, OutlineItem>();
  const own = new Map<OutlineItem, number>();
  const idCount = new Map<string, number>();
  const fileCache = new Map<string, FileData | null>();

  async function readRel(rel: string): Promise<string | null> {
    try {
      const r = await resolveSafe(cfg, 'memoria', rel);
      if (!r.exists) return null;
      const st = await fs.stat(r.abs);
      if (!st.isFile()) return null;
      return await fs.readFile(r.abs, 'utf8');
    } catch (e) {
      if (e instanceof HttpError && e.statusCode === 409) throw e;
      return null;
    }
  }

  async function load(rel: string): Promise<FileData | null> {
    if (fileCache.has(rel)) return fileCache.get(rel)!;
    const content = await readRel(rel);
    let data: FileData | null = null;
    if (content !== null) {
      const raw = splitLines(content);
      const stripped = raw.map(stripComment);
      data = { raw, stripped, words: wordsPerLine(stripped), tokens: scanTokens(stripped.join('\n')) };
    }
    fileCache.set(rel, data);
    return data;
  }

  async function resolveTarget(target: string, cmd: 'input' | 'include'): Promise<string | null> {
    let t = target.trim().replace(/^["']|["']$/g, '');
    let rel: string;
    try {
      rel = normalizeRel(t);
    } catch {
      return null;
    }
    t = rel;
    const cands = /\.tex$/i.test(t) ? [t] : cmd === 'include' ? [`${t}.tex`] : [`${t}.tex`, t];
    for (const c of cands) if ((await load(c)) !== null) return c;
    return null;
  }

  const makeItem = (kind: OutlineKind, title: string, file: string, line: number, extra: Partial<OutlineItem> = {}): OutlineItem => {
    const base = `${kind}:${file}#${slugify(title, 'x')}`;
    const n = (idCount.get(base) ?? 0) + 1;
    idCount.set(base, n);
    const item: OutlineItem = {
      id: n === 1 ? base : `${base}~${n}`,
      kind,
      title,
      number: null,
      file,
      line,
      enabled: true,
      words: 0,
      warnings: [],
      children: [],
      ...extra,
    };
    byId.set(item.id, item);
    own.set(item, 0);
    return item;
  };
  const warn = (item: OutlineItem, w: string) => {
    if (!item.warnings.includes(w)) item.warnings.push(w);
  };

  // Document state
  let phase: 'pre' | 'front' | 'main' | 'back' = 'pre';
  let appendix = false;
  let inDocument = false;
  let ch = 0;
  let sec = 0;
  let sub = 0;
  let stack: { ch: OutlineItem | null; sec: OutlineItem | null; sub: OutlineItem | null } = { ch: null, sec: null, sub: null };
  let leaf: OutlineItem | null = null;
  let frontItem: OutlineItem | null = null;
  const bibResources: string[] = [];
  const current = () => stack.sub ?? stack.sec ?? stack.ch ?? leaf;
  const closeAll = () => {
    stack = { ch: null, sec: null, sub: null };
    leaf = null;
  };
  const numberedPhase = () => appendix || phase === 'pre' || phase === 'main';
  const isFrontFile = (rel: string) => phase === 'front' || (phase === 'pre' && /^0-[^/]*\//.test(rel));

  const firstHeading = (d: FileData): { level: 'chapter' | 'section'; title: string; line: number } | null => {
    for (let li = 0; li < d.raw.length; li++) {
      for (const t of d.tokens.get(li) ?? []) {
        if (t.name === 'chapter' || t.name === 'section') return { level: t.name, title: cleanTitle(t.arg ?? ''), line: li + 1 };
      }
    }
    return null;
  };

  async function bibItem(files: string[], rel: string, line: number) {
    closeAll();
    let entries = 0;
    for (const f0 of files) {
      const f = f0.trim();
      if (!f) continue;
      const c = (await readRel(/\.bib$/i.test(f) ? f : `${f}.bib`)) ?? (await readRel(f));
      if (c !== null) entries += countBibEntries(c);
    }
    const item = makeItem('bibliography', 'Bibliografía', rel, line, { entries });
    items.push(item);
    leaf = item;
  }

  async function disabledInclude(cmd: 'input' | 'include', target: string, rel: string, line: number) {
    const resolved = await resolveTarget(target, cmd);
    const shown = resolved ?? (() => {
      try {
        const t = normalizeRel(target.trim());
        return /\.tex$/i.test(t) ? t : `${t}.tex`;
      } catch {
        return target.trim();
      }
    })();
    const isDatos = normFileKey(path.posix.basename(shown)) === 'datos';
    if (!inDocument && !isDatos) return;
    const d = resolved ? await load(resolved) : null;
    const h = d ? firstHeading(d) : null;
    let kind: OutlineKind;
    if (isDatos) kind = 'datos';
    else if (h?.level === 'section') kind = 'section';
    else if (isFrontFile(shown) && !appendix) kind = 'frontmatter';
    else kind = appendix ? 'appendix' : 'chapter';
    const title = isDatos ? 'Datos del trabajo' : h?.title || humanize(shown);
    const item = makeItem(kind, title, shown, h?.line ?? 1, { enabled: false });
    if (d && !isDatos) item.words = d.words.reduce((a, b) => a + b, 0);
    if (kind === 'section' && stack.ch) stack.ch.children.push(item);
    else items.push(item);
  }

  async function includeFile(cmd: 'input' | 'include', target: string, rel: string, line: number, chain: string[]) {
    const resolved = await resolveTarget(target, cmd);
    if (!resolved) {
      warnings.push(`No existe «${target.trim()}» (\\${cmd} en ${rel}:${line})`);
      if (inDocument) {
        let shown = target.trim();
        try {
          shown = normalizeRel(shown);
        } catch {
          /* keep */
        }
        if (!/\.tex$/i.test(shown)) shown += '.tex';
        const kind: OutlineKind = appendix ? 'appendix' : isFrontFile(shown) ? 'frontmatter' : 'chapter';
        const item = makeItem(kind, humanize(shown), shown, 1, { warnings: [MISSING_WARNING] });
        closeAll();
        items.push(item);
      }
      return;
    }
    if (chain.includes(resolved)) {
      warnings.push(`Inclusión circular: ${[...chain, resolved].join(' → ')}`);
      return;
    }
    if (normFileKey(path.posix.basename(resolved)) === 'datos') {
      const item = makeItem('datos', 'Datos del trabajo', resolved, 1);
      items.push(item);
      const d = await load(resolved);
      if (d && !owners.has(resolved)) owners.set(resolved, d.raw.map(() => item.id));
      return;
    }
    if (inDocument && !appendix && isFrontFile(resolved) && !frontItem) {
      const d = await load(resolved);
      const h = d ? firstHeading(d) : null;
      closeAll();
      const item = makeItem('frontmatter', h?.level === 'chapter' && h.title ? h.title : humanize(resolved), resolved, h?.line ?? 1);
      items.push(item);
      stack.ch = item;
      frontItem = item;
      try {
        await visit(resolved, [...chain, resolved]);
      } finally {
        frontItem = null;
        closeAll();
      }
      return;
    }
    await visit(resolved, [...chain, resolved]);
  }

  function heading(tok: Token, rel: string, line: number) {
    const title = cleanTitle(tok.arg ?? '') || '(sin título)';
    if (tok.name === 'chapter') {
      if (frontItem) return; // the file item already carries its first chapter title
      let item: OutlineItem;
      if (phase === 'front' && !appendix) {
        item = makeItem('frontmatter', title, rel, line);
      } else {
        item = makeItem(appendix ? 'appendix' : 'chapter', title, rel, line);
        if (!tok.star && numberedPhase()) {
          ch++;
          sec = 0;
          item.number = appendix ? letterFor(ch) : String(ch);
        }
      }
      items.push(item);
      stack = { ch: item, sec: null, sub: null };
      leaf = null;
      return;
    }
    if (tok.name === 'section') {
      const parent = stack.ch;
      const item = makeItem('section', title, rel, line);
      if (!tok.star && parent?.number) {
        sec++;
        sub = 0;
        item.number = `${parent.number}.${sec}`;
      }
      (parent ? parent.children : items).push(item);
      stack.sec = item;
      stack.sub = null;
      return;
    }
    // subsection
    const parent = stack.sec ?? stack.ch;
    const item = makeItem('subsection', title, rel, line);
    if (!tok.star && stack.sec?.number) {
      sub++;
      item.number = `${stack.sec.number}.${sub}`;
    }
    (parent ? parent.children : items).push(item);
    stack.sub = item;
  }

  async function visit(rel: string, chain: string[]) {
    const d = await load(rel);
    if (!d) return;
    const record = !owners.has(rel);
    const own0 = record ? d.raw.map(() => null as string | null) : null;
    if (own0) owners.set(rel, own0);
    for (let li = 0; li < d.raw.length; li++) {
      const dm = DISABLED_INCLUDE_RE.exec(d.raw[li]);
      if (dm && d.stripped[li].trim() === '') await disabledInclude(dm[1] as 'input' | 'include', dm[2], rel, li + 1);
      for (const tok of d.tokens.get(li) ?? []) {
        switch (tok.name) {
          case 'begin':
            if (tok.arg?.trim() === 'document') inDocument = true;
            break;
          case 'input':
          case 'include':
            await includeFile(tok.name, tok.arg ?? '', rel, li + 1, chain);
            break;
          case 'frontmatter':
            phase = 'front';
            closeAll();
            break;
          case 'mainmatter':
            phase = 'main';
            closeAll();
            break;
          case 'backmatter':
            phase = 'back';
            closeAll();
            break;
          case 'appendix':
            appendix = true;
            ch = 0;
            closeAll();
            break;
          case 'chapter':
          case 'section':
          case 'subsection':
            if (inDocument) heading(tok, rel, li + 1);
            break;
          case 'bibliography':
            if (inDocument) await bibItem((tok.arg ?? '').split(','), rel, li + 1);
            break;
          case 'addbibresource':
            bibResources.push(tok.arg ?? '');
            break;
          case 'printbibliography':
            if (inDocument) await bibItem(bibResources, rel, li + 1);
            break;
        }
      }
      const cur = current();
      if (cur && cur.kind !== 'datos' && cur.kind !== 'bibliography') {
        own.set(cur, (own.get(cur) ?? 0) + d.words[li]);
        if (/\bTODO\b/.test(d.raw[li]) || /\\todo(?![a-zA-Z@])/.test(d.stripped[li])) warn(cur, TODO_WARNING);
      }
      if (own0) own0[li] = cur?.id ?? null;
    }
  }

  const mainData = await load(main);
  if (!mainData) {
    // Throws 409 not_configured above when the folder itself is missing.
    warnings.push(`No existe el archivo principal «${main}»`);
  } else {
    inDocument = !mainData.stripped.some((l) => /\\begin\s*\{document\}/.test(l));
    await visit(main, [main]);
  }

  // Roll up words (disabled items keep their own count but are not added to parents).
  const rollUp = (it: OutlineItem): number => {
    if (!it.enabled) return it.words;
    let w = own.get(it) ?? 0;
    for (const c of it.children) {
      const cw = rollUp(c);
      if (c.enabled) w += cw;
    }
    it.words = w;
    return w;
  };
  let total = 0;
  for (const it of items) {
    const w = rollUp(it);
    if (it.enabled) total += w;
  }

  const flat: OutlineItem[] = [];
  const walk = (list: OutlineItem[]) => {
    for (const it of list) {
      flat.push(it);
      walk(it.children);
    }
  };
  walk(items);

  for (const it of flat) {
    if (it.enabled && ['chapter', 'appendix', 'section', 'subsection'].includes(it.kind) && it.words < EMPTY_MIN_WORDS) warn(it, EMPTY_WARNING);
  }

  // Lines before a file's first heading (guidance comments…) belong to that heading.
  for (const [file, arr] of owners) {
    if (file === main) continue;
    const first = flat.find((it) => it.file === file && it.enabled);
    if (!first) continue;
    for (let li = 0; li < Math.min(first.line - 1, arr.length); li++) {
      const o = arr[li] ? byId.get(arr[li]!) : null;
      if (!o || o.file !== file) arr[li] = first.id;
    }
  }

  // Errors of the last compile.
  if (last) {
    const memAbs = cfg.memoriaDir;
    for (const dgn of last.diagnostics ?? []) {
      if (dgn.severity !== 'error' || !dgn.file) continue;
      const f = workerDiagnosticRel(dgn.file, memAbs);
      const key = owners.has(f) ? f : owners.has(`${f}.tex`) ? `${f}.tex` : null;
      if (!key) continue;
      let target: OutlineItem | undefined;
      if (dgn.line != null) {
        const id = owners.get(key)![dgn.line - 1];
        target = id ? byId.get(id) : undefined;
      } else if (key !== main) {
        target = flat.find((it) => it.file === key && it.enabled);
      }
      if (target) warn(target, ERRORS_WARNING);
    }
  }

  return {
    outline: { main, items, words: total, generatedAt: new Date().toISOString(), warnings },
    owners,
    byId,
    flat,
  };
}

/** Comparable key of an outline (without generatedAt). */
export function outlineKey(o: Outline): string {
  return JSON.stringify({ ...o, generatedAt: '' });
}

/** Cached outline, invalidated by the watcher (memoria), settings and compile results. */
export class OutlineService {
  private cache: Promise<BuiltOutline> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastKey: string | null = null;
  private closed = false;
  static DEBOUNCE_MS = 300;

  private onChange = (e: ChangeEvent) => {
    if (e.root === 'memoria') this.changed();
  };
  private onOther = () => this.changed();

  constructor(
    private cfg: Config,
    private compiler: Compiler,
    private bus: EventBus,
  ) {
    bus.on('change', this.onChange);
    bus.on('settings', this.onOther);
    bus.on('compile', this.onOther);
  }

  invalidate(): void {
    this.cache = null;
  }

  /** Invalidate and emit `outline` (debounced) if it differs from the last one seen. */
  changed(): void {
    this.invalidate();
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), OutlineService.DEBOUNCE_MS);
    this.timer.unref?.();
  }

  private async flush(): Promise<void> {
    this.timer = null;
    try {
      const b = await this.built();
      const key = outlineKey(b.outline);
      if (key !== this.lastKey && !this.closed) {
        this.lastKey = key;
        this.bus.emit('outline', b.outline);
      }
    } catch {
      /* memoria not configured: nothing to emit */
    }
  }

  built(): Promise<BuiltOutline> {
    if (!this.cache) {
      const p = this.compiler.last().then((last) => buildOutline(this.cfg, last));
      this.cache = p;
      p.catch(() => {
        if (this.cache === p) this.cache = null;
      });
    }
    return this.cache;
  }

  async get(): Promise<Outline> {
    const b = await this.built();
    this.lastKey ??= outlineKey(b.outline);
    return b.outline;
  }

  /** Innermost outline item containing a line of a memoria file (null if none). */
  static lookup(b: BuiltOutline, file: string, line: number): OutlineRef | null {
    const id = b.owners.get(file)?.[line - 1];
    const it = id ? b.byId.get(id) : undefined;
    return it ? { id: it.id, number: it.number, title: it.title } : null;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.bus.off('change', this.onChange);
    this.bus.off('settings', this.onOther);
    this.bus.off('compile', this.onOther);
  }
}
