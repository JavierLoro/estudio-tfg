// Vista Documento (v0.3): árbol de la memoria en orden del PDF.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookMarked,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  Ellipsis,
  ListTodo,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { api, errorMessage, FieldError, type NewSectionKind, type OutlineItem } from '../api';
import { docKey } from '../lib/paths';
import { load, save } from '../lib/storage';
import { useCursor } from '../state/cursor';
import { compactWords, createSection, outlineLabel, useOutline } from '../state/outline';
import { flattenTree, toast, useUI } from '../state/ui';
import { openFile, useActivePanel } from '../state/workspace';
import { openContextMenu, type MenuItem } from './ContextMenu';
import { showInPdf, useActiveOutlineId, usePdfView } from '../state/synctex';
import { fold, highlight } from './SearchView';
import { ALT, Button, Empty, Modal, Spinner, cx } from './ui';

// ---- Nodos de presentación ----

interface Node {
  key: string;
  /** null = grupo sintético («Partes iniciales», «Anexos»). */
  item: OutlineItem | null;
  kind: OutlineItem['kind'] | 'group';
  title: string;
  number: string | null;
  words: number;
  warnings: string[];
  enabled: boolean;
  children: Node[];
}

const toNode = (it: OutlineItem): Node => ({
  key: it.id,
  item: it,
  kind: it.kind,
  title: it.title || DEFAULT_TITLES[it.kind] || '(sin título)',
  number: it.number,
  words: it.words,
  warnings: it.warnings,
  enabled: it.enabled,
  children: it.children.map(toNode),
});

const DEFAULT_TITLES: Partial<Record<OutlineItem['kind'], string>> = {
  datos: 'Datos del TFG',
  bibliography: 'Bibliografía',
};

function group(key: string, title: string, items: OutlineItem[]): Node {
  const children = items.map(toNode);
  return {
    key,
    item: null,
    kind: 'group',
    title,
    number: null,
    words: children.reduce((n, c) => n + c.words, 0),
    warnings: [],
    enabled: children.some((c) => c.enabled),
    children,
  };
}

/** Agrupa las partes iniciales y los anexos consecutivos del primer nivel. */
function buildNodes(items: OutlineItem[]): Node[] {
  const out: Node[] = [];
  let i = 0;
  while (i < items.length) {
    const kind = items[i].kind;
    if (kind === 'frontmatter' || kind === 'appendix') {
      let j = i;
      while (j < items.length && items[j].kind === kind) j++;
      const run = items.slice(i, j);
      // Un único elemento con hijos ya es un grupo en sí.
      if (run.length === 1 && run[0].children.length > 0 && kind === 'frontmatter') out.push(toNode(run[0]));
      else out.push(group(`group:${kind}:${i}`, kind === 'frontmatter' ? 'Partes iniciales' : 'Anexos', run));
      i = j;
    } else {
      out.push(toNode(items[i]));
      i++;
    }
  }
  return out;
}

const EXP_KEY = 'et:outline-expanded';

function defaultExpanded(n: Node): boolean {
  if (n.kind === 'group') return n.key.startsWith('group:appendix');
  return n.kind === 'chapter' || n.kind === 'appendix';
}

interface Row {
  node: Node;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  parent: string | null;
}

// ---- Avisos ----

function WarningIcon({ w }: { w: string }) {
  const k = fold(w);
  if (k.includes('vacio'))
    return (
      <span title="Vacío: menos de 30 palabras" aria-label="Vacío" className="shrink-0 text-faint">
        <CircleDashed size={11} />
      </span>
    );
  if (k.includes('todo'))
    return (
      <span title="Tiene TODO pendientes" aria-label="TODO" className="shrink-0 text-warn">
        <ListTodo size={12} />
      </span>
    );
  if (k.includes('error'))
    return (
      <span title="La última compilación tiene diagnósticos aquí" aria-label="Errores" className="shrink-0 text-danger">
        <AlertCircle size={12} />
      </span>
    );
  return (
    <span title={w} aria-label={w} className="shrink-0 text-warn">
      <AlertTriangle size={12} />
    </span>
  );
}

