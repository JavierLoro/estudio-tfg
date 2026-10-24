import { Text, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';

export const editorViews = new Map<string, EditorView>();

/** Los contenidos de Biblioteca van dentro del documento, conservando los offsets de sus comentarios. */
export function bodyInsertionPosition(source: string, at: number): number {
  const clean = source.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g,
    (match, prefix: string, slashes: string) => prefix + slashes + ' '.repeat(match.length - prefix.length - slashes.length));
  // shortcut: delimitadores literales sin expandir macros; ampliar junto al analizador LaTeX si se admiten delimitadores generados.
  const begin = /\\begin\s*\{\s*document\s*\}/.exec(clean), end = /\\end\s*\{\s*document\s*\}/.exec(clean);
  const first = begin ? begin.index + begin[0].length : 0, last = end?.index ?? source.length;
  return Math.max(first, Math.min(at, last));
}

export function insertAtCursor(key: string, text: string, position?: number): boolean {
  const view = editorViews.get(key);
  if (!view) return false;
  const requested = position ?? view.state.selection.main.head,
    at = key.endsWith('.tex') ? bodyInsertionPosition(view.state.doc.toString(), requested) : requested,
    insert = Text.of(text.replace(/\r\n/g, '\n').split('\n'));
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input')],
  });
  return true;
}
export function replaceEditorContent(key: string, content: string): boolean {
  const view = editorViews.get(key);
  if (!view) return false;
  const before = view.state.doc.toString(),
    after = content.replace(/\r\n/g, '\n');
  let from = 0,
    tail = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  while (tail < before.length - from && tail < after.length - from && before[before.length - tail - 1] === after[after.length - tail - 1])
    tail++;
  if (from === before.length && from === after.length) return true;
  view.dispatch({
    changes: { from, to: before.length - tail, insert: Text.of(after.slice(from, after.length - tail).split('\n')) },
    annotations: isolateHistory.of('full'),
  });
  return true;
}
