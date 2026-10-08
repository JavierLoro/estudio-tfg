import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileText, FileCode2, ListTree } from 'lucide-react';
import { api, errorMessage, type Root, type SearchItem } from '../api';
import { basename } from '../lib/paths';
import { fold } from '../lib/search';
import { kbd } from '../lib/kbd';
import { useUI } from '../state/ui';
import { findOutlineItem, outlineLabel, outlineOrder, useOutline } from '../state/outline';
import { openFile } from '../state/workspace';
import { Empty, Spinner, cx } from './ui';

export { fold } from '../lib/search';

/** Resalta `q` en `text` (insensible a mayúsculas y tildes). */
export function highlight(text: string, q: string): ReactNode {
  const needle = fold(q.trim());
  if (!needle) return text;
  const chars = [...text];
  let folded = '';
  const map: number[] = [];
  chars.forEach((c, i) => {
    const f = fold(c);
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
  });
  const out: ReactNode[] = [];
  let last = 0;
  let from = 0;
  let idx: number;
  while ((idx = folded.indexOf(needle, from)) !== -1) {
    const s = map[idx];
    const e = map[idx + needle.length - 1] + 1;
    if (s > last) out.push(chars.slice(last, s).join(''));
    out.push(
      <mark key={idx} className="rounded-sm bg-yellow-300/50 text-inherit">
        {chars.slice(s, e).join('')}
      </mark>,
    );
    last = e;
    from = idx + needle.length;
  }
  if (last < chars.length) out.push(chars.slice(last).join(''));
  return out;
}

