import { useEffect, useState } from 'react';
import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IWatermarkPanelProps,
  type DockviewTheme,
} from 'dockview-react';
import { ClipboardList, FileCode2, FileText, Home, Inbox, Search, Settings, Workflow, X, FileType2 } from 'lucide-react';
import { kbd } from '../lib/kbd';
import { docKey } from '../lib/paths';
import { indicatorOf, useDocs } from '../state/docs';
import { useUI } from '../state/ui';
import { useDarkTheme } from '../state/appearance';
import {
  defaultLayout,
  onPanelRemoved,
  openSettings,
  restoreLayout,
  scheduleLayoutSave,
  setDock,
  useActivePanel,
  type FileParams,
} from '../state/workspace';
import { LatexPanel } from '../panels/LatexPanel';
import { NotePanel } from '../panels/NotePanel';
import { PdfPanel } from '../panels/PdfPanel';
import { ResourcePanel } from '../panels/ResourcePanel';
import { SearchPanel } from '../panels/SearchPanel';
import { HomePanel } from '../panels/HomePanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { DatosPanel } from '../panels/DatosPanel';
import { DiagramPanel } from '../panels/DiagramPanel';
import { IndicatorMark } from './DocBanners';
import { cx } from './ui';

const components = {
  latex: LatexPanel,
  note: NotePanel,
  diagram: DiagramPanel,
  pdf: PdfPanel,
  resource: ResourcePanel,
  search: SearchPanel,
  home: HomePanel,
  settings: SettingsPanel,
  datos: DatosPanel,
  assistant: () => null, // Solo para retirar la pestaña de layouts anteriores.
};

const ICONS: Record<string, React.ReactNode> = {
  latex: <FileCode2 size={15} />,
  note: <FileText size={15} />,
  diagram: <Workflow size={15} />,
  pdf: <FileType2 size={15} />,
  resource: <Inbox size={15} />,
  search: <Search size={15} />,
  home: <Home size={15} />,
  settings: <Settings size={15} />,
  datos: <ClipboardList size={15} />,
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
  const pending = ind && ind !== 'guardado' && ind !== 'cargando';
  return (
    <div
      className="group flex h-full items-center gap-1.5 pr-1 pl-3 text-sm"
      title={p.path ? `${p.path}${ind ? ` · ${ind}` : ''}` : title}
      aria-label={label}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          api.close();
        }
      }}
    >
      <span className="text-muted">{ICONS[api.component] ?? null}</span>
      <span className={cx('max-w-[220px] truncate', ind === 'conflicto' && 'text-danger')}>{title}</span>
      {/* Estado (forma + color) siempre visible; el botón de cerrar va aparte para que no lo tape. */}
      {pending && <IndicatorMark ind={ind} size={13} />}
      <button
        type="button"
        aria-label={`Cerrar ${title}`}
        title="Cerrar"
        className={cx(
          'et-focus-inset flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg focus-visible:opacity-100',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [.dv-active-tab_&]:opacity-100',
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          api.close();
        }}
      >
        <X size={15} />
      </button>
    </div>
  );
}

function Watermark(_: IWatermarkPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-ui text-muted">
      <p>Abre un archivo desde el panel lateral</p>
      <p>
        o pulsa <kbd className="rounded border border-line px-1 font-mono">{kbd('Mod-K')}</kbd>
      </p>
    </div>
  );
}

export function Workspace() {
  const dark = useDarkTheme();
  const theme: DockviewTheme = dark ? themeDark : themeLight;

  const onReady = (e: DockviewReadyEvent) => {
    const api = e.api;
    setDock(api);
    const unconfigured = useUI.getState().status?.configured === false;
    if (unconfigured) {
      // Sin carpetas válidas: no tiene sentido abrir tfg.tex; se abren los ajustes.
      if (!restoreLayout(api)) api.clear();
      openSettings();
    } else if (!restoreLayout(api)) {
      const status = useUI.getState().status;
      defaultLayout(status?.memoriaMain ?? 'tfg.tex');
      if (!status) {
        // Si el server aún no respondió, corregir tfg.tex cuando llegue el estado.
        const unsub = useUI.subscribe((s) => {
          if (!s.status) return;
          unsub();
          if (s.status.memoriaMain !== 'tfg.tex' && api.panels.length === 2 && api.getPanel('latex:tfg.tex')) {
            defaultLayout(s.status.memoriaMain);
          }
        });
      }
    }
    api.onDidLayoutChange(() => scheduleLayoutSave());
    api.onDidRemovePanel((p) => onPanelRemoved(p));
    api.onDidActivePanelChange((e) => useActivePanel.setState({ id: e.panel?.id ?? null }));
    useActivePanel.setState({ id: api.activePanel?.id ?? null });
  };

  useEffect(() => () => setDock(null), []);

  return (
    <div className="h-full min-w-0 flex-1">
      <DockviewReact
        className="h-full"
        theme={theme}
        components={components}
        defaultTabComponent={Tab}
        watermarkComponent={Watermark}
        onReady={onReady}
        disableFloatingGroups
      />
    </div>
  );
}
