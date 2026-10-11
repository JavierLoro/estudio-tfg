import crypto from 'node:crypto';
import { badRequest } from './errors.ts';
import { cleanTex } from './refs.ts';

export type ImportFormat = 'bibtex' | 'ris' | 'doi';
export interface BibEntry {
  key: string;
  entryType: string;
  title: string;
  fields: Record<string, string>;
  raw: string;
  start: number;
  end: number;
  error?: string;
}
export const sourceHash = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
export const citeKey = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/;
export const fieldName = /^[A-Za-z][A-Za-z0-9_:.-]{0,99}$/;
export const texEscape = (value: string) =>
  value.replace(
    /[\\{}%&#_$~^]/g,
    (c) => ({ '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' })[c] ?? `\\${c}`,
  );

interface Span {
  start: number;
  end: number;
  value: string;
}
interface Parsed extends BibEntry {
  keySpan: Span;
  typeSpan: Span;
  values: Record<string, Span>;
  close: number;
}
const ws = (text: string, start: number) => {
  let i = start;
  for (;;) {
    while (/\s/.test(text[i] ?? '') && i < text.length) i++;
    if (text[i] !== '%') return i;
    const end = text.indexOf('\n', i);
    i = end < 0 ? text.length : end + 1;
  }
};
function group(text: string, start: number, close = '}', comments = false) {
  let depth = close === '}' ? 1 : 0,
    quoted = false;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"' && depth === (close === '}' ? 1 : 0)) quoted = !quoted;
    if (comments && !quoted && c === '%' && depth === (close === '}' ? 1 : 0)) {
      i = text.indexOf('\n', i);
      if (i < 0) return -1;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (close === '}' && depth === 0) return i;
    } else if (c === close && depth === 0 && !quoted) return i;
  }
  return -1;
}
function expression(text: string, start: number, stop: number): Span {
  let i = start,
    depth = 0,
    quoted = false;
  for (; i < stop; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (!depth && c === '"') quoted = !quoted;
    if (!quoted && c === '{') depth++;
    else if (!quoted && c === '}') depth--;
    if (!depth && !quoted && c === ',') break;
    if (depth < 0) throw new Error('Llaves no equilibradas');
    if (!depth && !quoted && c === '%') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? stop : end;
    }
  }
  if (depth || quoted) throw new Error('Valor bibliográfico sin cerrar');
  const value = text.slice(start, i).trim();
  if (!value) throw new Error('Campo bibliográfico sin valor');
  return { start, end: start + text.slice(start, i).trimEnd().length, value };
}

