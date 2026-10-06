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
import { indicatorColor } from './DocBanners';
import { MOD, cx } from './ui';

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
};

const ICONS: Record<string, React.ReactNode> = {
  latex: <FileCode2 size={13} />,
  note: <FileText size={13} />,
  diagram: <Workflow size={13} />,
  pdf: <FileType2 size={13} />,
  resource: <Inbox size={13} />,
  search: <Search size={13} />,
  home: <Home size={13} />,
  settings: <Settings size={13} />,
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
  return (
    <div
      className="group flex h-full items-center gap-1.5 pr-1 pl-2.5 text-[12px]"
      title={p.path ? `${p.path}${ind ? ` · ${ind}` : ''}` : title}
      aria-label={label}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          api.close();
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
            api.close();
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
        o pulsa <kbd className="rounded border border-line px-1 font-mono">{MOD}K</kbd>
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

export function Workspace() {
  const dark = useDarkMode();
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
