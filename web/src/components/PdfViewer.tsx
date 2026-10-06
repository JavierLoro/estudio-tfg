// Visor PDF basado en PDF.js (v0.4). Se carga en diferido desde PdfPanel para no
// engordar el bundle inicial; el worker de PDF.js va en su propio archivo.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { EventBus, FindState, LinkTarget, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import { ChevronDown, ChevronUp, Minus, Moon, Plus, Search, X } from 'lucide-react';
import { load, save } from '../lib/storage';
import { openFromPdf, usePdfView } from '../state/synctex';
import { IconButton, MOD, Spinner, cx } from './ui';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const SCALE_KEY = 'et:pdf-scale';
const DARK_KEY = 'et:pdf-dark';
const PRESETS: [string, string][] = [
  ['page-width', 'Ajustar al ancho'],
  ['page-fit', 'Página completa'],
];
const PERCENTS = [50, 75, 100, 125, 150, 200, 300];

type Target = NonNullable<ReturnType<typeof usePdfView.getState>['target']>;

export default function PdfViewer({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const busRef = useRef<EventBus | null>(null);
  const linkRef = useRef<PDFLinkService | null>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  /** Escala a aplicar cuando el contenedor tenga tamaño (panel oculto al cargar). */
  const pendingScale = useRef<string | null>(null);
  const pendingTarget = useRef<Target | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(0);
  const [pageInput, setPageInput] = useState('');
  const [scale, setScale] = useState<{ value: string; pct: number }>({ value: load(SCALE_KEY, 'page-width'), pct: 100 });
  const [dark, setDark] = useState<boolean>(() => load(DARK_KEY, false));
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<{ current: number; total: number; notFound: boolean }>({ current: 0, total: 0, notFound: false });

  const hasSize = () => (container.current?.clientWidth ?? 0) > 0;

  const applyScale = useCallback((value: string) => {
    const v = viewerRef.current;
    if (!v || !docRef.current) return;
    if (!hasSize()) {
      pendingScale.current = value;
      return;
    }
    pendingScale.current = null;
    v.currentScaleValue = value;
  }, []);

  /** Salta a la zona `t` y la resalta un momento. */
  const reveal = useCallback((t: Target) => {
    const v = viewerRef.current;
    if (!v || !docRef.current || !hasSize() || t.page < 1 || t.page > v.pagesCount) {
      pendingTarget.current = t;
      return;
    }
    pendingTarget.current = null;
    const pv = v.getPageView(t.page - 1);
    const [vx0, , , vy1] = pv.viewport.viewBox as number[];
    const top = vy1 - t.y;
    v.scrollPageIntoView({ pageNumber: t.page, destArray: [null, { name: 'XYZ' }, null, top, null], allowNegativeOffset: true });
    // Dejar la zona a un tercio de la altura, no pegada al borde.
    const c = container.current!;
    c.scrollTop = Math.max(0, c.scrollTop - c.clientHeight / 3);
    const [ax, ay] = pv.viewport.convertToViewportPoint(vx0 + t.x, top - t.h) as number[];
    const [bx, by] = pv.viewport.convertToViewportPoint(vx0 + t.x + t.w, top) as number[];
    const r = [ax, ay, bx, by];
    const el = document.createElement('div');
    el.className = 'et-synctex-hl';
    Object.assign(el.style, {
      left: `${Math.min(r[0], r[2]) - 3}px`,
      top: `${Math.min(r[1], r[3]) - 2}px`,
      width: `${Math.abs(r[2] - r[0]) + 6}px`,
      height: `${Math.abs(r[3] - r[1]) + 4}px`,
    });
    pv.div.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }, []);

  // Crear el visor una vez.
  useEffect(() => {
    const c = container.current!;
    const bus = new EventBus();
    const link = new PDFLinkService({ eventBus: bus, externalLinkTarget: LinkTarget.BLANK });
    const find = new PDFFindController({ eventBus: bus, linkService: link });
    const viewer = new PDFViewer({ container: c, viewer: inner.current!, eventBus: bus, linkService: link, findController: find, textLayerMode: 1 });
    link.setViewer(viewer);
    viewerRef.current = viewer;
    busRef.current = bus;
    linkRef.current = link;

    bus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      setPage(pageNumber);
      usePdfView.setState({ page: pageNumber });
    });
    bus.on('scalechanging', ({ scale: s, presetValue }: { scale: number; presetValue?: string }) => {
      const value = presetValue && PRESETS.some(([k]) => k === presetValue) ? presetValue : String(s);
      setScale({ value, pct: Math.round(s * 100) });
      save(SCALE_KEY, value);
    });
    const onCount = ({ matchesCount }: { matchesCount: { current: number; total: number } }) =>
      setMatches((m) => ({ ...m, current: matchesCount.current, total: matchesCount.total }));
    bus.on('updatefindmatchescount', onCount);
    bus.on('updatefindcontrolstate', (e: { state: number; matchesCount: { current: number; total: number } }) => {
      setMatches({ current: e.matchesCount?.current ?? 0, total: e.matchesCount?.total ?? 0, notFound: e.state === FindState.NOT_FOUND });
    });

    // Paneles ocultos o redimensionados: reaplicar los ajustes «al ancho / página».
    const ro = new ResizeObserver(() => {
      if (!hasSize() || !docRef.current) return;
      const want = pendingScale.current ?? viewer.currentScaleValue;
      if (pendingScale.current || want === 'page-width' || want === 'page-fit') applyScale(want);
      if (pendingTarget.current) reveal(pendingTarget.current);
    });
    ro.observe(c);

    // ⌘/Ctrl + rueda (o pellizco en el trackpad): zoom alrededor del puntero.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      viewer.updateScale({ scaleFactor: Math.exp(-e.deltaY / 200), origin: [e.clientX, e.clientY] });
    };
    c.addEventListener('wheel', onWheel, { passive: false });

    // ⌘/Ctrl + clic: ir al código (SyncTeX inverso). En captura, antes que los enlaces.
    const onClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>('.page');
      const n = Number(pageEl?.dataset.pageNumber);
      if (!pageEl || !n) return;
      e.preventDefault();
      e.stopPropagation();
      const pv = viewer.getPageView(n - 1);
      const box = pageEl.getBoundingClientRect();
      const [px, py] = pv.viewport.convertToPdfPoint(e.clientX - box.left - pageEl.clientLeft, e.clientY - box.top - pageEl.clientTop) as number[];
      const [vx0, , , vy1] = pv.viewport.viewBox as number[];
      void openFromPdf(n, px - vx0, vy1 - py, e.altKey);
    };
    c.addEventListener('click', onClick, true);

    return () => {
      ro.disconnect();
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('click', onClick, true);
      viewer.setDocument(null as unknown as pdfjs.PDFDocumentProxy);
      void docRef.current?.loadingTask.destroy();
      docRef.current = null;
      viewerRef.current = null;
    };
  }, [applyScale, reveal]);

  // Cargar (o recargar tras compilar) conservando zoom y desplazamiento.
  useEffect(() => {
    const c = container.current!;
    const viewer = viewerRef.current!;
    const bus = busRef.current!;
    let done = false;
    let cancelled = false;
    setError(null);
    if (!docRef.current) setLoading(true);
    const task = pdfjs.getDocument({ url, disableRange: true });
    task.promise.then(
      (doc) => {
        done = true;
        if (cancelled) {
          void doc.loadingTask.destroy();
          return;
        }
        const prev = docRef.current;
        const keep = prev ? { top: c.scrollTop, left: c.scrollLeft, scale: viewer.currentScaleValue } : null;
        const onInit = () => {
          bus.off('pagesinit', onInit);
          applyScale(keep?.scale || load(SCALE_KEY, 'page-width'));
          if (keep) {
            c.scrollTop = keep.top;
            c.scrollLeft = keep.left;
          }
          setLoading(false);
          setPage(viewer.currentPageNumber);
          usePdfView.setState({ page: viewer.currentPageNumber });
          if (pendingTarget.current) reveal(pendingTarget.current);
          // Si la búsqueda está abierta, rehacerla sobre el nuevo PDF.
          if (findOpen && query) dispatchFind(false, false);
        };
        bus.on('pagesinit', onInit);
        docRef.current = doc;
        viewer.setDocument(doc);
        linkRef.current!.setDocument(doc, null);
        setPages(doc.numPages);
        usePdfView.setState({ pages: doc.numPages });
        void prev?.loadingTask.destroy();
      },
      (e: unknown) => {
        done = true;
        if (cancelled) return;
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
      if (!done) void task.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Código → PDF: zonas pedidas desde el editor o la vista Documento.
  const target = usePdfView((s) => s.target);
  useEffect(() => {
    if (!target) return;
    try {
      reveal(target);
    } catch (e) {
      console.error('[pdf] no se pudo mostrar la zona', e);
    }
  }, [target, reveal]);

  useEffect(() => setPageInput(page ? String(page) : ''), [page]);

  const dispatchFind = (again: boolean, previous: boolean, q = query) => {
    busRef.current?.dispatch('find', {
      source: null,
      type: again ? 'again' : '',
      query: q,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  };

  const openFind = () => {
    setFindOpen(true);
    requestAnimationFrame(() => findInput.current?.select());
  };
  const closeFind = () => {
    setFindOpen(false);
    busRef.current?.dispatch('findbarclose', { source: null });
    container.current?.focus();
  };

  const zoom = (steps: number) => viewerRef.current?.updateScale({ steps });

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFind();
    } else if (mod && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      zoom(1);
    } else if (mod && e.key === '-') {
      e.preventDefault();
      zoom(-1);
    } else if (mod && e.key === '0') {
      e.preventDefault();
      applyScale('page-width');
    } else if (e.key === 'Escape' && findOpen) {
      closeFind();
    }
  };

  const goToPage = () => {
    const n = Number(pageInput);
    const v = viewerRef.current;
    if (v && Number.isInteger(n) && n >= 1 && n <= v.pagesCount) v.currentPageNumber = n;
    else setPageInput(page ? String(page) : '');
  };

  const toggleDark = () => {
    setDark((d) => {
      save(DARK_KEY, !d);
      return !d;
    });
  };

  const isPreset = PRESETS.some(([k]) => k === scale.value);
  const pctOption = PERCENTS.includes(scale.pct) ? String(scale.pct / 100) : 'custom';

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-line bg-bg px-2 text-[11.5px] text-muted">
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap" title="Página actual">
          <input
            className="h-5 w-9 rounded border border-line bg-soft px-1 text-right text-fg outline-none focus:border-accent"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && goToPage()}
            onBlur={goToPage}
            aria-label="Página"
            inputMode="numeric"
          />
          <span>/ {pages || '–'}</span>
        </span>
        <span className="mx-1 h-4 w-px bg-line" />
        <IconButton label={`Alejar (${MOD}−)`} onClick={() => zoom(-1)}>
          <Minus size={13} />
        </IconButton>
        <select
          className="h-5 rounded border border-line bg-soft px-1 text-fg outline-none focus:border-accent"
          value={isPreset ? scale.value : pctOption}
          onChange={(e) => applyScale(e.target.value)}
          aria-label="Zoom"
        >
          {PRESETS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
          {PERCENTS.map((p) => (
            <option key={p} value={String(p / 100)}>
              {p} %
            </option>
          ))}
          {!isPreset && pctOption === 'custom' && <option value="custom">{scale.pct} %</option>}
        </select>
        <IconButton label={`Acercar (${MOD}+)`} onClick={() => zoom(1)}>
          <Plus size={13} />
        </IconButton>
        <span className="flex-1" />
        <span className="min-w-0 truncate text-faint" title="⌘/Ctrl+clic en el PDF abre el código de ese punto">
          {MOD}clic: ir al código
        </span>
        <IconButton label={`Buscar en el PDF (${MOD}F)`} active={findOpen} onClick={() => (findOpen ? closeFind() : openFind())}>
          <Search size={13} />
        </IconButton>
        <IconButton label="Páginas oscuras (invertir colores)" active={dark} onClick={toggleDark}>
          <Moon size={13} />
        </IconButton>
      </div>
      {findOpen && (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-soft px-2 text-[11.5px] text-muted">
          <input
            ref={findInput}
            className={cx(
              'h-6 min-w-0 flex-1 rounded border bg-bg px-2 text-fg outline-none focus:border-accent',
              matches.notFound && query ? 'border-danger' : 'border-line',
            )}
            placeholder="Buscar en el PDF…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              dispatchFind(false, false, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                dispatchFind(true, e.shiftKey);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeFind();
              }
            }}
            aria-label="Buscar en el PDF"
          />
          <span className="w-16 shrink-0 text-center tabular-nums">
            {query ? (matches.total ? `${matches.current} / ${matches.total}` : matches.notFound ? 'Sin resultados' : '…') : ''}
          </span>
          <IconButton label="Anterior (⇧↵)" onClick={() => dispatchFind(true, true)} disabled={!matches.total}>
            <ChevronUp size={13} />
          </IconButton>
          <IconButton label="Siguiente (↵)" onClick={() => dispatchFind(true, false)} disabled={!matches.total}>
            <ChevronDown size={13} />
          </IconButton>
          <IconButton label="Cerrar (Esc)" onClick={closeFind}>
            <X size={13} />
          </IconButton>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={container} tabIndex={0} className={cx('et-pdf absolute inset-0 overflow-auto outline-none', dark && 'et-pdf-dark')}>
          <div ref={inner} className="pdfViewer" />
        </div>
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted">
            <Spinner size={18} />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[12px] text-danger">No se pudo abrir el PDF: {error}</div>
        )}
      </div>
    </div>
  );
}
