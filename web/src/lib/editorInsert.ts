import { Text, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';

export const editorViews = new Map<string, EditorView>();
export function insertAtCursor(key: string, text: string): boolean {
  const view = editorViews.get(key);
  if (!view) return false;
  const at = view.state.selection.main.head,
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
