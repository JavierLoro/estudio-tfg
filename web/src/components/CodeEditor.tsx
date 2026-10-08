import { useEffect, useRef } from 'react';
import { shortcutFor } from '../lib/shortcuts';
import { Annotation, Compartment, EditorSelection, EditorState, Prec, Text } from '@codemirror/state';
import { Decoration, EditorView, keymap } from '@codemirror/view';
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { StateEffect, StateField } from '@codemirror/state';
import { latexCompletion, wantsLatexCompletion } from '../lib/latexComplete';
import { eolOf } from '../lib/eol';
import { baseExtensions, languageExtension, type EditorLang } from '../lib/editor';
import { setContent, useDocs } from '../state/docs';
import { setCursorLine, useCursor } from '../state/cursor';

export interface LineDiagnostic {
  line: number | null;
  severity: 'error' | 'warning';
  message: string;
}

interface Props {
  docKey: string;
  lang: EditorLang;
  lineNumbers?: boolean;
  className?: string;
  onSave?: () => void;
  onSaveCompile?: () => void;
  /** «Ver en PDF» con la línea del cursor. */
  onShowInPdf?: (line: number) => void;
  diagnostics?: LineDiagnostic[];
  /** Avisa de la vista de CodeMirror (null al destruirla), p. ej. para deshacer desde fuera. */
  onView?: (view: EditorView | null) => void;
}

/** Marca de transacciones que vienen del store (no deben volver a escribirse en él). */
const External = Annotation.define<boolean>();

// Resaltado breve de la línea a la que se salta.
const flashEffect = StateEffect.define<number | null>();
const flashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        deco = e.value == null ? Decoration.none : Decoration.set([Decoration.line({ class: 'et-flash' }).range(e.value)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function toCmDiagnostics(state: EditorState, diags: LineDiagnostic[] | undefined): CmDiagnostic[] {
  if (!diags) return [];
  const out: CmDiagnostic[] = [];
  for (const d of diags) {
    const n = Math.min(Math.max(d.line ?? 1, 1), state.doc.lines);
    const line = state.doc.line(n);
    // Subrayar desde el primer carácter no blanco.
    const text = line.text;
    const lead = text.length - text.trimStart().length;
    out.push({ from: line.from + lead, to: line.to, severity: d.severity, message: d.message, source: 'LaTeX' });
  }
  return out;
}

export function CodeEditor({ docKey, lang, lineNumbers = true, className, onSave, onSaveCompile, onShowInPdf, diagnostics, onView }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const separator = useRef(new Compartment());
  const cb = useRef({ onSave, onSaveCompile, onShowInPdf, onView });
  cb.current = { onSave, onSaveCompile, onShowInPdf, onView };
  const diagRef = useRef(diagnostics);
  diagRef.current = diagnostics;

  const ready = useDocs((s) => s.docs[docKey]?.status === 'ready');
  const extVersion = useDocs((s) => s.docs[docKey]?.extVersion ?? 0);
  const reveal = useDocs((s) => s.reveal[docKey]);

  // Crear la vista cuando el documento está listo.
  useEffect(() => {
    if (!ready || !host.current) return;
    const doc = useDocs.getState().docs[docKey];
    if (!doc) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.content,
        extensions: [
          separator.current.of(EditorState.lineSeparator.of(eolOf(doc.content))),
          Prec.highest(
            keymap.of([
              { key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave?.(), true) },
              { key: 'Mod-Enter', preventDefault: true, run: () => ((cb.current.onSaveCompile ?? cb.current.onSave)?.(), true) },
              {
                key: shortcutFor('showInPdf'),
                preventDefault: true,
                run: (v) => {
                  if (!cb.current.onShowInPdf) return false;
                  cb.current.onShowInPdf(v.state.doc.lineAt(v.state.selection.main.head).number);
                  return true;
                },
              },
            ]),
          ),
          baseExtensions({ lineNumbers }),
          languageExtension(lang),
          wantsLatexCompletion(docKey) ? latexCompletion() : [],
          flashField,
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) setCursorLine(docKey, u.state.doc.lineAt(u.state.selection.main.head).number);
            if (!u.docChanged) return;
            if (u.transactions.some((tr) => tr.annotation(External))) return;
            setContent(docKey, u.state.sliceDoc());
          }),
        ],
      }),
    });
    viewRef.current = view;
    cb.current.onView?.(view);
    // Al remontar el editor (p. ej. tras mover el archivo) se vuelve a la línea del cursor.
    const savedLine = useCursor.getState().lines[docKey];
    if (savedLine && savedLine > 1) {
      const pos = view.state.doc.line(Math.min(savedLine, view.state.doc.lines)).from;
      view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    }
    if (diagRef.current?.length) view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state, diagRef.current)));
    return () => {
      view.destroy();
      viewRef.current = null;
      cb.current.onView?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, docKey, lang, lineNumbers]);

  // Sincronizar cuando el contenido cambia desde fuera (recarga, borrador, conflicto).
  useEffect(() => {
    const view = viewRef.current;
    const doc = useDocs.getState().docs[docKey];
    if (!view || !doc) return;
    const cur = view.state.sliceDoc();
    if (cur === doc.content) return;
    const nl = eolOf(doc.content);
    const text = Text.of(doc.content.split(nl));
    const head = Math.min(view.state.selection.main.head, text.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      effects: separator.current.reconfigure(EditorState.lineSeparator.of(nl)),
      selection: EditorSelection.cursor(head),
      annotations: External.of(true),
    });
  }, [extVersion, docKey]);

  // Diagnósticos de la última compilación.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state, diagnostics)));
  }, [diagnostics, ready]);

  // Ir a línea.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal) return;
    const n = Math.min(Math.max(reveal.line, 1), view.state.doc.lines);
    const line = view.state.doc.line(n);
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: [EditorView.scrollIntoView(line.from, { y: 'center' }), flashEffect.of(line.from)],
    });
    view.focus();
    const t = setTimeout(() => viewRef.current?.dispatch({ effects: flashEffect.of(null) }), 1200);
    return () => clearTimeout(t);
  }, [reveal, ready]);

  return <div ref={host} className={className ?? 'h-full min-h-0 overflow-hidden'} />;
}

/** Visor de solo lectura (para «Ver ambos»). */
export function ReadOnlyEditor({ content, lang }: { content: string; lang: EditorLang }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: content, extensions: [EditorState.lineSeparator.of(eolOf(content)), baseExtensions({ lineNumbers: true, readOnly: true }), languageExtension(lang)] }),
    });
    return () => view.destroy();
  }, [content, lang]);
  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
