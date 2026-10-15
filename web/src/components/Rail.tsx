import { Bot, BookMarked, FileCode2, Home, Plus, Search, Settings, Workflow } from 'lucide-react';
import { useUI, type Section } from '../state/ui';
import { openHome, openSettings, openAssistant, useActivePanel } from '../state/workspace';
import { useDesktop } from '../state/desktop';
import { useAssistant } from '../state/assistant';
import { kbd } from '../lib/kbd';
import { shortcutFor } from '../lib/shortcuts';
import { cx } from './ui';

const ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'memoria', label: 'Memoria', icon: <FileCode2 size={22} /> },
  { id: 'diagramas', label: 'Diagramas', icon: <Workflow size={22} /> },
  { id: 'notes', label: 'Notas', icon: <BookMarked size={22} /> },
  { id: 'resources', label: 'Biblioteca', icon: <BookMarked size={22} /> },
  { id: 'search', label: 'Buscar', icon: <Search size={22} /> },
];

function RailButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'group relative flex size-11 items-center justify-center rounded-lg transition-colors disabled:opacity-40',
        active ? 'bg-active text-accent' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      {active && <span className="absolute top-2 bottom-2 -left-1.5 w-[3px] rounded-r bg-accent" />}
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-[calc(100%+6px)] z-[950] hidden rounded-md bg-fg px-2 py-1 text-sm font-medium whitespace-nowrap text-bg shadow-pop group-hover:block group-focus-visible:block"
      >
        {label}
      </span>
    </button>
  );
}

export function Rail() {
  const desktop = useDesktop(s => !!s.info);
  const assistantVisible = useAssistant(s => s.visible);
  const section = useUI((s) => s.section);
  const open = useUI((s) => s.sidebarOpen);
  const setSection = useUI((s) => s.setSection);
  const homeView = useUI((s) => s.homeView);
  const libraryView = useUI((s) => s.libraryView);
  const inbox = useUI((s) => s.resources?.filter((r) => r.status === 'inbox').length ?? 0);
  const settingsActive = useActivePanel((s) => s.id === 'settings');
  const workspaceReady = useActivePanel((s) => s.ready);
  const unconfigured = useUI((s) => s.status?.configured === false);
  return (
    <nav className="flex w-[3.75rem] shrink-0 flex-col items-center gap-1 border-r border-line bg-rail py-2" aria-label="Secciones">
      <RailButton
        label="Inicio"
        active={homeView}
        onClick={() => (homeView ? useUI.getState().hideHome() : openHome())}
      >
        <Home size={22} />
      </RailButton>
      {ITEMS.map((it) => (
        <RailButton
          key={it.id}
          label={it.label}
          active={it.id==='resources' ? libraryView : !homeView && !libraryView && open && section === it.id}
          onClick={() => setSection(it.id)}
        >
          {it.icon}
          {it.id === 'resources' && inbox > 0 && (
            <span className="absolute top-1 right-0.5 min-w-[1.125rem] rounded-full bg-accent px-1 text-center text-xs leading-[1.125rem] font-bold text-accent-fg" aria-label={`${inbox} en bandeja`}>
              {inbox > 99 ? '99+' : inbox}
            </span>
          )}
        </RailButton>
      ))}
      <div className="flex-1" />
      {desktop && <RailButton label="Asistente" active={assistantVisible} disabled={!workspaceReady} onClick={() => openAssistant()}><Bot size={19} /></RailButton>}
      <RailButton label={`Añadir (${kbd(shortcutFor('capture'))})`} onClick={() => useUI.getState().setCaptureOpen(true)}>
        <Plus size={22} />
      </RailButton>
      <RailButton label="Ajustes" active={settingsActive} disabled={!workspaceReady} onClick={() => openSettings()}>
        <Settings size={22} />
        {unconfigured && <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-danger text-xs leading-none font-bold text-bg" aria-label="Falta configurar">!</span>}
      </RailButton>
    </nav>
  );
}
