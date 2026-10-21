import { Bot, BookMarked, FileCode2, Columns2, Search, Settings, Workflow } from 'lucide-react';
import { useUI, type Section } from '../state/ui';
import { openHome, openSettings, openAssistant, useActivePanel } from '../state/workspace';
import { useDesktop } from '../state/desktop';
import { useAssistant } from '../state/assistant';
import { cx } from './ui';
import logo from '../assets/logo.png';

const ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'memoria', label: 'Memoria', icon: <FileCode2 size={19} /> },
  { id: 'notes', label: 'Notas', icon: <BookMarked size={19} /> },
  { id: 'diagramas', label: 'Diagramas', icon: <Workflow size={19} /> },
  { id: 'resources', label: 'Biblioteca', icon: <BookMarked size={19} /> },
];

function RailButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'et-section-button relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded transition-colors disabled:opacity-40',
        active ? 'bg-active text-accent' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function Rail() {
  const desktop = useDesktop(s => !!s.info);
  const assistantVisible = useAssistant(s => s.visible);
  const section = useUI((s) => s.section);
  const multiview = useUI((s) => s.multiview);
  const setSection = useUI((s) => s.setSection);
  const homeView = useUI((s) => s.homeView);
  const inbox = useUI((s) => s.resources?.filter((r) => r.status === 'inbox').length ?? 0);
  const settingsActive = useUI((s) => s.settingsOpen);
  const quickOpen = useUI((s) => s.quickOpen);
  const workspaceReady = useActivePanel((s) => s.ready);
  const unconfigured = useUI((s) => s.status?.configured === false);
  return (
    <nav className="et-sections flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Secciones">
      <button
        type="button"
        aria-label="Inicio"
        title="Inicio"
        aria-pressed={homeView}
        className={cx('mr-4 flex shrink-0 items-center gap-2 rounded px-1 text-[21px] font-semibold tracking-tight hover:bg-hover', homeView && 'bg-active text-accent')}
        onClick={() => (homeView ? useUI.getState().hideHome() : openHome())}
      >
        <img src={logo} alt="" width={29} height={29} className="object-contain" />
        <span>estudio</span>
      </button>
      {ITEMS.map((it) => (
        <RailButton
          key={it.id}
          label={it.label}
          active={!homeView && !multiview && section === it.id}
          onClick={() => setSection(it.id)}
        >
          {it.icon}
          {it.id === 'resources' && inbox > 0 && (
            <span className="min-w-[15px] rounded-full bg-accent px-1 text-center text-[9.5px] leading-[15px] font-bold text-accent-fg" aria-label={`${inbox} en bandeja`}>
              {inbox > 99 ? '99+' : inbox}
            </span>
          )}
        </RailButton>
      ))}
      <RailButton label="Multivista" active={!homeView && multiview} onClick={() => useUI.getState().showMultiview()}><Columns2 size={19} /></RailButton>
      <div className="flex-1" />
      <RailButton label="Buscar" active={quickOpen} onClick={() => useUI.getState().setQuickOpen(true)}>
        <Search size={19} />
      </RailButton>
      {desktop && <RailButton label="Asistente" active={assistantVisible} disabled={!workspaceReady} onClick={() => openAssistant()}><Bot size={19} /></RailButton>}
      <RailButton label="Ajustes" active={settingsActive} disabled={!workspaceReady} onClick={() => openSettings()}>
        <Settings size={19} />
        {unconfigured && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-danger" aria-label="Falta configurar" />}
      </RailButton>
    </nav>
  );
}
