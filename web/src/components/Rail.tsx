import { BookMarked, FileCode2, Home, Inbox, Plus, Search, Settings, Workflow } from 'lucide-react';
import { useUI, type Section } from '../state/ui';
import { openHome, openSettings, useActivePanel } from '../state/workspace';
import { kbd } from '../lib/kbd';
import { shortcutFor } from '../lib/shortcuts';
import { cx } from './ui';

const ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'memoria', label: 'Memoria', icon: <FileCode2 size={19} /> },
  { id: 'diagramas', label: 'Diagramas', icon: <Workflow size={19} /> },
  { id: 'notes', label: 'Notas', icon: <BookMarked size={19} /> },
  { id: 'resources', label: 'Recursos', icon: <Inbox size={19} /> },
  { id: 'search', label: 'Buscar', icon: <Search size={19} /> },
];

function RailButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-active text-accent' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      {active && <span className="absolute top-2 bottom-2 -left-1.5 w-[3px] rounded-r bg-accent" />}
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-[46px] z-[950] hidden rounded-md bg-fg px-2 py-1 text-[11.5px] font-medium whitespace-nowrap text-bg shadow-pop group-hover:block group-focus-visible:block"
      >
        {label}
      </span>
    </button>
  );
}

export function Rail() {
  const section = useUI((s) => s.section);
  const open = useUI((s) => s.sidebarOpen);
  const setSection = useUI((s) => s.setSection);
  const homeView = useUI((s) => s.homeView);
  const inbox = useUI((s) => s.resources?.filter((r) => r.status === 'inbox').length ?? 0);
  const settingsActive = useActivePanel((s) => s.id === 'settings');
  const unconfigured = useUI((s) => s.status?.configured === false);
  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-line bg-rail py-2" aria-label="Secciones">
      <RailButton
        label="Inicio"
        active={homeView}
        onClick={() => (homeView ? useUI.getState().hideHome() : openHome())}
      >
        <Home size={19} />
      </RailButton>
      {ITEMS.map((it) => (
        <RailButton
          key={it.id}
          label={it.label}
          active={!homeView && open && section === it.id}
          onClick={() => setSection(it.id)}
        >
          {it.icon}
          {it.id === 'resources' && inbox > 0 && (
            <span className="absolute top-1 right-0.5 min-w-[15px] rounded-full bg-accent px-1 text-center text-[9.5px] leading-[15px] font-bold text-accent-fg" aria-label={`${inbox} en bandeja`}>
              {inbox > 99 ? '99+' : inbox}
            </span>
          )}
        </RailButton>
      ))}
      <div className="flex-1" />
      <RailButton label={`Capturar (${kbd(shortcutFor('capture'))})`} onClick={() => useUI.getState().setCaptureOpen(true)}>
        <Plus size={19} />
      </RailButton>
      <RailButton label="Ajustes" active={settingsActive} onClick={() => openSettings()}>
        <Settings size={19} />
        {unconfigured && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-danger" aria-label="Falta configurar" />}
      </RailButton>
    </nav>
  );
}