// ---- Bibliografía: número de referencias ----

function useBibCount(item: OutlineItem | null, generatedAt: string): number | null {
  const tree = useUI((s) => s.trees.memoria);
  const known = typeof item?.entries === 'number' ? item.entries : null;
  const bib = useMemo(() => {
    if (!item || known != null) return null;
    if (/\.bib$/i.test(item.file)) return item.file;
    const all = flattenTree(tree).filter((p) => /\.bib$/i.test(p));
    return all.find((p) => !p.includes('/')) ?? all[0] ?? null;
  }, [item, tree, known]);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!bib) {
      setCount(null);
      return;
    }
    let alive = true;
    api
      .readFile('memoria', bib)
      .then((f) => {
        if (!alive) return;
        const n = (f.content.match(/^[ \t]*@(?!comment\b|string\b|preamble\b)[a-z]+\s*[{(]/gim) ?? []).length;
        setCount(n);
      })
      .catch(() => alive && setCount(null));
    return () => {
      alive = false;
    };
  }, [bib, generatedAt]);
  return known ?? count;
}

// ---- Diálogo «Nuevo capítulo / sección / anexo» ----

export interface NewSectionTarget {
  kind: NewSectionKind;
  after?: string;
  parent?: string;
  /** Texto de contexto: «Después de 3 Antecedentes», «En 2 Objetivos»… */
  context: string;
}

const KIND_TITLE: Record<NewSectionKind, string> = { chapter: 'Nuevo capítulo', section: 'Nueva sección', appendix: 'Nuevo anexo' };
const KIND_DONE: Record<NewSectionKind, string> = { chapter: 'Capítulo «%» creado', section: 'Sección «%» creada', appendix: 'Anexo «%» creado' };

