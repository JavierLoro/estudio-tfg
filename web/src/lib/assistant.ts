import type { Root } from '../api.ts';

export interface AssistantContext { root: Root; path: string; text?: string; selection?: boolean }
export interface AssistantScope { memoria: boolean; library: boolean; notes: string[]; diagrams?: boolean; attachments?: boolean; prepareChanges?: boolean; documents?: { root: Root; path: string }[] }

const under = (path: string, dir: string) => !dir || path === dir || path.startsWith(dir + '/');
export const binaryContext = (path: string) => /\.(pdf|png|jpe?g|webp)$/i.test(path);

// Orienta la interfaz; el servidor vuelve a validar alcance, rutas y enlaces.
export function contextAllowed(scope: AssistantScope, doc: AssistantContext, resources: string) {
  if (binaryContext(doc.path) && !scope.attachments) return false;
  if (scope.documents?.some(d => d.root === doc.root && d.path === doc.path)) return true;
  if (doc.root === 'memoria') return /\.mmd$/i.test(doc.path) ? !!scope.diagrams : scope.memoria;
  return under(doc.path, resources.replaceAll('\\', '/')) ? scope.library : scope.notes.some(dir => under(doc.path, dir));
}

export function attachedScope(context: AssistantContext[], prepareChanges: boolean): AssistantScope {
  return { memoria: false, library: false, notes: [], diagrams: false, attachments: context.some(c => binaryContext(c.path)), prepareChanges,
    documents: context.map(({ root, path }) => ({ root, path })).filter((d, i, all) => all.findIndex(other => other.root === d.root && other.path === d.path) === i) };
}

/** Fragmento diferente, conservando literalmente el texto y los saltos de línea. */
// shortcut: agrupa cambios dispersos en un bloque; usar diff por líneas si se necesita revisión por cada cambio.
export function changedLines(before: string, after: string) {
  const a = before.match(/[^\n]*\n|[^\n]+$/g) ?? [], b = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return { before: a.slice(start, endA).join(''), after: b.slice(start, endB).join(''), line: start + 1, removed: endA - start, added: endB - start };
}
