import { isolateHistory } from '@codemirror/commands';
import { EditorState, Prec, StateEffect, StateField, Transaction, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, showPanel, type DecorationSet } from '@codemirror/view';
import { escapeVisualText, visualClipboard, visualLines, visualRange } from './latexVisual';

class Label extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: Label) { return this.text === other.text; }
  toDOM() { const span = document.createElement('span'); span.textContent = this.text; span.className = 'et-visual-label'; return span; }
}

function decorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const line of visualLines(state.doc.toString())) {
    ranges.push(Decoration.line({ class: `et-visual-${line.kind}${line.level ? ` et-visual-h${line.level}` : ''}`, ...(line.kind === 'item' ? { attributes: { style: `padding-left: ${24 + (line.indent ?? 0) * 20}px` } } : {}), ...(line.kind === 'code' ? { attributes: { 'data-label': 'LaTeX · código conservado' } } : {}) }).range(line.from));
    if (line.kind === 'code') continue;
    if (line.kind === 'structure' && line.to > line.from) {
      const source = state.doc.sliceString(line.from, line.to);
      const name = source.includes('itemize') ? 'lista con viñetas' : source.includes('enumerate') ? 'lista numerada' : 'documento';
      ranges.push(Decoration.replace({ widget: new Label(`${source.includes('begin') ? 'Inicio de' : 'Fin de'} ${name}`), atomic: true }).range(line.from, line.to));
    }
    for (const span of line.spans) {
      if (span.to <= span.from) continue;
      if (span.kind === 'hidden') ranges.push(Decoration.replace({ atomic: true }).range(span.from, span.to));
      else if (span.kind === 'citation' || span.kind === 'literal') ranges.push(Decoration.replace({ widget: new Label(span.text!), atomic: true }).range(span.from, span.to));
      else ranges.push(Decoration.mark({ class: `et-visual-${span.kind}` }).range(span.from, span.to));
    }
    if (line.kind === 'item') ranges.push(Decoration.widget({ widget: new Label(line.bullet ?? '• '), side: 1 }).range(line.body));
  }
  return Decoration.set(ranges, true);
}

const presentation = StateField.define<DecorationSet>({
  create: decorations,
  update: (value, tr) => tr.docChanged ? decorations(tr.state) : value,
  provide: (field) => EditorView.decorations.from(field),
});

const rejectedEdit = StateEffect.define<string>();
const rejectionMessage = 'No se ha cambiado el texto: esta edición atraviesa formato LaTeX. Usa Código para realizarla.';
const feedback = StateField.define<string | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(rejectedEdit)) return effect.value;
    return tr.docChanged ? null : value;
  },
  provide: (field) => showPanel.from(field, (message) => message ? () => {
    const dom = document.createElement('div');
    dom.className = 'border-b border-warn/30 bg-warn-bg px-3 py-2 text-[12px] text-warn';
    dom.setAttribute('role', 'status');
    dom.textContent = message;
    return { dom, top: true };
  } : null),
});

function clipboardText(text: string, state: EditorState): string {
  const source = state.doc.toString();
  const selections = state.selection.ranges.filter((range) => !range.empty);
  if (selections.length) {
    const combined = selections.map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak);
    if (combined === text) return selections.map((range) => visualClipboard(source, range.from, range.to)).join(state.lineBreak);
    const main = state.selection.main;
    if (state.sliceDoc(main.from, main.to) === text) return visualClipboard(source, main.from, main.to);
  } else {
    const lines = [...new Set(state.selection.ranges.map((range) => state.doc.lineAt(range.from).number))].map((number) => state.doc.line(number));
    if (lines.map((line) => line.text).join(state.lineBreak) === text) return lines.map((line) => visualClipboard(source, line.from, line.to)).join(state.lineBreak);
  }
  // Un widget arrastrado puede tener su propio rango, distinto de la selección.
  return visualClipboard(text);
}

function visualInput(state: EditorState, from: number, to: number): boolean {
  const lines = visualLines(state.doc.toString());
  return lines.filter((line) => line.to >= from && line.from <= to).every((line) => line.kind !== 'code' && line.kind !== 'structure');
}

function deleteVisualSelection(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (selection.empty) return false;
  const range = visualRange(view.state.doc.toString(), selection.from, selection.to);
  if (range.from === selection.from && range.to === selection.to) return false;
  view.dispatch({ changes: { ...range, insert: '' }, selection: { anchor: range.from }, userEvent: 'delete.selection' });
  return true;
}

