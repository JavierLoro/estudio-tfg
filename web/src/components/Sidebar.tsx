import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, ExternalLink, FilePlus2, Inbox, LayoutDashboard, Paperclip, Play, RefreshCw, Search as SearchIcon, X } from 'lucide-react';
import type { Root } from '../api';
import { basename, formatDate, hostOf } from '../lib/paths';
import { useCompile } from '../state/compile';
import { STATUS_LABEL, setResourceStatus } from '../state/resources';
import { useUI, type Section } from '../state/ui';
import { openFile, openHome, openResource, openSearch, resetLayout } from '../state/workspace';
import { saveAndCompile } from '../panels/LatexPanel';
import { FileTree, createFileIn } from './FileTree';
import { OutlineView } from './OutlineTree';
import { useOutline } from '../state/outline';
import { load, save } from '../lib/storage';
import { ScopeSelect, SearchResults } from './SearchView';
import { ALT, Empty, IconButton, Spinner, cx } from './ui';

const TITLES: Record<Section, string> = {
  home: 'Inicio',
  memoria: 'Memoria',
  notes: 'Notas',
  resources: 'Recursos',
  search: 'Buscar',
};

function FilterInput({ value, onChange, placeholder, inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <div className="relative px-2 pb-1.5">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-6 w-full rounded-md border border-line bg-bg px-2 pr-6 text-[12px] outline-none focus:border-accent"
      />
      {value && (
        <button type="button" aria-label="Limpiar filtro" className="absolute top-1 right-3.5 text-faint hover:text-fg" onClick={() => onChange('')}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  const section = useUI((s) => s.section);
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-line bg-soft" aria-label={`Panel lateral: ${TITLES[section]}`}>
      {section === 'home' && <HomeSection />}
      {section === 'memoria' && <MemoriaSection />}
      {section === 'notes' && <TreeSection root="notes" />}
      {section === 'resources' && <ResourcesSection />}
      {section === 'search' && <SearchSection />}
    </aside>
  );
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 pr-1.5 pl-3">
      <h2 className="flex-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h2>
      {children}
    </div>
  );
}

type MemoriaTab = 'documento' | 'archivos';
const MEMORIA_TAB_KEY = 'et:memoria-tab';

function MemoriaSection() {
  const [tab, setTabState] = useState<MemoriaTab>(() => (load<string>(MEMORIA_TAB_KEY, 'documento') === 'archivos' ? 'archivos' : 'documento'));
  const setTab = (t: MemoriaTab) => {
    setTabState(t);
    save(MEMORIA_TAB_KEY, t);
  };
  const compiling = useCompile((s) => s.compiling);
  useEffect(() => {
    void useUI.getState().refreshTree('memoria');
  }, []);
  return (
    <>
      <SectionHeader title="Memoria">
        {tab === 'archivos' && (
          <IconButton label="Nuevo archivo" onClick={() => createFileIn('memoria', '')}>
            <FilePlus2 size={14} />
          </IconButton>
        )}
        <IconButton
          label="Recargar"
          onClick={() => {
            void useUI.getState().refreshTree('memoria');
            void useOutline.getState().refresh();
          }}
        >
          <RefreshCw size={13} />
        </IconButton>
        <IconButton label="Compilar" onClick={() => saveAndCompile()} disabled={compiling}>
          {compiling ? <Spinner size={11} /> : <Play size={13} />}
        </IconButton>
      </SectionHeader>
      <div className="flex gap-0.5 px-2 pb-1.5" role="tablist" aria-label="Vista de la memoria">
        {(['documento', 'archivos'] as MemoriaTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx(
              'h-6 flex-1 rounded-md px-1 text-[11.5px]',
              tab === t ? 'bg-active font-semibold text-accent' : 'text-muted hover:bg-hover',
            )}
          >
            {t === 'documento' ? 'Documento' : 'Archivos'}
          </button>
        ))}
      </div>
      {tab === 'documento' ? <OutlineView onShowFiles={() => setTab('archivos')} /> : <MemoriaFiles />}
    </>
  );
}

