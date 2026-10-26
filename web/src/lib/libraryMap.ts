import type { LibraryMap } from '../api';
import { escapeVisualText } from './latexVisual';

export function nodeBranch(map: LibraryMap, id: string): Set<string> {
  const result = new Set([id]);
  for (const node of map.nodes) if (node.parent === id)
    for (const child of nodeBranch(map, node.id)) result.add(child);
  return result;
}

export function mapSource(map: LibraryMap): string {
  const label = (s: string) => s.replace(/[\x00-\x1f\u2028\u2029]/g, ' ').replace(/[&<>"\\]/g, c => `&#${c.charCodeAt(0)};`);
  const index = new Map(map.nodes.map((n, i) => [n.id, `n${i}`]));
  return ['flowchart TB', ...map.nodes.map((n, i) => `n${i}["${label(n.title)}"]`),
    ...map.nodes.filter(n => n.parent).map(n => `${index.get(n.parent!)} -.-> ${index.get(n.id)}`),
    ...map.links.map(l => `${index.get(l.from)} -- "${label(l.label)}" --> ${index.get(l.to)}`)].join('\n');
}

export function memoryLink(url: string, title: string): string {
  const normalized = new URL(url);
  if (!['http:', 'https:'].includes(normalized.protocol) || normalized.username || normalized.password) throw new Error('El enlace debe ser HTTP/HTTPS y no contener credenciales.');
  const target = normalized.href.replace(/[{}\\^~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/[%#&_$]/g, c => `\\${c}`);
  return `\\href{${target}}{${escapeVisualText(title)}}`;
}
