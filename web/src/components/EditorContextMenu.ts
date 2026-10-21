import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { useDocs } from '../state/docs';
import { toast } from '../state/ui';
import { openContextMenu, type MenuItem } from './ContextMenu';
import { assistantContextActions } from './AssistantContextActions';

export function editorContextMenu(view: EditorView, docKey: string, at: { clientX: number; clientY: number; preventDefault: () => void }, actions: { onSave?: () => void; onShowInPdf?: (line: number) => void }) {
  const doc = useDocs.getState().docs[docKey];
  if (!doc) return;
  const state = view.state, selection = state.selection.main;
  const selected = !selection.empty, diagram = /\.mmd$/i.test(doc.path);
  const subject = selected ? 'la selección' : diagram ? 'el diagrama' : /\.bib$/i.test(doc.path) ? 'la bibliografía' : doc.root === 'notes' ? 'la nota' : /\.tex$/i.test(doc.path) ? 'el documento LaTeX' : 'el documento';
  const context = { root: doc.root, path: doc.path, text: selected ? state.sliceDoc(selection.from, selection.to) : state.sliceDoc(), selection: selected };
  const valid = () => {
    if (view.state.doc !== state.doc || !view.state.selection.eq(state.selection)) {
      toast({ kind: 'warn', text: 'El texto o la selección han cambiado. Vuelve a abrir el menú.' }); return false;
    }
    return true;
  };
  const clipboard = (command: 'copy' | 'cut' | 'paste') => {
    void (async () => {
      try {
        const text = command === 'paste' ? await navigator.clipboard.readText() : null;
        if (!valid()) return;
        view.focus();
        if (text !== null) {
          const data = new DataTransfer(); data.setData('text/plain', text);
          view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        } else if (!document.execCommand(command)) throw new Error();
      } catch { toast({ kind: 'error', text: 'No se pudo acceder al portapapeles. Usa el atajo de copiar, cortar o pegar del sistema.' }); }
    })();
  };
  const items: MenuItem[] = [
    { label: 'Deshacer', disabled: !undoDepth(state), run: () => { if (valid()) undo(view); } },
    { label: 'Rehacer', disabled: !redoDepth(state), run: () => { if (valid()) redo(view); } },
    { label: 'Copiar', disabled: !selected, run: () => clipboard('copy') },
    { label: 'Cortar', disabled: !selected || state.readOnly, run: () => clipboard('cut') },
    { label: 'Pegar', disabled: state.readOnly, run: () => clipboard('paste') },
    { label: 'Seleccionar todo', run: () => { if (valid()) selectAll(view); } },
    ...(actions.onSave ? [{ label: 'Guardar', run: () => { if (valid()) actions.onSave?.(); } }] : []),
    ...(actions.onShowInPdf ? [{ label: 'Ver esta línea en PDF', run: () => { if (valid()) actions.onShowInPdf?.(state.doc.lineAt(selection.head).number); } }] : []),
    ...assistantContextActions(context, subject, !diagram && /\.(tex|md|bib)$/i.test(doc.path)),
  ];
  view.focus();
  openContextMenu(at, items, selected ? `Texto seleccionado · ${diagram ? 'Mermaid' : doc.root === 'notes' ? 'Notas' : 'Memoria'}` : diagram ? 'Código del diagrama' : doc.root === 'notes' ? 'Nota' : 'Memoria');
}
