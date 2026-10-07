import { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { Search } from 'lucide-react';
import type { Root } from '../api';
import { ScopeSelect, SearchResults } from '../components/SearchView';
import type { SearchParams } from '../state/workspace';

export function SearchPanel({ params, api }: IDockviewPanelProps<SearchParams>) {
  const [q, setQ] = useState(params.q ?? '');
  const [scope, setScope] = useState<Root | 'all'>(params.scope ?? 'all');
  const input = useRef<HTMLInputElement>(null);

  // Si se reabre con otra consulta (Mod-K → «Buscar en todo»), actualizar.
  useEffect(() => {
    if (params.q != null) setQ(params.q);
    if (params.scope) setScope(params.scope);
  }, [params.q, params.scope]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => api.updateParameters({ q, scope }), 400);
    api.setTitle(q.trim() ? `Buscar: ${q.trim()}` : 'Búsqueda');
    return () => clearTimeout(t);
  }, [q, scope, api]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <Search size={14} className="text-muted" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en notas y memoria…"
          aria-label="Buscar"
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
        <ScopeSelect value={scope} onChange={setScope} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto pt-1">
        <SearchResults q={q} scope={scope} />
      </div>
    </div>
  );
}
