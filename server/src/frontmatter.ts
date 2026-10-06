import YAML from 'yaml';

export interface Split {
  /** Raw YAML text between the fences (without fences), or null if no frontmatter. */
  yaml: string | null;
  /** Everything before the YAML (opening fence + newline). */
  open: string;
  /** Closing fence line including its newline (if any). */
  close: string;
  body: string;
  eol: string;
}


export function splitFrontmatter(src: string): Split {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const m = /^﻿?---[ \t]*\r?\n/.exec(src);
  if (!m) return { yaml: null, open: '', close: '', body: src, eol };
  const rest = src.slice(m[0].length);
  // Find closing fence at line start.
  const close = /(^|\r?\n)(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(rest);
  if (!close) return { yaml: null, open: '', close: '', body: src, eol };
  const yamlEnd = close.index + close[1].length; // yaml includes its trailing newline
  return {
    yaml: rest.slice(0, yamlEnd),
    open: m[0],
    close: rest.slice(yamlEnd, close.index + close[0].length),
    body: rest.slice(close.index + close[0].length),
    eol,
  };
}

export function parseFrontmatter(src: string): { data: Record<string, any>; body: string } {
  const s = splitFrontmatter(src);
  if (s.yaml === null) return { data: {}, body: src };
  try {
    const data = YAML.parse(s.yaml, { prettyErrors: false });
    return { data: data && typeof data === 'object' && !Array.isArray(data) ? data : {}, body: s.body };
  } catch {
    return { data: {}, body: s.body };
  }
}

export function yamlScalar(v: string): string {
  return YAML.stringify(v, { lineWidth: 0 }).trimEnd();
}

/**
 * Surgically set top-level keys in the frontmatter, preserving every other
 * line of the file byte-for-byte. Values may be strings or string arrays.
 */
export function setFrontmatterKeys(src: string, updates: Record<string, string | string[]>): string {
  const s = splitFrontmatter(src);
  const eol = s.eol;
  const render = (key: string, v: string | string[]): string[] => {
    if (Array.isArray(v)) {
      if (v.length === 0) return [`${key}: []`];
      return [`${key}:`, ...v.map((t) => `  - ${yamlScalar(t)}`)];
    }
    return [`${key}: ${yamlScalar(v)}`];
  };

  if (s.yaml === null) {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(updates)) lines.push(...render(k, v));
    return `---${eol}${lines.join(eol)}${eol}---${eol}${src}`;
  }

  const lines = s.yaml.split(/\r?\n/);
  // s.yaml ends with newline (or is empty) -> last element is ''
  const trailingEmpty = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailingEmpty) lines.pop();

  for (const [key, v] of Object.entries(updates)) {
    const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
    const start = lines.findIndex((l) => keyRe.test(l));
    const rendered = render(key, v);
    if (start === -1) {
      lines.push(...rendered);
      continue;
    }
    // Block continues while lines are indented, list items at column 0, or blank followed by such.
    let end = start + 1;
    while (end < lines.length && (/^[ \t]/.test(lines[end]) || /^-(\s|$)/.test(lines[end]))) end++;
    lines.splice(start, end - start, ...rendered);
  }
  const yamlText = lines.join(eol) + (lines.length ? eol : '');
  const out = s.open + yamlText + s.close + s.body;
  // Sanity check: still valid YAML.
  YAML.parse(yamlText);
  return out;
}