export function useSearch(q: string, scope: Root | 'all') {
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Al aplicar ajustes nuevos (otras carpetas) se repite la búsqueda.
  const version = useUI((s) => s.settingsVersion);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setItems(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api
        .search(query, scope, ctrl.signal)
        .then((r) => {
          setItems(r.items);
          setError(null);
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setError(errorMessage(e));
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, scope, version]);
  return { items, loading, error };
}

export function SearchResults({ q, scope, dense }: { q: string; scope: Root | 'all'; dense?: boolean }) {
  const { items, loading, error } = useSearch(q, scope);
  const outline = useOutline((s) => s.data);
  const files = useMemo(() => new Set((items ?? []).map((it) => `${it.root}:${it.path}`)).size, [items]);
  const groups = useMemo(() => groupHits(items ?? [], outlineOrder(outline)), [items, outline]);

  if (q.trim().length < 2) return <Empty>Escribe al menos 2 caracteres.</Empty>;
  if (error) return <div className="px-3 py-2 text-[12px] text-danger">{error}</div>;
  if (!items)
    return (
      <div className="flex justify-center py-4 text-muted">
        <Spinner />
      </div>
    );
  if (!items.length) return <Empty>Sin resultados para «{q}».</Empty>;

  return (
    <div className={cx('pb-2', loading && 'opacity-60')}>
      <div className="px-3 py-1 text-[11px] text-faint">
        {items.length >= 200 ? 'Más de 200' : items.length} coincidencias en {files} {files === 1 ? 'archivo' : 'archivos'} · {kbd('Alt-clic')} abre al lado
      </div>
      {groups.map((g) =>
        g.kind === 'outline' ? (
          <OutlineGroup key={`o:${g.id}`} group={g} q={q} dense={dense} />
        ) : (
        <div key={`${g.root}:${g.path}`} className="mb-1">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-3 py-0.5 text-left text-[12px] font-medium hover:bg-hover"
            onClick={(e) => openFile(g.root, g.path, { side: e.altKey })}
            title={`${g.root === 'memoria' ? 'Memoria' : 'Notas'} · ${g.path}`}
          >
            {g.root === 'memoria' ? <FileCode2 size={13} className="shrink-0 text-muted" /> : <FileText size={13} className="shrink-0 text-muted" />}
            <span className="truncate">{highlight(basename(g.path), q)}</span>
            {!dense && <span className="truncate text-[11px] font-normal text-faint">{g.path}</span>}
          </button>
          {g.hits
            .filter((h) => h.line > 0)
            .map((h, i) => (
              <button
                key={i}
                type="button"
                className="flex w-full items-baseline gap-2 py-0.5 pr-3 pl-7 text-left text-[12px] hover:bg-hover"
                onClick={(e) => openFile(h.root, h.path, { line: h.line, side: e.altKey })}
              >
                <span className="w-7 shrink-0 text-right font-mono text-[10.5px] text-faint">{h.line}</span>
                <span className={cx('min-w-0 flex-1 text-muted', dense ? 'truncate' : 'line-clamp-2')}>{highlight(h.snippet, q)}</span>
              </button>
            ))}
        </div>
        ),
      )}
    </div>
  );
}

type FileGroup = { kind: 'file'; root: Root; path: string; hits: SearchItem[] };
type OutlineHitGroup = { kind: 'outline'; id: string; number: string | null; title: string; order: number; hits: SearchItem[] };

/**
 * Notas (y resultados sin `outline`): por archivo, en el orden del servidor.
 * Memoria con `outline`: por apartado, en orden del documento, en el lugar del primero.
 */
function groupHits(items: SearchItem[], order: Map<string, number>): (FileGroup | OutlineHitGroup)[] {
  const files = new Map<string, FileGroup>();
  const sections = new Map<string, OutlineHitGroup>();
  const out: (FileGroup | OutlineHitGroup | 'sections')[] = [];
  for (const it of items) {
    const o = it.root === 'memoria' && it.line > 0 ? it.outline : null;
    if (o?.id) {
      if (!sections.size) out.push('sections');
      let g = sections.get(o.id);
      if (!g) {
        g = { kind: 'outline', id: o.id, number: o.number ?? null, title: o.title ?? '', order: order.get(o.id) ?? Number.MAX_SAFE_INTEGER, hits: [] };
        sections.set(o.id, g);
      }
      g.hits.push(it);
      continue;
    }
    const k = `${it.root}:${it.path}`;
    let g = files.get(k);
    if (!g) {
      g = { kind: 'file', root: it.root, path: it.path, hits: [] };
      files.set(k, g);
      out.push(g);
    }
    g.hits.push(it);
  }
  const sorted = [...sections.values()].sort((a, b) => a.order - b.order);
  const lineOrder = (h: SearchItem) => h.line;
  for (const g of sorted) g.hits.sort((a, b) => (a.path === b.path ? lineOrder(a) - lineOrder(b) : a.path.localeCompare(b.path)));
  return out.flatMap((x) => (x === 'sections' ? sorted : [x]));
}

function OutlineGroup({ group: g, q, dense }: { group: OutlineHitGroup; q: string; dense?: boolean }) {
  const outline = useOutline((s) => s.data);
  const item = useMemo(() => findOutlineItem(outline, g.id), [outline, g.id]);
  const first = g.hits[0];
  const label = outlineLabel(g);
  const file = item?.file ?? first.path;
  const multiFile = g.hits.some((h) => h.path !== first.path);
  return (
    <div className="mb-1">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-0.5 text-left text-[12px] font-medium hover:bg-hover"
        onClick={(e) => openFile('memoria', file, { line: item?.line ?? first.line, side: e.altKey })}
        title={`Memoria · ${label} · ${file}`}
      >
        <ListTree size={13} className="shrink-0 text-muted" />
        <span className="truncate">{highlight(label, q)}</span>
        {!dense && <span className="truncate text-[11px] font-normal text-faint">{file}</span>}
      </button>
      {g.hits.map((h, i) => (
        <button
          key={i}
          type="button"
          className="flex w-full items-baseline gap-2 py-0.5 pr-3 pl-7 text-left text-[12px] hover:bg-hover"
          onClick={(e) => openFile(h.root, h.path, { line: h.line, side: e.altKey })}
          title={`${h.path}:${h.line}`}
        >
          <span className="w-7 shrink-0 text-right font-mono text-[10.5px] text-faint">{h.line}</span>
          <span className={cx('min-w-0 flex-1 text-muted', dense ? 'truncate' : 'line-clamp-2')}>{highlight(h.snippet, q)}</span>
          {multiFile && <span className="shrink-0 text-[10.5px] text-faint">{basename(h.path)}</span>}
        </button>
      ))}
    </div>
  );
}

export function ScopeSelect({ value, onChange }: { value: Root | 'all'; onChange: (v: Root | 'all') => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Root | 'all')}
      aria-label="Ámbito de búsqueda"
      className="h-6 rounded-md border border-line bg-bg px-1 text-[11.5px] text-muted"
    >
      <option value="all">Todo</option>
      <option value="memoria">Memoria</option>
      <option value="notes">Notas</option>
    </select>
  );
}
