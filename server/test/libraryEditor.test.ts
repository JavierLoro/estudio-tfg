import { afterEach, expect, it } from 'vitest';
import { EditorState, EditorSelection } from '../../web/node_modules/@codemirror/state/dist/index.js';
import { history, undo } from '../../web/node_modules/@codemirror/commands/dist/index.js';
// @ts-expect-error Resolución bundler del cliente.
import { editorViews, insertAtCursor, replaceEditorContent } from '../../web/src/lib/editorInsert';
afterEach(() => editorViews.clear());
function editor(content: string) {
  const view: any = {
    state: EditorState.create({
      doc: content,
      extensions: [history(), EditorState.lineSeparator.of(content.includes('\r\n') ? '\r\n' : '\n')],
    }),
  };
  view.dispatch = (spec: any) => {
    view.state = view.state.update(spec).state;
  };
  editorViews.set('memoria:prueba.tex', view);
  return view;
}
it('insertar una cita es deshacible sin perder texto seleccionado ni el borrador previo', () => {
  const view = editor('Texto previo');
  view.dispatch({ changes: { from: 12, insert: ' y borrador' }, selection: EditorSelection.range(0, 5) });
  const before = view.state.doc.toString();
  expect(insertAtCursor('memoria:prueba.tex', '\\cite{Clave}')).toBe(true);
  expect(view.state.doc.toString()).toBe('Texto\\cite{Clave} previo y borrador');
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(before);
});
it('añadir el enlace bibliográfico conserva el cursor y CRLF; cada operación se deshace por separado', () => {
  const view = editor('Antes\r\nCursor\r\nDespués');
  view.dispatch({ selection: { anchor: 8 } });
  expect(replaceEditorContent('memoria:prueba.tex', 'Enlace\r\nAntes\r\nCursor\r\nDespués')).toBe(true);
  expect(insertAtCursor('memoria:prueba.tex', '\\cite{C}')).toBe(true);
  expect(view.state.sliceDoc()).toContain('Cu\\cite{C}rsor');
  undo(view);
  expect(view.state.sliceDoc()).toBe('Enlace\r\nAntes\r\nCursor\r\nDespués');
  undo(view);
  expect(view.state.sliceDoc()).toBe('Antes\r\nCursor\r\nDespués');
});