function MemoriaFiles() {
  const [filter, setFilter] = useState('');
  return (
    <>
      <FilterInput value={filter} onChange={setFilter} placeholder="Filtrar archivos…" />
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        <FileTree root="memoria" filter={filter} />
      </div>
    </>
  );
}

function TreeSection({ root }: { root: Root }) {
  const [filter, setFilter] = useState('');
  const compiling = useCompile((s) => s.compiling);
  useEffect(() => {
    void useUI.getState().refreshTree(root);
  }, [root]);
  return (
    <>
      <SectionHeader title={root === 'memoria' ? 'Memoria' : 'Notas'}>
        <IconButton label={root === 'notes' ? 'Nueva nota' : 'Nuevo archivo'} onClick={() => createFileIn(root, '')}>
          <FilePlus2 size={14} />
        </IconButton>
        <IconButton label="Recargar" onClick={() => useUI.getState().refreshTree(root)}>
          <RefreshCw size={13} />
        </IconButton>
        {root === 'memoria' && (
          <IconButton label="Compilar" onClick={() => saveAndCompile()} disabled={compiling}>
            {compiling ? <Spinner size={11} /> : <Play size={13} />}
          </IconButton>
        )}
      </SectionHeader>
      <FilterInput value={filter} onChange={setFilter} placeholder="Filtrar archivos…" />
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        <FileTree root={root} filter={filter} />
      </div>
    </>
  );
}

function HomeSection() {
  const recents = useUI((s) => s.recents);
  return (
    <>
      <SectionHeader title="Inicio">
        <IconButton label="Abrir panel de inicio" onClick={() => openHome()}>
          <LayoutDashboard size={14} />
        </IconButton>
      </SectionHeader>
      <div className="px-3 pb-1 text-[11px] font-medium text-faint">Recientes</div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {recents.length === 0 && <Empty>Sin archivos recientes.</Empty>}
        {recents.map((r) => (
          <button
            key={`${r.root}:${r.path}`}
            type="button"
            className="flex h-[24px] w-full items-center gap-2 px-3 text-left text-[12.5px] hover:bg-hover"
            onClick={(e) => openFile(r.root, r.path, { side: e.altKey })}
            title={`${r.path}\n${ALT}clic: abrir al lado`}
          >
            <span className="min-w-0 flex-1 truncate">{basename(r.path)}</span>
            <span className="shrink-0 text-[10.5px] text-faint">{r.root === 'memoria' ? 'memoria' : 'notas'}</span>
          </button>
        ))}
      </div>
      <div className="border-t border-line px-3 py-2">
        <button type="button" className="text-[11.5px] text-muted hover:text-fg hover:underline" onClick={resetLayout}>
          Restablecer distribución de paneles
        </button>
      </div>
    </>
  );
}

type StatusFilter = 'inbox' | 'revisado' | 'descartado' | 'all';

