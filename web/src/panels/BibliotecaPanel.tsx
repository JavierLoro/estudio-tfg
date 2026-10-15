import { useEffect, useMemo, useState } from 'react';
import { BookOpen, FolderOpen, Grid2X2, List, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { Button, Banner, EmptyState, IconButton, Input, Select, Spinner, cx } from '../components/ui';
import { openActions } from '../components/OpenActions';
import { LibraryMigrationDialog } from '../components/LibraryMigrationDialog';
import { DEFAULT_FILTERS, KIND_LABEL, filterResources, kinds, resourceKind, type LibraryFilters } from '../lib/library';
import { load, save } from '../lib/storage';
import { formatDate } from '../lib/paths';
import { useUI } from '../state/ui';
import { useCaptureQueue } from '../state/captureQueue';
import { openResource } from '../state/workspace';
import BibliographyImportDialog from '../components/BibliographyImportDialog';

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
  useEffect(() => {
    setFilters(load(key, DEFAULT_FILTERS));
    void useUI.getState().refreshResources();
  }, [key]);
  const filter = (name: keyof LibraryFilters, value: string) => {
    const next = { ...filters, [name]: value };
    setFilters(next);
    save(key, next);
  };
  const list = useMemo(() => filterResources(resources ?? [], filters), [resources, filters]);
  const tags = [...new Set((resources ?? []).flatMap((r) => r.tags).filter((tag) => tag !== 'recurso'))].sort();
  const collections = [...new Set((resources ?? []).flatMap((r) => r.collections ?? []))].sort();
  const select = 'w-auto';
  return (
    <div className="h-full overflow-auto bg-soft p-4 @container">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <BookOpen size={24} aria-hidden /> Biblioteca
            </h1>
            <p className="mt-1 text-ui text-muted">Referencias, documentos, imágenes y webs para tus trabajos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={()=>setImporting(true)}>Importar bibliografía</Button>
            <Button onClick={() => setMigration(true)}>Formato y recuperación</Button>
            <IconButton label="Recargar Biblioteca" variant="secondary" onClick={() => void useUI.getState().refreshResources()}>
              <RefreshCw size={16} />
            </IconButton>
            <Button variant="primary" onClick={() => useUI.getState().setCaptureOpen(true)}>
              <Plus size={16} aria-hidden /> Añadir
            </Button>
          </div>
        </header>
        {status?.libraryError && <Banner kind="danger" inline>{status.libraryError}</Banner>}
        {error && <Banner kind="danger" inline>{error}</Banner>}
        {warnings.map((warning, i) => (
          <Banner key={i} kind="warn" inline>
            {warning.path}: {warning.message}
          </Banner>
        ))}
        {!!queued.length && (
          <Banner
            kind="warn"
            inline
            actions={
              <Button size="sm" onClick={() => useCaptureQueue.setState({ open: true })}>
                Revisar pendientes
              </Button>
            }
          >
            {queued.length} recurso(s) pendiente(s){queueBusy ? ' · enviando…' : ''}. Texto y adjuntos siguen guardados en este navegador.
          </Banner>
        )}
        <div className="flex flex-wrap gap-2">
          <Input
            value={filters.query}
            onChange={(e) => filter('query', e.target.value)}
            placeholder="Buscar títulos, notas, URLs…"
            aria-label="Buscar en Biblioteca"
            className="w-auto min-w-48 flex-1"
          />
          <Select aria-label="Filtrar por tipo" className={select} value={filters.kind} onChange={(e) => filter('kind', e.target.value)}>
            <option value="">Todos los tipos</option>
            {kinds.map((kind) => (
              <option value={kind} key={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </Select>
          <Select aria-label="Filtrar por etiqueta" className={select} value={filters.tag} onChange={(e) => filter('tag', e.target.value)}>
            <option value="">Todas las etiquetas</option>
            {tags.map((tag) => (
              <option key={tag}>{tag}</option>
            ))}
          </Select>
          <Select
            aria-label="Filtrar por colección"
            className={select}
            value={filters.collection}
            onChange={(e) => filter('collection', e.target.value)}
          >
            <option value="">Todas las colecciones</option>
            {collections.map((collection) => (
              <option key={collection}>{collection}</option>
            ))}
          </Select>
          <Select
            aria-label="Filtrar por revisión"
            className={select}
            value={filters.status}
            onChange={(e) => filter('status', e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="inbox">Sin revisar</option>
            <option value="revisado">Revisados</option>
            <option value="descartado">Descartados</option>
          </Select>
          <Select aria-label="Ordenar Biblioteca" className={select} value={filters.order} onChange={(e) => filter('order', e.target.value)}>
            <option value="recent">Más recientes</option>
            <option value="oldest">Más antiguos</option>
            <option value="title">Título</option>
          </Select>
        </div>
        <div className="flex items-center justify-between text-ui text-muted">
          <span>
            {list.length} de {resources?.length ?? 0} recursos
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={grid ? 'secondary' : 'primary'}
              aria-pressed={!grid}
              onClick={() => {
                setGrid(false);
                save('et:library-grid', false);
              }}
            >
              <List size={16} aria-hidden /> Lista
            </Button>
            <Button
              size="sm"
              variant={grid ? 'primary' : 'secondary'}
              aria-pressed={grid}
              onClick={() => {
                setGrid(true);
                save('et:library-grid', true);
              }}
            >
              <Grid2X2 size={16} aria-hidden /> Cuadrícula
            </Button>
          </div>
        </div>
        {!resources && !error && (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        )}
        {resources && !list.length && (
          <EmptyState
            className="rounded-lg border border-dashed border-line-strong bg-bg py-10! text-ui!"
            icon={<FolderOpen size={32} />}
            action={
              <Button
                className="mt-1"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  save(key, DEFAULT_FILTERS);
                }}
                disabled={!resources.length}
              >
                Limpiar filtros
              </Button>
            }
          >
            {resources.length
              ? 'Ningún recurso coincide con estos filtros.'
              : 'Tu Biblioteca está lista para empezar. Añade una web, un archivo o una ficha manual.'}
          </EmptyState>
        )}
        <ul className={grid ? 'grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4' : 'space-y-2'}>
          {list.map((resource) => (
            <li key={resource.path}>
              <button
                type="button"
                className={cx(
                  'w-full overflow-hidden rounded-lg border border-line bg-bg text-left transition-colors hover:border-accent hover:bg-hover',
                  !grid && 'flex items-center gap-3 p-3',
                )}
                {...openActions((side) => openResource(resource.path, { side }))}
              >
                {grid && (
                  <div className="flex h-36 items-center justify-center bg-hover">
                    {resource.thumbnailPath ? (
                      <img
                        src={api.rawUrl('notes', resource.thumbnailPath)}
                        loading="lazy"
                        alt={resource.title}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <BookOpen size={30} className="text-muted" aria-hidden />
                    )}
                  </div>
                )}
                {!grid && resource.thumbnailPath && (
                  <img
                    src={api.rawUrl('notes', resource.thumbnailPath)}
                    loading="lazy"
                    alt=""
                    className="h-12 w-16 shrink-0 rounded bg-hover object-contain"
                  />
                )}
                <div className={cx('min-w-0 flex-1', grid && 'p-3')}>
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">{KIND_LABEL[resourceKind(resource)]}</span>
                  <h2 className="truncate text-ui font-bold">{resource.title}</h2>
                  <p className="mt-1 truncate text-sm text-muted">
                    {formatDate(resource.captured)} · {(resource.attachments ?? (resource.attachment ? [resource.attachment] : [])).length}{' '}
                    adjunto(s){resource.status === 'inbox' ? ' · sin revisar' : ''}
                  </p>
                  {!!resource.collections?.length && (
                    <p className="mt-1 truncate text-sm text-accent">{resource.collections.join(' · ')}</p>
                  )}
                  {resource.libraryError && (
                    <p className="mt-1 flex items-start gap-1 text-sm text-warn">
                      <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                      <span>{resource.libraryError}</span>
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <LibraryMigrationDialog open={migration} onClose={() => setMigration(false)} />
      {importing&&<BibliographyImportDialog onClose={()=>setImporting(false)}/>}
    </div>
  );
}