function NewSectionDialog({ target, onClose }: { target: NewSectionTarget | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTitle('');
    setError(null);
    setBusy(false);
  }, [target]);

  const submit = async () => {
    const t = title.trim();
    if (!target || !t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createSection({ kind: target.kind, title: t, after: target.after, parent: target.parent });
      void useUI.getState().refreshTree('memoria');
      onClose();
      openFile('memoria', r.file, { line: r.line });
      toast({ kind: 'ok', text: `${KIND_DONE[target.kind].replace('%', () => t)} en ${r.file}` });
    } catch (e) {
      setError(e instanceof FieldError ? e.message : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      onClose={() => !busy && onClose()}
      title={target ? KIND_TITLE[target.kind] : ''}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!title.trim() || busy}>
            {busy && <Spinner size={11} />}
            Crear
          </Button>
        </>
      }
    >
      <form
        className="p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="et-new-section-title" className="mb-1 block text-[12px] text-muted">
          {target?.context}
        </label>
        <input
          id="et-new-section-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título"
          aria-invalid={!!error}
          className={cx(
            'h-8 w-full rounded-md border bg-bg px-2 text-[13px] outline-none focus:border-accent',
            error ? 'border-danger' : 'border-line-strong',
          )}
        />
        {error && (
          <p className="mt-1.5 text-[12px] text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

// ---- Árbol ----

export function OutlineView({ onShowFiles }: { onShowFiles: () => void }) {
  const data = useOutline((s) => s.data);
  const error = useOutline((s) => s.error);
  const unavailable = useOutline((s) => s.unavailable);
  const loading = useOutline((s) => s.loading);
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState<NewSectionTarget | null>(null);

  useEffect(() => {
    if (!useOutline.getState().data) void useOutline.getState().refresh();
  }, []);

  const nodes = useMemo(() => buildNodes(data?.items ?? []), [data]);
  const hasChapters = useMemo(() => {
    let found = false;
    const walk = (l: OutlineItem[]) => l.forEach((x) => (x.kind === 'chapter' ? (found = true) : walk(x.children)));
    walk(data?.items ?? []);
    return found;
  }, [data]);

  const lastChapter = useMemo(() => [...(data?.items ?? [])].reverse().find((x) => x.kind === 'chapter') ?? null, [data]);

  const addChapter = (after?: OutlineItem) =>
    setTarget({
      kind: 'chapter',
      after: after?.id,
      context: after ? `Después de «${outlineLabel(after)}»` : lastChapter ? `Al final de los capítulos (tras «${outlineLabel(lastChapter)}»)` : 'Al final de los capítulos',
    });
  const addSection = (parent: OutlineItem) => setTarget({ kind: 'section', parent: parent.id, context: `Al final de «${outlineLabel(parent)}»` });
  const addAppendix = () => setTarget({ kind: 'appendix', context: 'Al final de los anexos' });

  if (!data) {
    if (error)
      return (
        <div className="px-3 py-3 text-[12px]">
          <p className={unavailable ? 'text-muted' : 'text-danger'}>{error}</p>
          <div className="mt-2 flex gap-1.5">
            <Button onClick={onShowFiles}>Ver archivos</Button>
            <Button variant="ghost" onClick={() => void useOutline.getState().refresh()}>
              <RefreshCw size={12} /> Reintentar
            </Button>
          </div>
        </div>
      );
    return (
      <div className="flex justify-center py-4 text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <div className="flex h-6 shrink-0 items-center gap-1 px-3 pb-1">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={`${data.words.toLocaleString('es-ES')} palabras (aproximado) · ${data.main}`}>
          <span className="font-semibold text-fg tabular-nums">{data.words.toLocaleString('es-ES')}</span> palabras
          {loading && <Spinner size={9} />}
        </span>
        <button
          type="button"
          className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-[11px] text-muted hover:bg-hover hover:text-fg"
          onClick={() => addChapter()}
          title="Añadir un capítulo al final"
        >
          <Plus size={11} /> Capítulo
        </button>
        <button
          type="button"
          className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-[11px] text-muted hover:bg-hover hover:text-fg"
          onClick={addAppendix}
          title="Añadir un anexo al final"
        >
          <Plus size={11} /> Anexo
        </button>
      </div>
      <div className="relative px-2 pb-1.5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setFilter('');
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              (e.currentTarget.closest('aside')?.querySelector('[role=tree]') as HTMLElement | null)?.focus();
            }
          }}
          placeholder="Filtrar apartados…"
          aria-label="Filtrar apartados"
          className="h-6 w-full rounded-md border border-line bg-bg px-2 text-[12px] outline-none focus:border-accent"
        />
      </div>
      {error && <div className="px-3 pb-1 text-[11px] text-danger">{error}</div>}
      {!!data.warnings?.length && (
        <ul className="mx-2 mb-1.5 rounded-md border border-warn/30 bg-warn-bg px-2 py-1 text-[11px] text-warn">
          {data.warnings.slice(0, 5).map((w, i) => (
            <li key={i} className="flex items-start gap-1">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{w}</span>
            </li>
          ))}
        </ul>
      )}
      {!hasChapters && nodes.length > 0 && (
        <div className="mx-2 mb-1.5 rounded-md border border-line bg-bg px-2 py-1.5 text-[11.5px] text-muted">
          Estructura no estándar: usa la pestaña{' '}
          <button type="button" className="font-medium text-accent hover:underline" onClick={onShowFiles}>
            Archivos
          </button>
          .
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {nodes.length === 0 ? (
          <Empty>
            No se encontró ningún apartado en «{data.main || 'el archivo principal'}».{' '}
            <button type="button" className="text-accent hover:underline" onClick={onShowFiles}>
              Ver archivos
            </button>
          </Empty>
        ) : (
          <OutlineTree nodes={nodes} filter={filter} generatedAt={data.generatedAt} onAddChapter={addChapter} onAddSection={addSection} />
        )}
      </div>
      <NewSectionDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}

function OutlineTree({
  nodes,
  filter,
  generatedAt,
  onAddChapter,
  onAddSection,
}: {
  nodes: Node[];
  filter: string;
  generatedAt: string;
  onAddChapter: (after: OutlineItem) => void;
  onAddSection: (parent: OutlineItem) => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => load<Record<string, boolean>>(EXP_KEY, {}));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const isExpanded = (n: Node) => overrides[n.key] ?? defaultExpanded(n);
  const setExpanded = (key: string, v: boolean) => {
    const next = { ...overrides, [key]: v };
    setOverrides(next);
    save(EXP_KEY, next);
  };

  // Padres e índice plano (orden del documento).
  const { parentOf, flat } = useMemo(() => {
    const parentOf = new Map<string, string | null>();
    const flat: Node[] = [];
    const walk = (l: Node[], parent: string | null) => {
      for (const n of l) {
        parentOf.set(n.key, parent);
        flat.push(n);
        walk(n.children, n.key);
      }
    };
    walk(nodes, null);
    return { parentOf, flat };
  }, [nodes]);

  const q = fold(filter.trim());
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const label = (n: Node) => fold(n.number ? `${n.number} ${n.title}` : n.title);
    const matchesDeep = (n: Node): boolean => label(n).includes(q) || n.children.some(matchesDeep);
    const walk = (l: Node[], depth: number, parent: string | null) => {
      for (const n of l) {
        if (q && !matchesDeep(n)) continue;
        const hasChildren = n.children.length > 0;
        const expanded = q ? n.children.some(matchesDeep) : isExpanded(n);
        out.push({ node: n, depth, hasChildren, expanded, parent });
        if (hasChildren && expanded) walk(n.children, depth + 1, n.key);
      }
    };
    walk(nodes, 0, null);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, q, overrides]);

  // Apartado que contiene el cursor del editor LaTeX activo.
  const activeId = useActivePanel((s) => s.id);
  const activePath = activeId?.startsWith('latex:') ? activeId.slice('latex:'.length) : null;
  const cursorLine = useCursor((s) => (activePath ? s.lines[docKey('memoria', activePath)] : undefined));
  const currentKey = useMemo(() => {
    if (!activePath) return null;
    let best: Node | null = null;
    for (const n of flat) {
      const it = n.item;
      if (!it || it.file !== activePath) continue;
      if (cursorLine == null) {
        // Sin cursor conocido: el primer apartado del archivo.
        if (!best) best = n;
        continue;
      }
      if (it.line <= cursorLine && (!best || it.line >= best.item!.line)) best = n;
    }
    if (!best) return null;
    // Si está plegado, se marca el antepasado visible.
    const visible = new Set(rows.map((r) => r.node.key));
    let k: string | null = best.key;
    while (k && !visible.has(k)) k = parentOf.get(k) ?? null;
    return k;
  }, [activePath, cursorLine, flat, rows, parentOf]);

  useEffect(() => {
    if (!currentKey) return;
    const i = rows.findIndex((r) => r.node.key === currentKey);
    if (i >= 0) treeRef.current?.querySelector(`#ol-row-${i}`)?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  // Apartado que se está viendo en el PDF (o su antepasado visible si está plegado).
  const readingId = useActiveOutlineId();
  const readingKey = useMemo(() => {
    if (!readingId) return null;
    const visible = new Set(rows.map((r) => r.node.key));
    let k: string | null = readingId;
    while (k && !visible.has(k)) k = parentOf.get(k) ?? null;
    return k;
  }, [readingId, rows, parentOf]);

  // Seguirlo solo mientras se desplaza el PDF, no mientras se usa el árbol.
  const pointerIn = useRef(false);
  useEffect(() => {
    if (!readingKey || pointerIn.current) return;
    const tree = treeRef.current;
    if (!tree || tree.contains(document.activeElement)) return;
    if (performance.now() - usePdfView.getState().scrolledAt > 600) return;
    const i = rows.findIndex((r) => r.node.key === readingKey);
    if (i >= 0) tree.querySelector(`#ol-row-${i}`)?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingKey]);

  const focusIdx = Math.max(
    0,
    rows.findIndex((r) => r.node.key === focusKey),
  );

  const open = (n: Node, side = false) => {
    if (n.item) openFile('memoria', n.item.file, { line: n.item.line, side });
    else setExpanded(n.key, !isExpanded(n));
  };

  const menuFor = (n: Node): MenuItem[] => {
    const items: MenuItem[] = [];
    if (n.item) {
      const it = n.item;
      items.push({ label: 'Abrir', run: () => open(n) });
      items.push({ label: 'Abrir al lado', hint: `${ALT}clic`, run: () => open(n, true) });
      if (/\.tex$/i.test(it.file)) items.push({ label: 'Ver en PDF', run: () => void showInPdf(it.file, it.line) });
      if (it.kind === 'chapter') {
        items.push({ label: '+ Sección', run: () => onAddSection(it) });
        items.push({ label: 'Añadir capítulo después', run: () => onAddChapter(it) });
      }
      items.push({ label: 'Copiar ruta', run: () => void navigator.clipboard?.writeText(`${it.file}:${it.line}`) });
    }
    return items;
  };

  const showRow = (i: number) => {
    const r = rows[i];
    if (!r) return;
    setFocusKey(r.node.key);
    treeRef.current?.querySelector(`#ol-row-${i}`)?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = rows[focusIdx];
    if (!r) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        showRow(Math.min(rows.length - 1, focusKey ? focusIdx + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        showRow(Math.max(0, focusIdx - 1));
        break;
      case 'Home':
        e.preventDefault();
        showRow(0);
        break;
      case 'End':
        e.preventDefault();
        showRow(rows.length - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (r.hasChildren && !r.expanded && !q) setExpanded(r.node.key, true);
        else if (r.hasChildren) showRow(focusIdx + 1);
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        if (r.hasChildren && r.expanded && !q) setExpanded(r.node.key, false);
        else if (r.parent) showRow(rows.findIndex((x) => x.node.key === r.parent));
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        setFocusKey(r.node.key);
        open(r.node, e.altKey);
        break;
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return;
        e.preventDefault();
        {
          const el = treeRef.current?.querySelector(`#ol-row-${focusIdx}`)?.getBoundingClientRect();
          const items = menuFor(r.node);
          if (el && items.length) openContextMenu({ clientX: el.left + 24, clientY: el.bottom, preventDefault: () => {} }, items);
        }
        break;
    }
  };

  if (!rows.length) return <Empty>Ningún apartado coincide.</Empty>;

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Estructura de la memoria"
      tabIndex={0}
      aria-activedescendant={focusKey ? `ol-row-${focusIdx}` : undefined}
      onKeyDown={onKeyDown}
      onPointerEnter={() => (pointerIn.current = true)}
      onPointerLeave={() => (pointerIn.current = false)}
      onFocus={() => {
        if (!focusKey && rows.length) setFocusKey((currentKey && rows.some((r) => r.node.key === currentKey) ? currentKey : rows[0].node.key));
      }}
      className="group/tree"
      // El anillo de foco lo pinta la fila activa, no el árbol entero.
      style={{ outline: 'none' }}
    >
      {rows.map((r, i) => (
        <OutlineRow
          key={r.node.key}
          id={`ol-row-${i}`}
          row={r}
          filter={filter}
          focused={focusKey === r.node.key}
          current={currentKey === r.node.key}
          reading={readingKey === r.node.key}
          generatedAt={generatedAt}
          onToggle={() => setExpanded(r.node.key, !r.expanded)}
          onOpen={(side) => {
            setFocusKey(r.node.key);
            open(r.node, side);
          }}
          menu={() => menuFor(r.node)}
        />
      ))}
    </div>
  );
}

function OutlineRow({
  id,
  row,
  filter,
  focused,
  current,
  reading,
  generatedAt,
  onToggle,
  onOpen,
  menu,
}: {
  id: string;
  row: Row;
  filter: string;
  focused: boolean;
  current: boolean;
  /** Apartado que se está viendo en el PDF. */
  reading: boolean;
  generatedAt: string;
  onToggle: () => void;
  onOpen: (side: boolean) => void;
  menu: () => MenuItem[];
}) {
  const { node: n, depth, hasChildren, expanded } = row;
  const isBib = n.kind === 'bibliography';
  const refs = useBibCount(isBib ? n.item : null, generatedAt);
  const title = isBib && refs != null && !/\(/.test(n.title) ? `${n.title} (${refs} ${refs === 1 ? 'ref' : 'refs'})` : n.title;
  const isChapter = n.kind === 'chapter';
  const top = n.kind === 'chapter' || n.kind === 'appendix' || n.kind === 'group' || n.kind === 'datos' || n.kind === 'bibliography' || (n.kind === 'frontmatter' && depth === 0);
  const tip = [
    n.number ? `${n.number} ${title}` : title,
    n.item ? `${n.item.file}:${n.item.line}` : null,
    n.words ? `${n.words.toLocaleString('es-ES')} palabras` : null,
    n.warnings.length ? `Avisos: ${n.warnings.join(', ')}` : null,
    !n.enabled ? 'Desactivado (línea comentada)' : null,
    n.item ? `${ALT}clic: abrir al lado` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      id={id}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={current}
      aria-disabled={!n.enabled || undefined}
      aria-current={reading ? 'location' : undefined}
      title={reading ? `${tip}\nSe está viendo en el PDF` : tip}
      className={cx(
        'group relative flex h-[24px] cursor-pointer items-center gap-1 pr-1.5 text-[12.5px] select-none hover:bg-hover',
        current && 'bg-active',
        focused && 'group-focus/tree:outline group-focus/tree:outline-2 group-focus/tree:-outline-offset-2 group-focus/tree:outline-accent',
        !n.enabled && 'text-faint',
      )}
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={(e) => onOpen(e.altKey)}
      onContextMenu={(e) => {
        const items = menu();
        if (items.length) openContextMenu(e, items);
      }}
    >
      {reading && <span aria-hidden className="absolute inset-y-[3px] left-0 w-[2px] rounded-full bg-accent" />}
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? 'Plegar' : 'Desplegar'}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-faint hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      {n.kind === 'datos' && <ClipboardList size={13} className="shrink-0 text-muted" />}
      {isBib && <BookMarked size={13} className="shrink-0 text-muted" />}
      {n.number && (
        <span className={cx('shrink-0 tabular-nums', reading ? 'text-accent' : n.enabled ? 'text-muted' : 'text-faint', top ? 'font-semibold' : 'text-[11.5px]')}>{n.number}</span>
      )}
      <span className={cx('min-w-0 flex-1 truncate', top && n.enabled && 'font-medium', n.kind === 'group' && 'text-muted')}>
        {highlight(title, filter)}
        {!n.enabled && <span className="ml-1 text-[10.5px] italic">(desactivado)</span>}
      </span>
      {n.warnings.map((w, i) => (
        <WarningIcon key={i} w={w} />
      ))}
      {n.words > 0 && (
        <span className={cx('shrink-0 text-[10.5px] text-faint tabular-nums', isChapter && 'group-hover:hidden')} title={`${n.words.toLocaleString('es-ES')} palabras`}>
          {compactWords(n.words)}
        </span>
      )}
      {isChapter && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Acciones del capítulo"
          title="Acciones del capítulo"
          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted group-hover:inline-flex hover:bg-hover hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            openContextMenu({ clientX: r.left, clientY: r.bottom + 2, preventDefault: () => {} }, menu().filter((m) => m.label.startsWith('+') || m.label.startsWith('Añadir')));
          }}
        >
          <Ellipsis size={13} />
        </button>
      )}
    </div>
  );
}
