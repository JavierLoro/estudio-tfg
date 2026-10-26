import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FolderOpen, Grid2X2, List, Network, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { Button, Banner, Empty, Spinner, cx } from '../components/ui';
import { openActions } from '../components/OpenActions';
import { LibraryMigrationDialog } from '../components/LibraryMigrationDialog';
import { DEFAULT_FILTERS, KIND_LABEL, filterResources, kinds, resourceKind, resourceSummary, safeUrl, type LibraryFilters } from '../lib/library';
import { load, save } from '../lib/storage';
import { formatDate } from '../lib/paths';
import { useUI } from '../state/ui';
import { useCaptureQueue } from '../state/captureQueue';
import { openResource } from '../state/workspace';
import BibliographyImportDialog from '../components/BibliographyImportDialog';
const LibraryMap = lazy(() => import('../components/LibraryMap'));

export default function BibliotecaPanel() {
  const resources = useUI((s) => s.resources),
    error = useUI((s) => s.resourcesError),
    warnings = useUI((s) => s.resourcesWarnings),
    status = useUI((s) => s.status);
  const queued = useCaptureQueue((s) => s.items),
    queueBusy = useCaptureQueue((s) => s.busy);
  const key = `et:library-filters:${status?.libraryId ?? 'legacy'}`;
  const [filters, setFilters] = useState<LibraryFilters>(() => load(key, DEFAULT_FILTERS));
  const [grid, setGrid] = useState(() => load('et:library-grid', false)),
    [migration, setMigration] = useState(false);
  const [importing,setImporting]=useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null), previousSelection = useRef<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (selectedPath) detailRef.current?.focus();
    else if (previousSelection.current) rowRefs.current[previousSelection.current]?.focus();
    previousSelection.current = selectedPath;
  }, [selectedPath]);
  const selected = resources?.find(r => r.path === selectedPath);
  const showGrid = grid;
  useEffect(() => {
    setFilters(load(key, DEFAULT_FILTERS));
    setSelectedPath(null);
    setMapOpen(false);
    void useUI.getState().refreshResources();
  }, [key]);
  const filter = (name: keyof LibraryFilters, value: string) => {
    const next = { ...filters, [name]: value };
    setFilters(next);
    save(key, next);
    if (name === 'kind') { setGrid(value === 'image'); save('et:library-grid', value === 'image'); }
  };
  const list = useMemo(() => filterResources(resources ?? [], filters), [resources, filters]);
  const tags = [...new Set((resources ?? []).flatMap((r) => r.tags).filter((tag) => tag !== 'recurso'))].sort();
  const collections = [...new Set((resources ?? []).flatMap((r) => r.collections ?? []))].sort();
  const input = 'h-9 rounded-md border border-line bg-bg px-2 text-[12px] outline-none focus:border-accent';
  if (mapOpen) return <Suspense fallback={<div className="p-4"><Spinner /> Cargando mapa…</div>}><LibraryMap key={status?.libraryId} onBack={() => setMapOpen(false)} /></Suspense>;
  return (
    <div className="h-full overflow-auto bg-soft p-4 @container">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold">
              <BookOpen size={23} /> Biblioteca
            </h1>
            <p className="mt-1 text-[12px] text-muted">Referencias, documentos, imágenes y webs para tus trabajos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setMapOpen(true)}><Network size={13} /> Mapa de contenidos</Button>
            <Button onClick={()=>setImporting(true)}>Importar bibliografía</Button>
            <Button onClick={() => setMigration(true)}>Formato y recuperación</Button>
            <Button onClick={() => void useUI.getState().refreshResources()} title="Recargar Biblioteca">
              <RefreshCw size={13} />
            </Button>
            <Button variant="primary" onClick={() => useUI.getState().setCaptureOpen(true)}>
              <Plus size={14} /> Añadir
            </Button>
          </div>
        </header>
        {status?.libraryError && <Banner kind="danger">{status.libraryError}</Banner>}
        {error && <Banner kind="danger">{error}</Banner>}
        {warnings.map((warning, i) => (
          <Banner key={i} kind="warn">
            {warning.path}: {warning.message}
          </Banner>
        ))}
        {!!queued.length && (
          <Banner kind="warn">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {queued.length} recurso(s) pendiente(s){queueBusy ? ' · enviando…' : ''}. Texto y adjuntos siguen guardados en este
                navegador.
              </span>
              <Button onClick={() => useCaptureQueue.setState({ open: true })}>Revisar pendientes</Button>
            </div>
          </Banner>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            value={filters.query}
            onChange={(e) => filter('query', e.target.value)}
            placeholder="Buscar títulos, notas, URLs…"
            aria-label="Buscar en Biblioteca"
            className={cx(input, 'min-w-48 flex-1')}
          />
        </div>
        <div className="flex flex-col gap-4 @3xl:flex-row">
        <aside aria-label="Filtros de Biblioteca" className="flex shrink-0 flex-wrap gap-2 @3xl:w-44 @3xl:flex-col">
          <select aria-label="Filtrar por tipo" className={input} value={filters.kind} onChange={(e) => filter('kind', e.target.value)}>
            <option value="">Todos los tipos</option>
            {kinds.map((kind) => (
              <option value={kind} key={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por colección"
            className={input}
            value={filters.collection}
            onChange={(e) => filter('collection', e.target.value)}
          >
            <option value="">Todas las colecciones</option>
            {collections.map((collection) => (
              <option key={collection}>{collection}</option>
            ))}
          </select>
          <select
            aria-label="Filtrar por revisión"
            className={input}
            value={filters.status}
            onChange={(e) => filter('status', e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="inbox">Sin revisar</option>
            <option value="revisado">Revisados</option>
            <option value="descartado">Descartados</option>
          </select>
          <details className="rounded border border-line bg-bg p-2 text-[12px]">
            <summary className="cursor-pointer">Más filtros</summary>
            <div className="mt-2 flex flex-col gap-2">
          <select aria-label="Filtrar por etiqueta" className={input} value={filters.tag} onChange={(e) => filter('tag', e.target.value)}>
            <option value="">Todas las etiquetas</option>
            {tags.map((tag) => (
              <option key={tag}>{tag}</option>
            ))}
          </select>
          <select aria-label="Ordenar Biblioteca" className={input} value={filters.order} onChange={(e) => filter('order', e.target.value)}>
            <option value="recent">Más recientes</option>
            <option value="oldest">Más antiguos</option>
            <option value="title">Título</option>
          </select>
            </div>
          </details>
        </aside>
        <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center justify-between text-[12px] text-muted">
          <span>
            {list.length} de {resources?.length ?? 0} recursos
          </span>
          <div className="flex gap-1">
            <Button
              aria-pressed={!showGrid}
              onClick={() => {
                setGrid(false);
                save('et:library-grid', false);
              }}
            >
              <List size={13} /> Lista
            </Button>
            <Button
              aria-pressed={showGrid}
              onClick={() => {
                setGrid(true);
                save('et:library-grid', true);
              }}
            >
              <Grid2X2 size={13} /> Cuadrícula
            </Button>
          </div>
        </div>
        {!resources && !error && (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        )}
        {resources && !list.length && (
          <div className="rounded-lg border border-dashed border-line-strong bg-bg p-10 text-center">
            <FolderOpen size={32} className="mx-auto mb-3 text-faint" />
            <Empty>
              {resources.length
                ? 'Ningún recurso coincide con estos filtros.'
                : 'Tu Biblioteca está lista para empezar. Añade una web, un archivo o una ficha manual.'}
            </Empty>
            <Button
              className="mt-3"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                save(key, DEFAULT_FILTERS);
              }}
              disabled={!resources.length}
            >
              Limpiar filtros
            </Button>
          </div>
        )}
        <div className="flex gap-4">
        <ul className={cx(selected && 'hidden @5xl:block', 'min-w-0 flex-1', showGrid ? 'grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4' : 'space-y-2')}>
          {list.map((resource) => (
            <li key={resource.path}>
              <button
                type="button"
                className={cx(
                  'w-full overflow-hidden rounded-lg border border-line bg-bg text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent',
                  !showGrid && 'flex items-center gap-3 p-3',
                )}
                {...openActions((side) => side ? openResource(resource.path, { side }) : setSelectedPath(resource.path))}
                ref={el => { rowRefs.current[resource.path] = el; }}
                aria-pressed={selectedPath === resource.path}
              >
                {showGrid && (
                  <div className="flex h-36 items-center justify-center bg-hover">
                    {resource.thumbnailPath ? (
                      <img
                        src={api.rawUrl('notes', resource.thumbnailPath)}
                        loading="lazy"
                        alt={resource.title}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <BookOpen size={30} className="text-faint" />
                    )}
                  </div>
                )}
                {!showGrid && resource.thumbnailPath && (
                  <img
                    src={api.rawUrl('notes', resource.thumbnailPath)}
                    loading="lazy"
                    alt=""
                    className="h-12 w-16 shrink-0 rounded bg-hover object-contain"
                  />
                )}
                <div className={cx('min-w-0 flex-1', showGrid && 'p-3')}>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{KIND_LABEL[resourceKind(resource)]}</span>
                  <h2 className="truncate text-[14px] font-semibold">{resource.title}</h2>
                  <p className="mt-1 line-clamp-2 text-[12px] text-muted">{resourceSummary(resource)}</p>
                  <p className="mt-1 truncate text-[11px] text-faint">
                    {formatDate(resource.captured)} · {(resource.attachments ?? (resource.attachment ? [resource.attachment] : [])).length}{' '}
                    adjunto(s){resource.status === 'inbox' ? ' · sin revisar' : ''}
                  </p>
                  {!!resource.collections?.length && (
                    <p className="mt-1 truncate text-[11px] text-accent">{resource.collections.join(' · ')}</p>
                  )}
                  {resource.libraryError && <p className="mt-1 text-[11px] text-warn">{resource.libraryError}</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
        {selected && <section ref={detailRef} tabIndex={-1} aria-label="Ficha de consulta" className="min-w-0 flex-1 rounded-lg border border-line bg-bg p-4 @5xl:max-w-sm">
          <Button onClick={() => setSelectedPath(null)}>Volver a la lista</Button>
          <details open className="mt-3">
            <summary className="cursor-pointer text-[16px] font-semibold">{selected.title}</summary>
            <p className="mt-2 text-[11px] text-muted">{KIND_LABEL[resourceKind(selected)]}</p>
            {selected.thumbnailPath && <img src={api.rawUrl('notes', selected.thumbnailPath)} alt={selected.title} className="my-3 max-h-64 w-full object-contain" />}
            <p className="my-3 whitespace-pre-wrap text-[13px]">{resourceSummary(selected)}</p>
            {selected.presentation?.warning && <Banner kind="warn">{selected.presentation.warning}</Banner>}
            <p className="my-3 whitespace-pre-wrap break-words text-[12px] text-muted">{selected.note}</p>
            {!!selected.collections?.length && <p className="text-[12px]">Colecciones: {selected.collections.join(', ')}</p>}
            {!!selected.tags.length && <p className="text-[12px]">Etiquetas: {selected.tags.join(', ')}</p>}
            {selected.urls?.filter(safeUrl).map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="my-2 block break-all text-[12px] text-accent">{url}</a>)}
            <p className="my-2 text-[12px] text-muted">{(selected.attachments ?? []).length} adjunto(s) · {selected.status === 'inbox' ? 'Sin revisar' : selected.status}</p>
          </details>
          <Button variant="primary" className="mt-3" {...openActions(side => openResource(selected.path, { side }))}>Abrir</Button>
        </section>}
        </div>
        </div>
        </div>
      </div>
      <LibraryMigrationDialog open={migration} onClose={() => setMigration(false)} />
      {importing&&<BibliographyImportDialog onClose={()=>setImporting(false)}/>}
    </div>
  );
}
