import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from './context.ts';
import { HttpError } from './errors.ts';
import { atomicWrite, backup, createExclusive, rev, walkFiles } from './fsutil.ts';
import { type BuiltOutline, type OutlineItem, letterFor, slugify, splitLines, stripComment } from './outline.ts';
import { normalizeRel, resolveSafe } from './paths.ts';

export type SectionKind = 'chapter' | 'section' | 'appendix';

export interface CreateSectionResult {
  item: OutlineItem | null;
  file: string;
  line: number;
}

/** Test seam: runs after the new content is prepared and before the revision re-check. */
export const sectionHooks: { beforeCommit?: (file: string) => Promise<void> | void } = {};

export const CHAPTERS_DIR = '1-capitulos';
export const ANNEXES_DIR = '2-anexos';
export const TITLE_MAX = 120;

const fieldError = (field: string, message: string) => new HttpError(400, message, { field });

export function validateTitle(v: unknown): string {
  if (typeof v !== 'string') throw fieldError('title', 'El título es obligatorio');
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) throw fieldError('title', 'El título es obligatorio');
  if (t.length > TITLE_MAX) throw fieldError('title', `El título no puede superar ${TITLE_MAX} caracteres`);
  if (/[\\{}]/.test(t)) throw fieldError('title', 'El título no puede contener \\ ni llaves');
  return t;
}