function ResourcesSection() {
  const resources = useUI((s) => s.resources);
  const error = useUI((s) => s.resourcesError);
  const [status, setStatus] = useState<StatusFilter>('inbox');
  const [tag, setTag] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    void useUI.getState().refreshResources();
  }, []);

  const tags = useMemo(() => {
    const s = new Set<string>();
    for (const r of resources ?? []) for (const t of r.tags ?? []) if (t !== 'recurso') s.add(t);
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [resources]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { inbox: 0, revisado: 0, descartado: 0, all: 0 };
    for (const r of resources ?? []) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      c.all++;
    }
    return c;
  }, [resources]);

  const list = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (resources ?? []).filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        (!tag || r.tags?.includes(tag)) &&
        (!q || r.title.toLowerCase().includes(q) || (r.url ?? '').toLowerCase().includes(q)),
    );
  }, [resources, status, tag, text]);

  return (
    <>
      <SectionHeader title="Recursos">
        <IconButton label="Capturar recurso" onClick={() => useUI.getState().setCaptureOpen(true)}>
          <FilePlus2 size={14} />
        </IconButton>
        <IconButton label="Recargar" onClick={() => useUI.getState().refreshResources()}>
          <RefreshCw size={13} />
        </IconButton>
      </SectionHeader>
      <div className="flex gap-0.5 px-2 pb-1.5" role="tablist" aria-label="Filtrar por estado">
        {(['inbox', 'revisado', 'descartado', 'all'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={cx(
              'h-6 min-w-0 flex-auto truncate rounded-md px-1 text-[10.5px] whitespace-nowrap',
              status === s ? 'bg-active font-semibold text-accent' : 'text-muted hover:bg-hover',
            )}
          >
            {s === 'all' ? 'Todos' : s === 'descartado' ? 'Descart.' : STATUS_LABEL[s]}{' '}
            {resources ? <span className="opacity-70">{counts[s] ?? 0}</span> : null}
          </button>
        ))}
      </div>
      <div className="flex gap-1 px-2 pb-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Filtrar…"
          aria-label="Filtrar recursos"
          className="h-6 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-[12px] outline-none focus:border-accent"
        />
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          aria-label="Filtrar por etiqueta"
          className="h-6 w-[92px] rounded-md border border-line bg-bg px-1 text-[11.5px] text-muted"
        >
          <option value="">Etiqueta</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {error && <div className="px-3 py-1 text-[12px] text-danger">{error}</div>}
        {!resources && !error && (
          <div className="flex justify-center py-4 text-muted">
            <Spinner />
          </div>
        )}
        {resources && list.length === 0 && <Empty>{status === 'inbox' ? 'Bandeja vacía.' : 'Nada por aquí.'}</Empty>}
        <ul>
          {list.map((r) => (
            <li key={r.path} className="group relative">
              <button
                type="button"
                className="block w-full px-3 py-1 pr-16 text-left hover:bg-hover"
                onClick={(e) => openResource(r.path, { side: e.altKey })}
                title={`${r.title}\n${ALT}clic: abrir al lado`}
              >
                <div className="truncate text-[12.5px] font-medium">{r.title}</div>
                <div className="flex items-center gap-1 truncate text-[10.5px] text-faint">
                  {r.attachment && <Paperclip size={10} />}
                  {formatDate(r.captured)}
                  {r.url ? ` · ${hostOf(r.url)}` : ''}
                </div>
              </button>
              <div className="absolute top-1 right-1.5 hidden gap-0.5 bg-soft group-focus-within:flex group-hover:flex">
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Abrir URL en otra pestaña"
                    title="Abrir URL en otra pestaña"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
                {r.status !== 'revisado' && (
                  <IconButton label="Marcar revisado" onClick={() => setResourceStatus(r.path, 'revisado')}>
                    <Check size={13} />
                  </IconButton>
                )}
                {r.status !== 'descartado' ? (
                  <IconButton label="Descartar" onClick={() => setResourceStatus(r.path, 'descartado')}>
                    <Archive size={13} />
                  </IconButton>
                ) : (
                  <IconButton label="Devolver a la bandeja" onClick={() => setResourceStatus(r.path, 'inbox')}>
                    <Inbox size={13} />
                  </IconButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function SearchSection() {
  const q = useUI((s) => s.sidebarSearch);
  const setQ = useUI((s) => s.setSidebarSearch);
  const [scope, setScope] = useState<Root | 'all'>('all');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <>
      <SectionHeader title="Buscar">
        <IconButton label="Abrir resultados en un panel" onClick={() => openSearch(q, scope)}>
          <SearchIcon size={14} />
        </IconButton>
      </SectionHeader>
      <div className="flex gap-1 pr-2">
        <div className="min-w-0 flex-1">
          <FilterInput value={q} onChange={setQ} placeholder="Buscar en notas y memoria…" inputRef={ref} />
        </div>
        <ScopeSelect value={scope} onChange={setScope} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <SearchResults q={q} scope={scope} dense />
      </div>
    </>
  );
}