/** Escáner de rangos: los bytes originales quedan separados de los valores editables. */
export function parseBibDocument(text: string): { entries: Parsed[]; support: string; macros: Map<string, string> } {
  const entries: Parsed[] = [],
    macros = new Map<string, string>();
  let support = '',
    last = 0,
    i = 0;
  while (i < text.length) {
    i = ws(text, i);
    if (text[i] !== '@') {
      i++;
      continue;
    }
    const m = /^@\s*([A-Za-z]+)\s*([{(])/.exec(text.slice(i));
    if (!m) {
      i++;
      continue;
    }
    const type = m[1].toLowerCase(),
      open = i + m[0].length - 1;
    let close = group(text, open, m[2] === '{' ? '}' : ')', type !== 'comment');
    const next = /\r?\n[ \t]*@[A-Za-z]+\s*[{(]/.exec(text.slice(open + 1));
    if (close < 0) {
      close = next ? open + 1 + next.index : text.length;
      if (!['string', 'comment', 'preamble'].includes(type))
        entries.push({
          key: '',
          entryType: type,
          title: '',
          fields: {},
          raw: text.slice(i, close),
          start: i,
          end: close,
          error: 'Entrada sin cerrar; corrige el original o completa sus datos',
          keySpan: { start: open + 1, end: open + 1, value: '' },
          typeSpan: { start: i + 1, end: i + 1 + m[1].length, value: type },
          values: {},
          close,
        });
      if (entries.length > 100) throw badRequest('Importa como máximo 100 referencias por lote');
      i = Math.max(close, open + 1);
      continue;
    }
    if (['string', 'comment', 'preamble'].includes(type)) {
      if (type === 'string') {
        const nm = /^\s*([A-Za-z][A-Za-z0-9_:-]*)\s*=/.exec(text.slice(open + 1, close));
        if (nm)
          try {
            macros.set(nm[1].toLowerCase(), expression(text, open + 1 + nm[0].length, close).value);
          } catch {
            /* avisa cada campo que la necesite */
          }
      }
      i = close + 1;
      continue;
    }
    support += text.slice(last, i);
    last = close + 1;
    let p = ws(text, open + 1);
    const keyStart = p;
    while (p < close && !/[\s,]/.test(text[p])) p++;
    const key = text.slice(keyStart, p);
    const entry: Parsed = {
      key,
      entryType: type,
      title: '',
      fields: {},
      raw: text.slice(i, close + 1),
      start: i,
      end: close + 1,
      keySpan: { start: keyStart, end: p, value: key },
      typeSpan: { start: text.indexOf(m[1], i + 1), end: text.indexOf(m[1], i + 1) + m[1].length, value: type },
      values: {},
      close,
    };
    try {
      p = ws(text, p);
      if (!key || text[p] !== ',') throw new Error('Falta la clave o su coma');
      p++;
      while ((p = ws(text, p)) < close) {
        if (text[p] === ',') {
          p++;
          continue;
        }
        const nm = /^([A-Za-z][A-Za-z0-9_:.-]*)\s*=/.exec(text.slice(p, close));
        if (!nm) throw new Error('Campo bibliográfico no válido');
        const name = nm[1].toLowerCase();
        if (Object.keys(entry.values).length >= 100) throw new Error('La entrada supera 100 campos');
        if (Object.hasOwn(entry.values, name)) throw new Error(`Campo repetido: ${name}`);
        const v = expression(text, ws(text, p + nm[0].length), close);
        entry.values[name] = v;
        p = v.end;
      }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : 'Entrada no válida';
    }
    entries.push(entry);
    i = close + 1;
    if (entries.length > 100) throw badRequest('Importa como máximo 100 referencias por lote');
  }
  support += text.slice(last);
  const defaults = new Map(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m, i) => [
      m,
      ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][i],
    ]),
  );
  const expand = (expr: string, chain: string[] = []): string => {
    let p = 0,
      result = '';
    while ((p = ws(expr, p)) < expr.length) {
      const c = expr[p];
      if (c === '{') {
        const end = group(expr, p);
        if (end < 0) throw new Error('Llaves sin cerrar');
        result += expr.slice(p + 1, end);
        p = end + 1;
      } else if (c === '"') {
        let end = p + 1,
          depth = 0;
        for (; end < expr.length; end++) {
          if (expr[end] === '\\') end++;
          else if (expr[end] === '{') depth++;
          else if (expr[end] === '}') depth--;
          else if (expr[end] === '"' && !depth) break;
        }
        if (end >= expr.length) throw new Error('Comillas sin cerrar');
        result += expr.slice(p + 1, end);
        p = end + 1;
      } else {
        const m = /^[A-Za-z0-9_:.+-]+/.exec(expr.slice(p));
        if (!m) throw new Error('Expresión bibliográfica no válida');
        const name = m[0].toLowerCase();
        if (/^\d+$/.test(name)) result += name;
        else if (macros.has(name)) {
          if (chain.includes(name) || chain.length >= 16) throw new Error(`Macro circular: ${name}`);
          result += expand(macros.get(name)!, [...chain, name]);
        } else if (defaults.has(name)) result += defaults.get(name);
        else throw new Error(`Macro sin definición: ${name}`);
        p += m[0].length;
      }
      if (result.length > 65536) throw new Error('El campo expandido supera 64 KiB');
      p = ws(expr, p);
      if (p < expr.length) {
        if (expr[p] !== '#') throw new Error('Falta # entre los valores');
        p++;
      }
    }
    return result;
  };
  for (const entry of entries)
    try {
      for (const [name, v] of Object.entries(entry.values)) entry.fields[name] = expand(v.value);
      entry.title = entry.fields.title ?? '';
      delete entry.fields.title;
      if (!entry.title && !['xdata', 'set'].includes(entry.entryType)) entry.error ??= 'Falta el título; complétalo antes de importar';
    } catch (e) {
      entry.error ??= e instanceof Error ? e.message : 'Expresión no válida';
    }
  return { entries, support, macros };
}

export function parseRis(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const blocks = text.split(/(?=^TY\s+-\s*)/m).filter((s) => s.trim());
  for (const block of blocks) {
    const values: Record<string, string[]> = {};
    let last = '';
    for (const line of block.split(/\r?\n/)) {
      const m = /^([A-Z0-9]{2})\s+-\s?(.*)$/.exec(line.replace(/^\uFEFF/, ''));
      if (m) {
        last = m[1];
        (values[last] ??= []).push(m[2]);
      } else if (line.trim() && last) values[last][values[last].length - 1] += ' ' + line.trim();
    }
    const get = (...names: string[]) => names.map((n) => values[n]?.[0]).find(Boolean) ?? '';
    const fields: Record<string, string> = {};
    const maps: Record<string, string> = {
      PY: 'year',
      DO: 'doi',
      JO: 'journaltitle',
      JF: 'journaltitle',
      T2: 'booktitle',
      VL: 'volume',
      IS: 'number',
      PB: 'publisher',
      SN: 'isbn',
      UR: 'url',
      AB: 'abstract',
    };
    for (const [tag, name] of Object.entries(maps)) if (get(tag)) fields[name] = get(tag);
    if (values.AU || values.A1) fields.author = (values.AU ?? values.A1).join(' and ');
    if (values.A2) fields.editor = values.A2.join(' and ');
    if (get('SP')) fields.pages = get('SP') + (get('EP') ? '--' + get('EP') : '');
    const title = get('TI', 'T1'),
      ty = get('TY');
    const publicationDate = get('PY', 'Y1', 'DA');
    if (publicationDate) {
      const date = /^(\d{4})(?:[/-](\d{2})(?:[/-](\d{2}))?)?(?:\D|$)/.exec(publicationDate);
      if (date) {
        fields.year = date[1];
        if (date[2]) fields.date = [date[1], date[2], date[3]].filter(Boolean).join('-');
      }
    }
    if (ty === 'JOUR' && !fields.journaltitle && get('T2')) {
      fields.journaltitle = get('T2');
      delete fields.booktitle;
    }
    entries.push({
      key: get('ID'),
      entryType:
        ({ JOUR: 'article', BOOK: 'book', CHAP: 'incollection', THES: 'thesis', RPRT: 'report', ELEC: 'online' } as Record<string, string>)[
          ty
        ] ?? 'misc',
      title,
      fields,
      raw: block,
      start: 0,
      end: block.length,
      ...(!ty || !values.ER
        ? { error: 'La entrada RIS necesita TY al principio y ER al final' }
        : !title
          ? { error: 'Falta el título; complétalo antes de importar' }
          : {}),
    });
  }
  if (entries.length > 100) throw badRequest('Importa como máximo 100 referencias por lote');
  return entries;
}
export function normalizeDoi(input: string): string {
  let doi = input.trim().replace(/^doi:\s*/i, '');
  if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(doi))
    try {
      doi = decodeURIComponent(new URL(doi).pathname.slice(1));
    } catch {
      throw badRequest('Enlace DOI no válido');
    }
  if (!/^10\.\d{4,9}\/\S+$/i.test(doi) || doi.length > 512 || /[\u0000-\u0020]/.test(doi)) throw badRequest('DOI no válido');
  return doi.toLowerCase();
}
export function suggestedKey(title: string, fields: Record<string, string>, original = ''): string {
  if (citeKey.test(original)) return original;
  const stem = (
    cleanTex(fields.author ?? '')
      .split(/\s+and\s+/)[0]
      .split(',')[0] || cleanTex(title)
  )
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 50);
  return `${stem || 'referencia'}${/\d{4}/.exec(fields.year ?? fields.date ?? '')?.[0] ?? ''}`;
}

