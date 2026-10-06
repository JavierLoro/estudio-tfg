import type { Root } from '../api';

export const TEXT_EXTS = new Set([
  'md', 'tex', 'bib', 'sty', 'cls', 'txt', 'mmd', 'bst', 'json', 'yml', 'yaml', 'c', 'py', 'ts', 'js', 'csv',
]);

export function ext(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function isText(path: string): boolean {
  return TEXT_EXTS.has(ext(path));
}

/** Normaliza una ruta relativa: resuelve `.` y `..` sin salir de la raíz. */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function join(dir: string, rel: string): string {
  return normalize(dir ? `${dir}/${rel}` : rel);
}

export type PanelKind = 'latex' | 'note' | 'external';

/** Qué panel abre un archivo según raíz y extensión. */
export function panelKindFor(root: Root, path: string): PanelKind {
  if (!isText(path)) return 'external';
  if (root === 'memoria') return 'latex';
  return 'note';
}

export const docKey = (root: Root, path: string) => `${root}:${path}`;

export function parseDocKey(key: string): { root: Root; path: string } {
  const i = key.indexOf(':');
  return { root: key.slice(0, i) as Root, path: key.slice(i + 1) };
}

export function formatDate(value: string | number | undefined | null): string {
  if (value == null || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDay(value: string | number | undefined | null): string {
  if (value == null || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
