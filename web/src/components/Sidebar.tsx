import { useEffect, useRef, useState } from 'react';
import { FilePlus2, FolderPlus, Play, RefreshCw, Search as SearchIcon, Workflow, X } from 'lucide-react';
import type { Root } from '../api';
import { useCompile } from '../state/compile';
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, useUI, type Section } from '../state/ui';
import { openSearch } from '../state/workspace';
import { saveAndCompile } from '../panels/LatexPanel';
import { FileTree } from './FileTree';
import { createFileIn, createFolderIn } from '../state/files';
import { openNewDiagram } from '../state/diagramas';
import { OutlineView } from './OutlineTree';
import { DiagramasSection } from './DiagramasSection';
import { useOutline } from '../state/outline';
import { load, save } from '../lib/storage';
import { ScopeSelect, SearchResults } from './SearchView';
import { Button, IconButton, Input, Spinner, Tabs } from './ui';

const TITLES: Record<Section, string> = {
  memoria: 'Memoria',
  diagramas: 'Diagramas',
  notes: 'Notas',
  resources: 'Biblioteca',
  search: 'Buscar',
};

function FilterInput({ value, onChange, placeholder, inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <div className="relative px-2 pb-2">
      <Input
        ref={inputRef}
        inputSize="sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pr-9"
      />
      {value && (
        <IconButton label="Limpiar filtro" className="absolute top-0 right-2 size-(--et-control-sm)! min-h-0! min-w-0!" onClick={() => onChange('')}>
          <X size={15} />
        </IconButton>
      )}
    </div>
  );
}

export function Sidebar() {
  const section = useUI((s) => s.section);
  const width = useUI((s) => s.sidebarWidth);
  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-line bg-soft"
      style={{ width }}
      aria-label={`Panel lateral: ${TITLES[section]}`}
    >
      {section === 'memoria' && <MemoriaSection />}
      {section === 'diagramas' && <DiagramasSection />}
      {section === 'notes' && <TreeSection root="notes" />}
      {section === 'resources' && <div className="p-3"><Button onClick={() => useUI.getState().showLibrary()}>Abrir Biblioteca</Button></div>}
      {section === 'search' && <SearchSection />}
      <ResizeHandle width={width} />
    </aside>
  );
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-(--et-toolbar) shrink-0 items-center gap-0.5 pr-1.5 pl-3">
      <h2 className="flex-1 text-sm font-bold tracking-wide text-muted uppercase">{title}</h2>
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
          <>
            <IconButton label="Nuevo archivo" onClick={() => createFileIn('memoria', '')}>
              <FilePlus2 size={17} />
            </IconButton>
            <IconButton label="Nueva carpeta" onClick={() => createFolderIn('memoria', '')}>
              <FolderPlus size={17} />
            </IconButton>
          </>
        )}
        <IconButton label="Nuevo diagrama" onClick={() => openNewDiagram('')}>
          <Workflow size={17} />
        </IconButton>
        <IconButton
          label="Recargar"
          onClick={() => {
            void useUI.getState().refreshTree('memoria');
            void useOutline.getState().refresh();
          }}
        >
          <RefreshCw size={16} />
        </IconButton>
        <IconButton label="Compilar" onClick={() => saveAndCompile()} disabled={compiling}>
          {compiling ? <Spinner size={14} /> : <Play size={16} />}
        </IconButton>
      </SectionHeader>
      <Tabs
        label="Vista de la memoria"
        className="mx-2 mb-2"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'documento', label: 'Documento' },
          { id: 'archivos', label: 'Archivos' },
        ]}
      />
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
          <FilePlus2 size={17} />
        </IconButton>
        <IconButton label="Nueva carpeta" onClick={() => createFolderIn(root, '')}>
          <FolderPlus size={17} />
        </IconButton>
        <IconButton label="Recargar" onClick={() => useUI.getState().refreshTree(root)}>
          <RefreshCw size={16} />
        </IconButton>
        {root === 'memoria' && (
          <IconButton label="Compilar" onClick={() => saveAndCompile()} disabled={compiling}>
            {compiling ? <Spinner size={14} /> : <Play size={16} />}
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
          <SearchIcon size={17} />
        </IconButton>
      </SectionHeader>
      <div className="flex items-start gap-1 pr-2">
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

/** Tirador del borde derecho: arrastrar cambia el ancho; doble clic lo restablece; ←/→ con foco. */
function ResizeHandle({ width }: { width: number }) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    // Los iframes (PDF) no deben robar el ratón durante el arrastre.
    document.body.classList.add('et-dragging', 'et-resizing');
    const move = (ev: PointerEvent) => useUI.getState().setSidebarWidth(startW + ev.clientX - startX, false);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.classList.remove('et-dragging', 'et-resizing');
      useUI.getState().setSidebarWidth(useUI.getState().sidebarWidth);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ancho del panel lateral"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      title="Arrastra para cambiar el ancho · doble clic: restablecer"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useUI.getState().setSidebarWidth(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          useUI.getState().setSidebarWidth(width + (e.key === 'ArrowRight' ? 20 : -20));
        }
      }}
      className="et-focus-inset absolute top-0 -right-[3px] z-20 h-full w-[6px] cursor-col-resize touch-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/60"
    />
  );
}