/** Reescribir solo clave/tipo/valores editados; los demás tokens y comentarios permanecen. */
export function rewriteBibEntry(
  text: string,
  entry: Parsed,
  next: { key: string; entryType: string; title: string; fields: Record<string, string> },
): string {
  const fields: Record<string, string> = { ...next.fields, title: next.title },
    old: Record<string, string> = { ...entry.fields, title: entry.title };
  const changes: { start: number; end: number; value: string }[] = [];
  if (next.key !== entry.key) changes.push({ ...entry.keySpan, value: next.key });
  if (next.entryType !== entry.entryType) changes.push({ ...entry.typeSpan, value: next.entryType });
  const extra: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === old[name]) continue;
    const literal = `{${texEscape(value)}}`,
      span = entry.values[name];
    if (span) changes.push({ ...span, value: literal });
    else extra.push(`  ${name} = ${literal}`);
  }
  if (extra.length) {
    const before = text.slice(entry.start, entry.close).trimEnd();
    changes.push({ start: entry.close, end: entry.close, value: `${before.endsWith(',') ? '' : ','}\n${extra.join(',\n')}\n` });
  }
  let result = text.slice(entry.start, entry.end);
  for (const c of changes.sort((a, b) => b.start - a.start))
    result = result.slice(0, c.start - entry.start) + c.value + result.slice(c.end - entry.start);
  return result;
}
