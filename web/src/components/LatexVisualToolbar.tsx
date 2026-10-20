import { useEffect } from 'react';
import { Bold, Italic, List, ListOrdered, Redo2, Undo2 } from 'lucide-react';
import { redo, undo, isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import { editorViews } from '../lib/editorInsert';
import { visualEdit } from '../lib/latexVisual';
import { ensureRefs, useRefs } from '../state/refs';
import { toast } from '../state/ui';
import { Button, IconButton } from './ui';

export function LatexVisualToolbar({ docKey }: { docKey: string }) {
  const citations = useRefs((s) => s.data?.citas);
  useEffect(() => { void ensureRefs(); }, []);
  function format(kind: string) {
    const view = editorViews.get(docKey);
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (kind.startsWith('cite:') && !citations?.some((citation) => citation.key === kind.slice(5))) return;
    const edit = visualEdit(view.state.doc.toString(), from, to, kind);
    if (!edit) {
      toast({ kind: 'warn', text: 'Este fragmento necesita el modo Código. Selecciona texto de un párrafo o título para darle formato.' });
      return;
    }
    const { anchor, ...changes } = edit;
    view.dispatch({ changes, selection: { anchor }, annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input')] });
    view.focus();
  }
  return <div className="shrink-0 border-b border-line bg-soft px-2 py-1">
    <div role="toolbar" aria-label="Formato del documento" className="flex flex-wrap items-center gap-1" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
      <select aria-label="Tipo de párrafo" value="" onChange={(e) => format(e.target.value)} className="h-7 max-w-40 rounded border border-line bg-bg px-2 text-[12px] text-fg">
        <option value="" disabled>Párrafo / título</option><option value="paragraph">Párrafo</option><option value="chapter">Capítulo</option><option value="section">Sección</option><option value="subsection">Subsección</option><option value="subsubsection">Subsubsección</option>
      </select>
      <IconButton label="Negrita (selección)" onClick={() => format('textbf')}><Bold size={15} /></IconButton>
      <IconButton label="Cursiva (selección)" onClick={() => format('emph')}><Italic size={15} /></IconButton>
      <IconButton label="Lista con viñetas" onClick={() => format('itemize')}><List size={15} /></IconButton>
      <IconButton label="Lista numerada" onClick={() => format('enumerate')}><ListOrdered size={15} /></IconButton>
      <select aria-label="Insertar cita existente" value="" onChange={(e) => format(`cite:${e.target.value}`)} className="h-7 max-w-48 rounded border border-line bg-bg px-2 text-[12px] text-fg" disabled={!citations?.length}>
        <option value="" disabled>{citations?.length ? 'Insertar cita…' : 'Sin citas disponibles'}</option>
        {citations?.filter((citation) => /^[A-Za-z0-9_:./+-]+$/.test(citation.key)).map((citation) => <option key={citation.key} value={citation.key}>{citation.key} · {citation.titulo}</option>)}
      </select>
      <Button variant="ghost" onClick={() => { const view = editorViews.get(docKey); if (view) { undo(view); view.focus(); } }}><Undo2 size={14} />Deshacer</Button>
      <IconButton label="Rehacer" onClick={() => { const view = editorViews.get(docKey); if (view) { redo(view); view.focus(); } }}><Redo2 size={14} /></IconButton>
    </div>
    <p className="mt-1 text-[11px] text-muted">Visual básico: texto, títulos, negrita, cursiva, listas y citas. Otros comandos se conservan como código. Pegado sin formato; para pegar LaTeX, usa Código. Consulta la composición final en el PDF.</p>
  </div>;
}