function normalizedClipboard(event: ClipboardEvent, view: EditorView): boolean {
  const selection = view.state.selection.main;
  const range = visualRange(view.state.doc.toString(), selection.from, selection.to);
  if (!event.clipboardData || range.from === selection.from && range.to === selection.to) return false;
  if (event.type === 'paste') {
    const insert = escapeVisualText(event.clipboardData.getData('text/plain'));
    view.dispatch({ changes: { ...range, insert }, selection: { anchor: range.from + insert.length }, userEvent: 'input.paste' });
  } else {
    event.clipboardData.setData('text/plain', visualClipboard(view.state.doc.toString(), range.from, range.to));
    if (event.type === 'cut') view.dispatch({ changes: { ...range, insert: '' }, selection: { anchor: range.from }, userEvent: 'delete.cut' });
  }
  event.preventDefault();
  return true;
}

export function latexVisualEditor(): Extension {
  return [presentation, feedback,
    EditorState.transactionFilter.of((tr) => {
      // Biblioteca y otros insertadores ya proporcionan fuentes LaTeX completas.
      if (tr.annotation(isolateHistory) || !tr.docChanged || !(tr.isUserEvent('input') || tr.isUserEvent('delete'))) return tr;
      const before = visualLines(tr.startState.doc.toString()), after = visualLines(tr.newDoc.toString());
      let safe = true;
      tr.changes.iterChangedRanges((from, to, newFrom, newTo) => {
        const original = before.filter((line) => line.to >= from && line.from <= to);
        if (original.every((line) => line.kind === 'code')) return;
        if (after.some((line) => line.to >= newFrom && line.from <= newTo && line.kind === 'code')) safe = false;
      });
      return safe ? tr : { effects: [rejectedEdit.of(rejectionMessage), EditorView.announce.of(rejectionMessage)], annotations: Transaction.addToHistory.of(false) };
    }),
    Prec.highest(keymap.of([{ key: 'Enter', run: (view) => {
      const { from, to } = view.state.selection.main;
      const line = visualLines(view.state.doc.toString()).find((item) => item.from <= from && item.to >= to);
      if (!line || line.kind === 'code' || line.kind === 'structure') return false;
      let start = from, end = to, insert = '\n\n';
      if (line.kind === 'item') {
        insert = '\n\\item ';
        if (!view.state.doc.sliceString(line.body, line.to).trim()) {
          const next = view.state.doc.lineAt(Math.min(line.to + 1, view.state.doc.length));
          if (/^\s*\\end\{(?:itemize|enumerate)\}\s*$/.test(next.text)) {
            start = line.from; end = next.to < view.state.doc.length ? next.to + 1 : next.to;
            insert = `${next.text}\n\n`;
          }
        }
      }
      if (line.kind === 'heading') {
        if (from < line.bodyEnd || from !== to) return false;
        start = end = line.to;
      }
      view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: start + insert.length }, userEvent: 'input' });
      return true;
    } }, { key: 'Backspace', run: deleteVisualSelection }, { key: 'Delete', run: deleteVisualSelection }])),
    EditorView.atomicRanges.of((view) => {
      const ranges: Range<Decoration>[] = [];
      view.state.field(presentation).between(0, view.state.doc.length, (from, to, decoration) => {
        if (decoration.spec.atomic) ranges.push(Decoration.mark({}).range(from, to));
      });
      return Decoration.set(ranges, true);
    }),
    EditorView.contentAttributes.of({ 'aria-label': 'Editor visual de LaTeX' }),
    EditorView.editorAttributes.of({ class: 'et-latex-visual' }),
    EditorView.inputHandler.of((view, from, to, text) => {
      if (!visualInput(view.state, from, to)) return false;
      const range = visualRange(view.state.doc.toString(), from, to);
      if (range.from === from && range.to === to && !/[\\{}%$&#_^~]/.test(text)) return false;
      ({ from, to } = range);
      const insert = escapeVisualText(text);
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.type' });
      return true;
    }),
    EditorView.domEventHandlers({ paste: normalizedClipboard, copy: normalizedClipboard, cut: normalizedClipboard }),
    EditorView.clipboardOutputFilter.of(clipboardText),
    EditorView.clipboardInputFilter.of((text, state) => {
      const { from, to } = state.selection.main;
      return visualInput(state, from, to) ? escapeVisualText(text) : text;
    }),
  ];
}
