import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileText, FileCode2 } from 'lucide-react';
import { api, errorMessage, type Root, type SearchItem } from '../api';
import { basename } from '../lib/paths';
import { openFile } from '../state/workspace';
import { Empty, Spinner, cx } from './ui';

export function fold(s: string) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

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
  }, [q, scope]);
  return { items, loading, error };
}

export function SearchResults({ q, scope, dense }: { q: string; scope: Root | 'all'; dense?: boolean }) {
  const { items, loading, error } = useSearch(q, scope);
  const groups = useMemo(() => {
    const m = new Map<string, { root: Root; path: string; hits: SearchItem[] }>();
    for (const it of items ?? []) {
      const k = `${it.root}:${it.path}`;
      if (!m.has(k)) m.set(k, { root: it.root, path: it.path, hits: [] });
      m.get(k)!.hits.push(it);
    }
    return [...m.values()];
  }, [items]);

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
        {items.length >= 200 ? 'Más de 200' : items.length} coincidencias en {groups.length} archivos · {'⌥'}clic abre al lado
      </div>
      {groups.map((g) => (
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
