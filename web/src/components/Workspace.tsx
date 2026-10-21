import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IWatermarkPanelProps,
  type DockviewTheme,
  type DockviewApi,
} from 'dockview-react';
import { ClipboardList, FileCode2, FileText, Home, Inbox, Search, Workflow, X, FileType2 } from 'lucide-react';
import { kbd } from '../lib/kbd';
import { docKey } from '../lib/paths';
import { indicatorOf, useDocs } from '../state/docs';
import { useUI } from '../state/ui';
import {
  defaultLayout,
  onPanelRemoved,
  openSettings,
  restoreLayout,
  scheduleLayoutSave,
  setDock,
  setActivePanel,
  flushDockOpens,
  type FileParams,
} from '../state/workspace';
import { LatexPanel } from '../panels/LatexPanel';
import { NotePanel } from '../panels/NotePanel';
import { PdfPanel } from '../panels/PdfPanel';
import { ResourcePanel } from '../panels/ResourcePanel';
import { SearchPanel } from '../panels/SearchPanel';
import { HomePanel } from '../panels/HomePanel';
import { DatosPanel } from '../panels/DatosPanel';
import { DiagramPanel } from '../panels/DiagramPanel';
import { indicatorColor } from './DocBanners';
import { cx } from './ui';
import type { Section } from '../lib/spaces';
import { load, save } from '../lib/storage';
import { getInstance } from '../lib/instance';

const PdfHost = createContext<(host: HTMLDivElement | null) => void>(() => {});
function DockPdf() { return <div ref={useContext(PdfHost)} className="h-full min-h-0 min-w-0" />; }

const components = {
  latex: LatexPanel,
  note: NotePanel,
  diagram: DiagramPanel,
  pdf: DockPdf,
  resource: ResourcePanel,
  search: SearchPanel,
  home: HomePanel,
  settings: () => null, // Solo para retirar la pestaña de layouts anteriores.
  datos: DatosPanel,
  assistant: () => null, // Solo para retirar la pestaña de layouts anteriores.
};

const ICONS: Record<string, React.ReactNode> = {
  latex: <FileCode2 size={13} />,
  note: <FileText size={13} />,
  diagram: <Workflow size={13} />,
  pdf: <FileType2 size={13} />,
  resource: <Inbox size={13} />,
  search: <Search size={13} />,
  home: <Home size={13} />,
  datos: <ClipboardList size={13} />,
};

function useTitle(api: IDockviewPanelHeaderProps['api']) {
  const [title, setTitle] = useState(api.title ?? '');
  useEffect(() => {
    const d = api.onDidTitleChange((e) => setTitle(e.title));
    return () => d.dispose();
  }, [api]);
  return title;
}

function Tab({ api, params }: IDockviewPanelHeaderProps) {
  const title = useTitle(api);
  const p = params as Partial<FileParams>;
  const isDoc = (api.component === 'latex' || api.component === 'note' || api.component === 'diagram') && p.root && p.path;
  const ind = useDocs((s) => (isDoc ? indicatorOf(s.docs[docKey(p.root!, p.path!)]) : null));
  const label = ind && ind !== 'guardado' && ind !== 'cargando' ? `${title} (${ind})` : title;
  const close = () => {
    // Dockview evita el foco en la pestaña; confirmar el campo antes de desmontar su panel.
    (document.activeElement as HTMLElement | null)?.blur?.();
    api.close();
  };
  return (
    <div
      className="group flex h-full items-center gap-1.5 pr-1 pl-2.5 text-[12px]"
      title={p.path ? `${p.path}${ind ? ` · ${ind}` : ''}` : title}
      aria-label={label}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          close();
        }
      }}
    >
      <span className="text-faint">{ICONS[api.component] ?? null}</span>
      <span className={cx('max-w-[200px] truncate', ind === 'conflicto' && 'text-danger')}>{title}</span>
      <span className="relative flex h-4 w-4 items-center justify-center">
        {ind && ind !== 'guardado' && (
          <span
            className={cx('absolute h-2 w-2 rounded-full group-hover:hidden', indicatorColor(ind))}
            aria-hidden
          />
        )}
        <button
          type="button"
          aria-label={`Cerrar ${title}`}
          title="Cerrar"
          className={cx(
            'flex h-4 w-4 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg',
            ind && ind !== 'guardado' ? 'invisible group-hover:visible' : 'opacity-0 group-hover:opacity-100 [.dv-active-tab_&]:opacity-100',
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
        >
          <X size={12} />
        </button>
      </span>
    </div>
  );
}

function Watermark(_: IWatermarkPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-[12px] text-faint">
      <p>Abre un archivo desde el panel lateral</p>
      <p>
        o pulsa <kbd className="rounded border border-line px-1 font-mono">{kbd('Mod-K')}</kbd>
      </p>
    </div>
  );
}

