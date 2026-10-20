/** Subconjunto visual conservador: los rangos siempre apuntan al .tex original. */
export interface VisualSpan { from: number; to: number; kind: 'hidden' | 'bold' | 'italic' | 'citation' | 'literal'; text?: string }
export interface VisualLine { from: number; to: number; kind: 'text' | 'heading' | 'item' | 'structure' | 'code'; level?: number; bullet?: string; indent?: number; spans: VisualSpan[]; body: number; bodyEnd: number }
const labels = /^(?:\s*\\label\{[^{}\s\\%]+\})*\s*$/;
const trailingLabels = /(?:\s*\\label\{[^{}\s\\%]+\})+\s*$/;
const headings = ['chapter', 'section', 'subsection', 'subsubsection'];

function closingBrace(text: string, body: number, end = text.length): number | null {
  let depth = 1;
  for (let i = body; i < end; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return i;
  }
  return null;
}

/** null significa que la línea necesita el editor de código, nunca una conversión aproximada. */
export function inlineVisual(text: string, offset = 0): VisualSpan[] | null {
  const spans: VisualSpan[] = [];
  function read(start: number, end: number, level = 0): boolean {
    if (level > 32) return false;
    for (let i = start; i < end;) {
      if (text[i] === '\\') {
        if (/[#$%&_{}]/.test(text[i + 1] ?? '') && i + 1 < end) {
          spans.push({ from: offset + i, to: offset + i + 2, kind: 'literal', text: text[i + 1] }); i += 2; continue;
        }
        const literal = /^\\(textbackslash|textasciicircum|textasciitilde)\{\}/.exec(text.slice(i, end));
        if (literal) {
          spans.push({ from: offset + i, to: offset + i + literal[0].length, kind: 'literal', text: ({ textbackslash: '\\', textasciicircum: '^', textasciitilde: '~' })[literal[1]] });
          i += literal[0].length; continue;
        }
        const command = /^\\(textbf|textit|emph|cite|parencite|textcite)\{/.exec(text.slice(i, end));
        if (!command) return false;
        const body = i + command[0].length;
        const close = closingBrace(text, body, end);
        if (close === null) return false;
        if (['cite', 'parencite', 'textcite'].includes(command[1])) {
          const keys = text.slice(body, close);
          if (!/^[A-Za-z0-9_:./+-]+(?:\s*,\s*[A-Za-z0-9_:./+-]+)*$/.test(keys)) return false;
          spans.push({ from: offset + i, to: offset + close + 1, kind: 'citation', text: `[${keys}]` });
        } else {
          if (!read(body, close, level + 1)) return false;
          spans.push({ from: offset + i, to: offset + body, kind: 'hidden' },
            { from: offset + close, to: offset + close + 1, kind: 'hidden' },
            { from: offset + body, to: offset + close, kind: command[1] === 'textbf' ? 'bold' : 'italic' });
        }
        i = close + 1;
      } else {
        if (/[{}%$&#_^~]/.test(text[i])) return false;
        i++;
      }
    }
    return true;
  }
  return read(0, text.length) ? spans : null;
}

export function visualLines(source: string): VisualLine[] {
  const result: VisualLine[] = [], envs: string[] = [], counts: number[] = [];
  let offset = 0, depth = 0, displayMath = false;
  for (const full of source.split('\n')) {
    const text = full.replace(/\r$/, ''), from = offset, to = from + text.length;
    const line: VisualLine = { from, to, body: from, bodyEnd: to, kind: 'code', spans: [] };
    const opaque = envs.some((name) => !['document', 'itemize', 'enumerate'].includes(name)) || depth !== 0 || displayMath;
    const environment = /^\s*\\(begin|end)\{(document|itemize|enumerate)\}\s*$/.exec(text);
    if (!opaque && environment) line.kind = 'structure';
    else if (!opaque) {
      const heading = /^\s*\\(chapter|section|subsection|subsubsection)(\*?)\{/.exec(text);
      const close = heading ? closingBrace(text, heading[0].length) : null;
      const item = /^\s*\\item\s+/.exec(text);
      let body = text, prefix = 0;
      if (heading && close !== null && labels.test(text.slice(close + 1))) {
        prefix = heading[0].length; body = text.slice(prefix, close);
        line.kind = 'heading'; line.level = headings.indexOf(heading[1]) + 1;
        line.bodyEnd = from + close;
      } else if (item && envs.some((name) => name === 'itemize' || name === 'enumerate')) {
        prefix = item[0].length; body = text.slice(prefix); line.kind = 'item';
        counts[counts.length - 1] = (counts.at(-1) ?? 0) + 1;
        line.indent = envs.filter((name) => name === 'itemize' || name === 'enumerate').length - 1;
        line.bullet = envs.at(-1) === 'enumerate' ? `${counts.at(-1)}. ` : '• ';
      } else {
        line.kind = 'text';
        const tail = trailingLabels.exec(text);
        if (tail) { line.bodyEnd = from + tail.index; body = text.slice(0, tail.index); }
      }
      const spans = inlineVisual(body, from + prefix);
      if (spans) {
        line.body = from + prefix; line.spans = spans;
        if (prefix) line.spans.push({ from, to: from + prefix, kind: 'hidden' });
        if (line.bodyEnd < to) line.spans.push({ from: line.bodyEnd, to, kind: 'hidden' });
      } else line.kind = 'code';
    }
    if (['verbatim', 'Verbatim', 'lstlisting', 'minted'].includes(envs.at(-1) ?? '') && text.trim() !== `\\end{${envs.at(-1)}}`) {
      result.push(line); offset += full.length + 1; continue;
    }
    // No interpretar estructuras dentro de comentarios ni comandos escapados.
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '%') break;
      if (text[i] === '\\') {
        const verb = /^\\verb\*?([^A-Za-z\s])/.exec(text.slice(i));
        if (verb) {
          const end = text.indexOf(verb[1], i + verb[0].length);
          if (end < 0) break;
          i = end; continue;
        }
        const env = /^\\(begin|end)\{([^{}]+)\}/.exec(text.slice(i));
        if (env) {
          if (env[1] === 'begin') { envs.push(env[2]); counts.push(0); }
          else if (envs.at(-1) === env[2]) { envs.pop(); counts.pop(); }
          i += env[0].length - 1; continue;
        }
        if (text[i + 1] === '[') displayMath = true;
        if (text[i + 1] === ']') displayMath = false;
        i++; continue;
      }
      if (text.slice(i, i + 2) === '$$') { displayMath = !displayMath; i++; continue; }
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
    }
    result.push(line); offset += full.length + 1;
  }
  return result;
}

export function escapeVisualText(text: string): string {
  return text.replace(/[\\{}%$&#_^~]/g, (char) => ({ '\\': '\\textbackslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' })[char] ?? `\\${char}`);
}


/** Una sola sustitución del rango elegido; el resto del archivo queda intacto. */
export function visualEdit(source: string, from: number, to: number, kind: string): { from: number; to: number; insert: string; anchor: number } | null {
  const lines = visualLines(source);
  const line = lines.find((item) => item.from <= from && item.to >= from);
  if (!line || line.kind === 'code' || line.kind === 'structure') return null;
  ({ from, to } = visualRange(source, from, to));
  const selected = source.slice(from, to);
  if (kind === 'textbf' || kind === 'emph') {
    if (!selected || selected.includes('\n') || !inlineVisual(selected)) return null;
    const insert = `\\${kind}{${selected}}`;
    return { from, to, insert, anchor: from + insert.length - 1 };
  }
  if (kind === 'itemize' || kind === 'enumerate') {
    const last = lines.find((item) => item.from <= to && item.to >= to);
    if (!last) return null;
    const items = source.slice(line.from, last.to).split('\n');
    if (items.some((text) => !inlineVisual(text))) return null;
    const insert = `\\begin{${kind}}\n${items.map((text) => `\\item ${text}`).join('\n')}\n\\end{${kind}}`;
    return { from: line.from, to: last.to, insert, anchor: line.from + `\\begin{${kind}}\n\\item `.length };
  }
  if (kind.startsWith('cite:')) {
    const key = kind.slice(5);
    if (!/^[A-Za-z0-9_:./+-]+$/.test(key) || !inlineVisual(selected) || selected.includes('\n')) return null;
    const insert = `\\cite{${key}}`;
    return { from, to, insert, anchor: from + insert.length };
  }
  if (!['paragraph', ...headings].includes(kind) || to > line.to || line.kind === 'item') return null;
  const original = source.slice(line.from, line.to);
  const body = source.slice(line.body, line.bodyEnd);
  const tail = source.slice(line.bodyEnd + (line.kind === 'heading' ? 1 : 0), line.to);
  const star = /^\s*\\(?:chapter|section|subsection|subsubsection)\*/.test(original) ? '*' : '';
  const insert = kind === 'paragraph' ? body + tail : `\\${kind}${star}{${body}}${tail}`;
  return { from: line.from, to: line.to, insert, anchor: line.from + (kind === 'paragraph' ? 0 : kind.length + star.length + 2) };
}


export function visualCaret(source: string, position: number): number {
  const line = visualLines(source).find((item) => item.from <= position && item.to >= position);
  if (!line || line.kind === 'code') return position;
  for (const span of line.spans) {
    if (span.kind === 'hidden' && position >= span.from && position < span.to) {
      return source.slice(span.from, span.to).endsWith('{') || span.to === line.body ? span.to : span.from;
    }
    if ((span.kind === 'literal' || span.kind === 'citation') && position > span.from && position < span.to) return span.from;
  }
  return position;
}

/** El portapapeles visual intercambia texto sin formato; LaTeX se pega desde Código. */
export function visualClipboard(source: string, from = 0, to = source.length): string {
  const edits: { from: number; to: number; text: string }[] = [];
  for (const line of visualLines(source)) {
    if (line.kind === 'structure') edits.push({ from: line.from, to: line.to, text: '' });
    for (const span of line.spans) {
      if (span.kind === 'hidden') edits.push({ from: span.from, to: span.to, text: line.kind === 'item' && span.from === line.from ? line.bullet ?? '' : '' });
      else if (span.kind === 'literal' || span.kind === 'citation') edits.push({ from: span.from, to: span.to, text: span.text ?? '' });
    }
  }
  let text = source.slice(from, to);
  for (const edit of edits.sort((a, b) => b.from - a.from)) {
    const start = Math.max(from, edit.from), end = Math.min(to, edit.to);
    if (start < end) text = text.slice(0, start - from) + edit.text + text.slice(end - from);
  }
  return text;
}

/** Evita incluir delimitadores invisibles al seleccionar hasta el final visual de un título/formato. */
export function visualRange(source: string, from: number, to: number): { from: number; to: number } {
  const line = visualLines(source).find((item) => item.from <= from && item.to >= to);
  if (!line || line.kind === 'code') return { from, to };
  if (from === to) from = to = visualCaret(source, from);
  if (line.kind === 'heading' || line.bodyEnd < line.to) {
    from = Math.max(line.body, Math.min(from, line.bodyEnd)); to = Math.max(from, Math.min(to, line.bodyEnd));
  }
  for (const span of line.spans) {
    if (span.kind !== 'bold' && span.kind !== 'italic') continue;
    const open = line.spans.find((other) => other.kind === 'hidden' && other.to === span.from);
    const close = line.spans.find((other) => other.kind === 'hidden' && other.from === span.to);
    if (close && from >= span.from && from <= span.to && to > span.to && to <= close.to) to = span.to;
    if (open && from >= open.from && from < span.from && to >= span.from && to <= span.to) from = span.from;
  }
  return { from, to };
}