/** Escape LaTeX special characters that may appear in a plain title. */
export function texEscape(t: string): string {
  return t
    .replace(/[&%$#_]/g, (c) => `\\${c}`)
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

const INCLUDE_RE = /\\(input|include)\s*\{([^{}]+)\}/;
const keyOf = (f: string) => f.trim().replace(/^\.\//, '').replace(/\.tex$/i, '');
export const eolOf = (s: string) => (s.includes('\r\n') ? '\r\n' : '\n');

async function readWithRev(ctx: Ctx, rel: string): Promise<{ abs: string; content: string; rev: string }> {
  const r = await resolveSafe(ctx.cfg, 'memoria', rel);
  let buf: Buffer;
  try {
    buf = await fs.readFile(r.abs);
  } catch (e: any) {
    if (e?.code === 'ENOENT') throw new HttpError(404, `No existe ${rel}`);
    throw e;
  }
  return { abs: r.abs, content: buf.toString('utf8'), rev: rev(buf) };
}

/** Re-read, compare revision, back up and write atomically (same guarantees as PUT /api/file). */
async function commit(ctx: Ctx, rel: string, abs: string, baseRev: string, next: string, onConflict?: () => Promise<void>) {
  await sectionHooks.beforeCommit?.(rel);
  const current = await fs.readFile(abs);
  const curRev = rev(current);
  if (curRev !== baseRev) {
    await onConflict?.();
    throw new HttpError(409, 'conflict', { path: rel, content: current.toString('utf8'), rev: curRev });
  }
  await backup(ctx.cfg, 'memoria', rel, current);
  await atomicWrite(abs, Buffer.from(next, 'utf8'));
}

async function existingLabels(ctx: Ctx): Promise<Set<string>> {
  const out = new Set<string>();
  for (const f of await walkFiles(ctx.cfg, 'memoria')) {
    if (!f.rel.toLowerCase().endsWith('.tex')) continue;
    const c = await fs.readFile(f.abs, 'utf8').catch(() => '');
    for (const m of c.matchAll(/\\label\s*\{([^{}]+)\}/g)) out.add(m[1].trim());
  }
  return out;
}

function uniqueLabel(labels: Set<string>, prefix: string, slug: string): string {
  let s = slug;
  for (let n = 2; labels.has(`${prefix}:${s}`); n++) s = `${slug}-${n}`;
  return `${prefix}:${s}`;
}

async function isDir(ctx: Ctx, rel: string): Promise<boolean> {
  try {
    const r = await resolveSafe(ctx.cfg, 'memoria', rel, true);
    return r.exists && (await fs.stat(r.abs)).isDirectory();
  } catch {
    return false;
  }
}

async function listDir(ctx: Ctx, rel: string): Promise<string[]> {
  const r = await resolveSafe(ctx.cfg, 'memoria', rel, true);
  return fs.readdir(r.abs).catch(() => [] as string[]);
}

const dirOf = (file: string) => {
  const d = path.posix.dirname(file);
  return d === '.' ? '' : d;
};
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Folder and naming scheme for a new chapter/annex file. */
async function chooseFile(ctx: Ctx, b: BuiltOutline, kind: 'chapter' | 'appendix', slug: string): Promise<string[]> {
  const enabled = b.flat.filter((it) => it.enabled);
  const lastOf = (k: string) => [...enabled].reverse().find((it) => it.kind === k);
  let dir: string;
  if (kind === 'appendix') {
    if (await isDir(ctx, ANNEXES_DIR)) dir = ANNEXES_DIR;
    else dir = dirOf(lastOf('appendix')?.file ?? (await isDir(ctx, CHAPTERS_DIR) ? `${CHAPTERS_DIR}/x` : lastOf('chapter')?.file ?? 'x'));
  } else {
    dir = (await isDir(ctx, CHAPTERS_DIR)) ? CHAPTERS_DIR : dirOf(lastOf('chapter')?.file ?? 'x');
  }
  const names = (await listDir(ctx, dir)).filter((n) => n.toLowerCase().endsWith('.tex'));
  const candidates: string[] = [];
  const letterScheme = kind === 'appendix' && (dir === ANNEXES_DIR || names.some((n) => /^[a-z][-_]/i.test(n)));
  const numberScheme = !letterScheme && (dir === CHAPTERS_DIR || names.some((n) => /^\d+[-_]/.test(n)));
  if (letterScheme) {
    const used = names.map((n) => /^([a-z])[-_]/i.exec(n)?.[1].toUpperCase().charCodeAt(0) ?? 0).filter(Boolean);
    const next = (used.length ? Math.max(...used) - 64 : 0) + 1;
    for (let k = 0; k < 5; k++) candidates.push(join(dir, `${letterFor(next + k).toLowerCase()}-${slug}.tex`));
  } else if (numberScheme) {
    const used = names.map((n) => Number(/^(\d+)[-_]/.exec(n)?.[1] ?? 0));
    const next = (used.length ? Math.max(...used) : 0) + 1;
    for (let k = 0; k < 5; k++) candidates.push(join(dir, `${String(next + k).padStart(2, '0')}-${slug}.tex`));
  } else {
    candidates.push(join(dir, `${slug}.tex`));
    for (let k = 2; k < 6; k++) candidates.push(join(dir, `${slug}-${k}.tex`));
  }
  return candidates;
}

interface IncludeLine {
  idx: number;
  cmd: string;
  target: string;
  commented: boolean;
  indent: string;
}

function includeAt(raw: string, idx: number): IncludeLine | null {
  const stripped = stripComment(raw);
  const live = INCLUDE_RE.exec(stripped);
  if (live) return { idx, cmd: live[1], target: live[2], commented: false, indent: /^\s*/.exec(raw)![0] };
  const dm = /^(\s*)%+\s*(?:\{\s*(?:\\[a-zA-Z]+\s*)*)?\\(input|include)\s*\{([^{}]+)\}/.exec(raw);
  if (dm) return { idx, cmd: dm[2], target: dm[3], commented: true, indent: dm[1] };
  return null;
}

const STRUCT_RE = (names: string) => new RegExp(`\\\\(?:${names})(?![a-zA-Z@])|\\\\end\\s*\\{document\\}`);

/** Index (in lines) where the new include line goes, plus a reference include for style. */
function insertionPoint(lines: string[], kind: 'chapter' | 'appendix', afterFile: string | null): { at: number; ref: IncludeLine | null; addAppendix: boolean } {
  const stripped = lines.map(stripComment);
  const incs = lines.map((l, i) => includeAt(l, i));
  if (afterFile) {
    const k = keyOf(afterFile);
    const hit = incs.find((x) => x && keyOf(x.target) === k);
    if (!hit) throw fieldError('after', 'Ese apartado no se incluye directamente desde el archivo principal');
    return { at: hit.idx + 1, ref: hit, addAppendix: false };
  }
  const find = (re: RegExp, from: number) => {
    for (let i = from; i < lines.length; i++) if (re.test(stripped[i])) return i;
    return -1;
  };
  const lastBefore = (from: number, to: number) => {
    let ref: IncludeLine | null = null;
    for (let i = from + 1; i < to; i++) if (incs[i]) ref = incs[i];
    if (ref) return { at: ref.idx + 1, ref };
    let k = to;
    while (k > from + 1 && stripped[k - 1].trim() === '' && lines[k - 1].trim() === '') k--;
    return { at: k, ref: null };
  };
  const endDoc = (from: number) => {
    const e = find(/\\end\s*\{document\}/, from);
    return e < 0 ? lines.length : e;
  };
  if (kind === 'appendix') {
    const app = find(/\\appendix(?![a-zA-Z@])/, 0);
    if (app >= 0) {
      let end = find(STRUCT_RE('backmatter|bibliography|printbibliography'), app + 1);
      if (end < 0) end = lines.length;
      return { ...lastBefore(app, end), addAppendix: false };
    }
    const mainStart = Math.max(find(/\\mainmatter(?![a-zA-Z@])/, 0), find(/\\begin\s*\{document\}/, 0));
    let end = find(STRUCT_RE('bibliography|printbibliography'), mainStart + 1);
    if (end < 0) end = endDoc(mainStart + 1);
    const lb = lastBefore(mainStart, end);
    return { at: end, ref: lb.ref, addAppendix: true };
  }
  let start = find(/\\mainmatter(?![a-zA-Z@])/, 0);
  if (start < 0) start = find(/\\begin\s*\{document\}/, 0);
  let end = find(STRUCT_RE('appendix|backmatter|bibliography|printbibliography'), start + 1);
  if (end < 0) end = lines.length;
  return { ...lastBefore(start, end), addAppendix: false };
}

function chapterContent(kind: 'chapter' | 'appendix', title: string, label: string, eol: string): string {
  const guide =
    kind === 'appendix'
      ? ['% Guía: material complementario que apoya la memoria (tablas extensas, manuales, código…).', '% Refiérete a este anexo desde el capítulo que lo necesite.']
      : ['% Guía: explica qué aporta este capítulo y cómo se relaciona con el resto de la memoria.', '% Sustituye el párrafo de ejemplo por tu texto y añade secciones cuando lo necesites.'];
  return [`\\chapter{${texEscape(title)}}\\label{${label}}`, '', ...guide, '', 'Escribe aquí el contenido.', ''].join(eol);
}

async function rebuild(ctx: Ctx): Promise<BuiltOutline> {
  ctx.outline.invalidate();
  return ctx.outline.built();
}

function findItem(b: BuiltOutline, id: unknown, field: string): OutlineItem {
  if (typeof id !== 'string' || !id) throw fieldError(field, `${field} no válido`);
  const it = b.byId.get(id);
  if (!it) throw fieldError(field, 'Ese apartado ya no existe (recarga el índice)');
  return it;
}

async function createChapter(ctx: Ctx, kind: 'chapter' | 'appendix', title: string, afterId: unknown): Promise<CreateSectionResult> {
  const main = normalizeRel(ctx.cfg.memoriaMain);
  return ctx.locks.run(`memoria:${main}`, async () => {
    const b = await rebuild(ctx);
    const after = afterId === undefined || afterId === null || afterId === '' ? null : findItem(b, afterId, 'after');
    const m = await readWithRev(ctx, main);
    const eol = eolOf(m.content);
    const lines = splitLines(m.content);
    if (after && after.file === main) throw fieldError('after', 'Ese apartado está en el archivo principal');
    const point = insertionPoint(lines, kind, after ? after.file : null);

    const slug = slugify(title, kind === 'appendix' ? 'anexo' : 'capitulo');
    const label = uniqueLabel(await existingLabels(ctx), 'cap', slug);
    let file = '';
    let abs = '';
    for (const cand of await chooseFile(ctx, b, kind, slug)) {
      const r = await resolveSafe(ctx.cfg, 'memoria', cand);
      if (r.exists) continue;
      await fs.mkdir(path.dirname(r.abs), { recursive: true });
      await resolveSafe(ctx.cfg, 'memoria', cand); // containment re-check after mkdir
      if (await createExclusive(r.abs, Buffer.from(chapterContent(kind, title, label, eol), 'utf8'))) {
        file = r.rel;
        abs = r.abs;
        break;
      }
    }
    if (!file) throw new HttpError(409, 'No se pudo elegir un nombre de archivo libre');

    const ref = point.ref;
    const cmd = ref?.cmd ?? 'include';
    const withExt = ref ? /\.tex\s*$/i.test(ref.target) : false;
    const target = withExt ? file : file.replace(/\.tex$/i, '');
    const incLine = `${ref?.indent ?? ''}\\${cmd}{${target}}`;
    const insert = point.addAppendix ? [`${ref?.indent ?? ''}\\appendix`, incLine] : [incLine];
    const next = [...lines];
    next.splice(point.at, 0, ...insert);
    try {
      await commit(ctx, main, m.abs, m.rev, next.join(eol), async () => {
        await fs.rm(abs, { force: true });
      });
    } catch (e) {
      if (!(e instanceof HttpError)) await fs.rm(abs, { force: true });
      throw e;
    }
    const nb = await rebuild(ctx);
    ctx.outline.changed();
    const item = nb.flat.find((it) => it.file === file && (it.kind === 'chapter' || it.kind === 'appendix' || it.kind === 'frontmatter')) ?? null;
    return { item, file, line: 1 };
  });
}

async function createSubsection(ctx: Ctx, title: string, parentId: unknown, afterId: unknown): Promise<CreateSectionResult> {
  const b0 = await rebuild(ctx);
  const hasAfter = !(afterId === undefined || afterId === null || afterId === '');
  const hasParent = !(parentId === undefined || parentId === null || parentId === '');
  if (!hasAfter && !hasParent) throw fieldError('parent', 'Indica el capítulo (parent) o el apartado anterior (after)');
  let anchor = hasAfter ? findItem(b0, afterId, 'after') : findItem(b0, parentId, 'parent');
  let mode: 'after' | 'end' = hasAfter ? 'after' : 'end';
  if (anchor.kind === 'subsection' && mode === 'after') {
    const parentSec = b0.flat.find((it) => it.children.includes(anchor) && it.kind === 'section');
    if (parentSec) anchor = parentSec;
  }
  const chapterish = anchor.kind === 'chapter' || anchor.kind === 'appendix' || anchor.kind === 'frontmatter';
  if (chapterish) mode = 'end';
  else if (anchor.kind !== 'section' || mode !== 'after') {
    throw fieldError(hasAfter ? 'after' : 'parent', 'El apartado indicado no admite secciones');
  }
  if (!anchor.enabled) throw fieldError(hasAfter ? 'after' : 'parent', 'Ese apartado está desactivado');
  const file = anchor.file;
  const anchorLine = anchor.line;

  return ctx.locks.run(`memoria:${file}`, async () => {
    const f = await readWithRev(ctx, file);
    const eol = eolOf(f.content);
    const lines = splitLines(f.content);
    const stripped = lines.map(stripComment);
    const stop =
      mode === 'end'
        ? /\\(?:chapter|appendix|backmatter|bibliography|printbibliography)(?![a-zA-Z@])|\\end\s*\{document\}/
        : /\\(?:chapter|section|appendix|backmatter|bibliography|printbibliography)(?![a-zA-Z@])|\\end\s*\{document\}/;
    let end = lines.length;
    for (let i = anchorLine; i < lines.length; i++) {
      if (stop.test(stripped[i])) {
        end = i;
        break;
      }
    }
    let k = end;
    while (k > anchorLine && lines[k - 1].trim() === '') k--;
    const slug = slugify(title, 'seccion');
    const label = uniqueLabel(await existingLabels(ctx), 'sec', slug);
    const block = ['', `\\section{${texEscape(title)}}\\label{${label}}`, '', '% Escribe aquí el contenido de esta sección.'];
    if (k < lines.length && lines[k].trim() !== '') block.push('');
    const next = [...lines];
    next.splice(k, 0, ...block);
    await commit(ctx, file, f.abs, f.rev, next.join(eol));
    const line = k + 2;
    const nb = await rebuild(ctx);
    ctx.outline.changed();
    const item = nb.flat.find((it) => it.file === file && it.line === line && it.kind === 'section') ?? null;
    return { item, file, line };
  });
}

export async function createSection(ctx: Ctx, body: unknown): Promise<CreateSectionResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = b.kind;
  if (kind !== 'chapter' && kind !== 'section' && kind !== 'appendix') {
    throw fieldError('kind', 'kind debe ser chapter, section o appendix');
  }
  const title = validateTitle(b.title);
  if (kind === 'section') return createSubsection(ctx, title, b.parent, b.after);
  return createChapter(ctx, kind, title, b.after);
}