function useDarkMode() {
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const fn = () => setDark(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return dark;
}

export function Workspace({ section }: { section: Section }) {
  const dark = useDarkMode();
  const theme: DockviewTheme = dark ? themeDark : themeLight;
  const multiview = useUI(s => s.multiview);
  const fixedPdf = section === 'memoria' && !multiview;
  const dock = useRef<DockviewApi | null>(null);

  // Conservar el grupo del PDF para Multivista, sin reconstruir los editores.
  const syncPdf = () => {
    const api = dock.current;
    if (!api || section !== 'memoria') return;
    const pdf = api.getPanel('pdf');
    if (!pdf) return;
    const fixed = !useUI.getState().multiview;
    if (fixed && pdf.group.panels.length > 1) {
      pdf.api.moveTo({ group: pdf.group, position: 'right', skipSetActive: true });
    }
    pdf.group.element.inert = fixed;
    pdf.group.element.style.visibility = fixed ? 'hidden' : '';
    if (pdf.group.api.isVisible === fixed) pdf.group.api.setVisible(!fixed);
  };

  useEffect(syncPdf, [multiview, section]);

  const onReady = (e: DockviewReadyEvent) => {
    const api = e.api;
    dock.current = api;
    setDock(section, api);
    const unconfigured = useUI.getState().status?.configured === false;
    if (unconfigured) {
      // Sin carpetas válidas: no tiene sentido abrir tfg.tex; se abren los ajustes.
      if (!restoreLayout(api, section)) api.clear();
      if (section === 'memoria') openSettings();
    } else if (!restoreLayout(api, section)) {
      const status = useUI.getState().status;
      defaultLayout(status?.memoriaMain ?? 'tfg.tex', section);
      if (!status && section === 'memoria') {
        // Si el server aún no respondió, corregir tfg.tex cuando llegue el estado.
        const unsub = useUI.subscribe((s) => {
          if (!s.status) return;
          unsub();
          if (s.status.memoriaMain !== 'tfg.tex' && api.panels.length === 2 && api.getPanel('latex:tfg.tex')) {
            defaultLayout(s.status.memoriaMain, section);
          }
        });
      }
    }
    syncPdf();
    api.onDidLayoutFromJSON(syncPdf);
    api.onDidAddPanel(syncPdf);
    api.onDidLayoutChange(() => scheduleLayoutSave());
    api.onDidRemovePanel((p) => onPanelRemoved(p));
    api.onDidActivePanelChange((e) => setActivePanel(section, e.panel?.id ?? null));
    setActivePanel(section, api.activePanel?.id ?? null);
    flushDockOpens(section);
  };

  useEffect(() => () => { dock.current = null; setDock(section, null); }, [section]);

  return (
    <MemoriaSplit fixed={fixedPdf} memory={section === 'memoria'}>
      <DockviewReact
        className="h-full"
        theme={theme}
        components={components}
        defaultTabComponent={Tab}
        watermarkComponent={Watermark}
        onReady={onReady}
        disableFloatingGroups
      />
    </MemoriaSplit>
  );
}

function MemoriaSplit({ fixed, memory, children }: { fixed: boolean; memory: boolean; children: React.ReactNode }) {
  const instance = useUI(s => s.status?.instanceId);
  const key = `et:memoria:pdf-ratio:${instance ?? getInstance() ?? 'legacy'}`;
  const clamp = (n: number) => Math.round(Math.min(80, Math.max(20, Number.isFinite(n) ? n : 50)));
  const [ratio, setRatio] = useState(() => clamp(load<number>(key, 50)));
  const [pdfElement] = useState(() => { const el = document.createElement('div'); el.className = 'h-full min-h-0 min-w-0'; return el; });
  const [fixedHost, setFixedHost] = useState<HTMLElement | null>(null);
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  // Mover el mismo visor entre soportes conserva página, zoom y diagnósticos.
  useLayoutEffect(() => {
    const host = fixed ? fixedHost : dockHost;
    if (memory && host) host.appendChild(pdfElement); else pdfElement.remove();
  }, [fixed, memory, fixedHost, dockHost, pdfElement]);
  useEffect(() => () => pdfElement.remove(), [pdfElement]);
  const drag = useRef<{ x: number; width: number; ratio: number } | null>(null);
  const resize = (n: number) => { const next = clamp(n); setRatio(next); save(key, next); };
  useEffect(() => { setRatio(clamp(load<number>(key, 50))); }, [key]);
  const stop = () => { drag.current = null; document.body.classList.remove('et-dragging', 'et-resizing'); };
  useEffect(() => () => { if (drag.current) stop(); }, [fixed]);
  return <PdfHost.Provider value={setDockHost}><div className="grid h-full min-h-0 min-w-0 flex-1" style={{ gridTemplateColumns: fixed ? `minmax(0, ${ratio}fr) 6px minmax(0, ${100 - ratio}fr)` : 'minmax(0, 1fr)' }}>
    <div className="min-h-0 min-w-0">{children}</div>
    {fixed && <>
      <div role="separator" aria-label="Ancho del PDF de Memoria" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={100 - ratio} aria-valuetext={`${100 - ratio} % PDF, ${ratio} % editor`} tabIndex={0}
        title="Arrastra para cambiar el ancho · doble clic: mitades iguales"
        className="z-20 cursor-col-resize touch-none bg-line hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        onDoubleClick={() => resize(50)}
        onKeyDown={e => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          resize(e.key === 'Home' ? 80 : e.key === 'End' ? 20 : ratio + (e.key === 'ArrowRight' ? 5 : -5));
        }}
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.focus();
          drag.current = { x: e.clientX, width: Math.max(1, e.currentTarget.parentElement!.clientWidth - 6), ratio };
          e.currentTarget.setPointerCapture(e.pointerId);
          document.body.classList.add('et-dragging', 'et-resizing');
        }}
        onPointerMove={e => { if (drag.current) resize(drag.current.ratio + (e.clientX - drag.current.x) / drag.current.width * 100); }}
        onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      />
      <section ref={setFixedHost} id="memoria-pdf" aria-label="PDF de Memoria" tabIndex={-1} className="min-h-0 min-w-0 overflow-hidden outline-none" />
    </>}
  </div>{memory && createPortal(<PdfPanel />, pdfElement)}</PdfHost.Provider>;
}
