// Autocompletado LaTeX de la memoria (v0.8): claves de \cite, etiquetas de \ref y siglas de \ac.

import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { RefAcronimo, RefCita, RefEtiqueta, RefEtiquetaTipo } from '../api';
import { ensureRefs } from '../state/refs';

type Kind = 'cita' | 'etiqueta' | 'acronimo';

const CITE = ['cite', 'Cite', 'textcite', 'Textcite', 'parencite', 'Parencite', 'autocite', 'Autocite', 'footcite', 'citep', 'citet', 'citealp', 'citeauthor', 'citeyear', 'nocite'];
const REF = ['ref', 'Ref', 'pageref', 'autoref', 'cref', 'Cref', 'vref', 'eqref', 'nameref'];
const AC = ['ac', 'Ac', 'acs', 'Acs', 'acl', 'Acl', 'acf', 'Acf', 'acp', 'Acp', 'acsp', 'aclp', 'acfp', 'acfi', 'acused', 'acreset'];
const KIND = new Map<string, Kind>([
  ...CITE.map((c) => [c, 'cita'] as const),
  ...REF.map((c) => [c, 'etiqueta'] as const),
  ...AC.map((c) => [c, 'acronimo'] as const),
]);

/** `\cmd[…][…]{k1, k2, parcial` justo antes del cursor. */
const ARG_RE = /\\([A-Za-z]+)(\*?)(?:\s*\[[^\]\n]*\]){0,2}\s*\{([^{}\n]*)$/;

export interface ArgContext {
  kind: Kind;
  /** Clave que se está escribiendo (sin espacios iniciales). */
  query: string;
  /** Posición donde empieza dentro de la línea. */
  offset: number;
}

/** Dónde está el cursor dentro del argumento de un comando de citas/referencias/acrónimos. */
export function argContext(before: string): ArgContext | null {
  const m = ARG_RE.exec(before);
  if (!m) return null;
  const kind = KIND.get(m[1]);
  if (!kind) return null;
  const arg = m[3];
  const comma = arg.lastIndexOf(',');
  const cur = arg.slice(comma + 1);
  const lead = cur.length - cur.trimStart().length;
  return { kind, query: cur.trimStart(), offset: before.length - cur.length + lead };
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Puntuación: 0 = no coincide; mayor = mejor (prefijo de clave > clave > título/autor). */
function score(q: string, primary: string, others: string[]): number {
  if (!q) return 1;
  const p = norm(primary);
  if (p.startsWith(q)) return 4;
  if (p.includes(q)) return 3;
  const o = others.map(norm);
  if (o.some((x) => x.startsWith(q))) return 2.5;
  if (o.some((x) => x.includes(q))) return 2;
  return 0;
}

const TIPO_LABEL: Record<RefEtiquetaTipo, string> = {
  capitulo: 'capítulo',
  seccion: 'sección',
  figura: 'figura',
  tabla: 'tabla',
  listado: 'listado',
  ecuacion: 'ecuación',
  anexo: 'anexo',
  otro: 'etiqueta',
};

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function infoNode(lines: string[]): () => Node {
  return () => {
    const d = document.createElement('div');
    d.className = 'et-cm-info';
    lines.filter(Boolean).forEach((l, i) => {
      const p = document.createElement('div');
      if (i === 0) p.className = 'et-cm-info-title';
      p.textContent = l;
      d.appendChild(p);
    });
    return d;
  };
}

function citaOption(c: RefCita): Completion {
  const detail = [c.titulo, c.autor, c.anio].filter(Boolean).join(' · ');
  return { label: c.key, detail: short(detail, 70), type: 'cita', info: infoNode([c.titulo || c.key, [c.autor, c.anio].filter(Boolean).join(', '), `@${c.tipo} · ${c.archivo}`]) };
}
function etiquetaOption(e: RefEtiqueta): Completion {
  return {
    label: e.label,
    detail: short([TIPO_LABEL[e.tipo], e.texto].filter(Boolean).join(': '), 70),
    type: 'etiqueta-' + e.tipo,
    info: infoNode([e.texto || e.label, TIPO_LABEL[e.tipo], `${e.archivo}:${e.linea}`]),
  };
}
function acronimoOption(a: RefAcronimo): Completion {
  return { label: a.sigla, detail: short(a.significado, 70), type: 'acronimo', info: infoNode([a.sigla, a.significado, `${a.archivo}:${a.linea}`]) };
}

async function source(ctx: CompletionContext): Promise<CompletionResult | null> {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const a = argContext(line.text.slice(0, ctx.pos - line.from));
  if (!a) return null;
  const data = await ensureRefs();
  if (!data || ctx.aborted) return null;
  const q = norm(a.query);
  const rank = <T,>(items: T[], f: (x: T) => [string, string[]]) =>
    items
      .map((x) => ({ x, s: score(q, ...f(x)) }))
      .filter((r) => r.s > 0)
      .sort((p, r) => r.s - p.s)
      .slice(0, 200)
      .map((r) => r.x);
  let options: Completion[];
  if (a.kind === 'cita') options = rank(data.citas, (c) => [c.key, [c.titulo, c.autor]]).map(citaOption);
  else if (a.kind === 'etiqueta') options = rank(data.etiquetas, (e) => [e.label, [e.texto]]).map(etiquetaOption);
  else options = rank(data.acronimos, (x) => [x.sigla, [x.significado]]).map(acronimoOption);
  if (!options.length) return null;
  // Se filtra aquí (por clave, título o autor), no con el filtro por prefijo de CodeMirror.
  return { from: line.from + a.offset, options, filter: false };
}

const BADGE: Record<string, string> = {
  cita: '“',
  acronimo: 'A',
  'etiqueta-capitulo': '§',
  'etiqueta-seccion': '§',
  'etiqueta-anexo': '§',
  'etiqueta-figura': 'F',
  'etiqueta-tabla': 'T',
  'etiqueta-listado': '{}',
  'etiqueta-ecuacion': '∑',
  'etiqueta-otro': '#',
};

const theme = EditorView.theme({
  '.cm-tooltip.cm-tooltip-autocomplete': { padding: '3px', fontSize: '12.5px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '16em', maxWidth: '38em' },
  '.cm-tooltip-autocomplete ul li': { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px', color: 'var(--et-fg)', borderRadius: '4px', lineHeight: '1.4' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--et-active)', color: 'var(--et-fg)' },
  '.cm-tooltip-autocomplete .cm-completionLabel': { flex: 'none', fontWeight: '600' },
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginLeft: '4px',
    fontStyle: 'normal',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    color: 'var(--et-muted)',
  },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--et-accent)' },
  '.cm-tooltip.cm-completionInfo': {
    padding: '6px 10px',
    maxWidth: '22em',
    color: 'var(--et-fg)',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    fontSize: '12.5px',
  },
  '.et-cm-info': { display: 'flex', flexDirection: 'column', gap: '2px' },
  '.et-cm-info-title': { fontWeight: '600' },
  '.et-cm-info > div:not(.et-cm-info-title)': { color: 'var(--et-muted)', fontSize: '11.5px', wordBreak: 'break-word' },
  '.et-cm-badge': {
    flex: 'none',
    minWidth: '1.6em',
    textAlign: 'center',
    borderRadius: '4px',
    padding: '0 3px',
    fontSize: '10.5px',
    fontWeight: '700',
    lineHeight: '1.5',
    backgroundColor: 'var(--et-bg-sunken)',
    color: 'var(--et-accent)',
    border: '1px solid var(--et-border)',
  },
});

/** Autocompletado para los .tex de la memoria. */
export function latexCompletion(): Extension {
  return [
    autocompletion({
      override: [source],
      icons: false,
      activateOnTyping: true,
      addToOptions: [
        {
          position: 10,
          render: (c) => {
            const b = document.createElement('span');
            b.className = 'et-cm-badge';
            b.textContent = BADGE[c.type ?? ''] ?? '#';
            return b;
          },
        },
      ],
    }),
    theme,
  ];
}

/** Solo los .tex de la memoria (no las notas ni otros archivos). */
export function wantsLatexCompletion(key: string): boolean {
  return /^memoria:.*\.tex$/i.test(key);
}
