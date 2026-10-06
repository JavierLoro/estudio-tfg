import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap, search } from '@codemirror/search';
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter } from '@codemirror/lint';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { markdown } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { ext } from './paths';

/** Colores mediante variables CSS: el editor sigue el tema claro/oscuro sin reconfigurar. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.tagName, t.function(t.variableName), t.macroName], color: 'var(--syn-command)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.atom], color: 'var(--syn-number)' },
  { tag: [t.bracket, t.squareBracket, t.brace, t.paren], color: 'var(--syn-bracket)' },
  { tag: [t.heading, t.heading1, t.heading2], color: 'var(--syn-heading)', fontWeight: '700' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--syn-heading)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--syn-link)' },
  { tag: [t.meta, t.processingInstruction, t.typeName], color: 'var(--syn-meta)' },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: 'var(--syn-command)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)' },
  { tag: t.quote, color: 'var(--et-muted)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--et-bg)', color: 'var(--et-fg)' },
  '.cm-content': { caretColor: 'var(--et-accent)', padding: '8px 0 40vh' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--et-accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--cm-selection)' },
  '.cm-activeLine': { backgroundColor: 'var(--cm-active-line)' },
  '.cm-gutters': {
    backgroundColor: 'var(--et-bg)',
    color: 'var(--et-faint)',
    border: 'none',
    borderRight: '1px solid var(--et-border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--cm-active-line)', color: 'var(--et-muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px', fontSize: '11.5px' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--et-faint)' },
  '.cm-panels': { backgroundColor: 'var(--et-bg-soft)', color: 'var(--et-fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--et-border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--et-border)' },
  '.cm-search': { fontSize: '12px', padding: '4px 8px' },
  '.cm-search input, .cm-search button, .cm-search label': { fontSize: '12px' },
  '.cm-textfield': {
    backgroundColor: 'var(--et-bg)',
    border: '1px solid var(--et-border-strong)',
    borderRadius: '4px',
    color: 'var(--et-fg)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--et-bg)',
    border: '1px solid var(--et-border-strong)',
    borderRadius: '4px',
    color: 'var(--et-fg)',
  },
  '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.3)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(250, 204, 21, 0.6)' },
  '.cm-selectionMatch': { backgroundColor: 'rgba(250, 204, 21, 0.15)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--cm-selection)', outline: 'none' },
  '.cm-tooltip': {
    backgroundColor: 'var(--et-bg)',
    border: '1px solid var(--et-border-strong)',
    borderRadius: '6px',
    boxShadow: 'var(--et-shadow)',
  },
  '.cm-diagnostic': { fontSize: '12px' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--et-danger)' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--et-warn)' },
  '.cm-line.et-flash': { backgroundColor: 'var(--et-active)', transition: 'background-color .6s' },
});

export type EditorLang = 'stex' | 'markdown' | 'plain';

export function langFor(path: string): EditorLang {
  const e = ext(path);
  if (['tex', 'sty', 'cls', 'bib', 'bst'].includes(e)) return 'stex';
  if (e === 'md') return 'markdown';
  return 'plain';
}

const stexLang = StreamLanguage.define(stex);

export function languageExtension(lang: EditorLang): Extension {
  if (lang === 'stex') return stexLang;
  if (lang === 'markdown') return markdown();
  return [];
}

/** Extensiones comunes a todos los editores. */
export function baseExtensions(opts: { lineNumbers: boolean; readOnly?: boolean }): Extension[] {
  return [
    opts.lineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : [],
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(highlight),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorView.lineWrapping,
    lintGutter(),
    theme,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    opts.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
  ];
}
