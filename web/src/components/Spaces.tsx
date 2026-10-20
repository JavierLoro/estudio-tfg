import { lazy, Suspense, useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { SECTIONS, SECTION_LABELS, type Section } from '../lib/spaces';
import { useUI } from '../state/ui';
import { Sidebar } from './Sidebar';
import { Workspace } from './Workspace';
import { MultiviewPresets } from './MultiviewPresets';
import { IconButton, Spinner, cx } from './ui';

const BibliotecaPanel = lazy(() => import('../panels/BibliotecaPanel'));

export function Spaces() {
  const section = useUI(s => s.section);
  const multiview = useUI(s => s.multiview);
  const pair = useUI(s => s.viewPair);
  const ratio = useUI(s => s.viewRatio);
  const home = useUI(s => s.homeView);
  const instance = useUI(s => s.status?.instanceId);
  const visible = multiview ? pair : [section];
  return <div className={cx('min-h-0 min-w-0 flex-1 flex-col', home ? 'hidden' : 'flex')}>
    {multiview && <MultiviewPresets key={instance} />}
    <div className="grid min-h-0 flex-1 overflow-auto" style={{ gridTemplateColumns: multiview ? `minmax(0, ${ratio}fr) 6px minmax(0, ${100 - ratio}fr)` : 'minmax(0, 1fr)' }}>
      {SECTIONS.map(s => <Space key={s} section={s} visible={visible.includes(s)} side={multiview && pair.includes(s) ? (pair[1] === s ? 1 : 0) : undefined} />)}
      {multiview && <ViewSeparator />}
    </div>
  </div>;
}

function Space({ section, visible, side }: { section: Section; visible: boolean; side?: 0 | 1 }) {
  const open = useUI(s => s.sidebars[section].open);
  const library = useUI(s => s.libraryView);
  const active = useUI(s => s.section === section);
  const [catalogOpened, setCatalogOpened] = useState(false);
  useEffect(() => { if (section === 'resources' && visible && library) setCatalogOpened(true); }, [section, visible, library]);
  const right = side === 1;
  const toggle = () => useUI.getState().setSidebarOpen(section, !open);
  return <section
    aria-label={`Espacio: ${SECTION_LABELS[section]}`}
    className={cx('min-h-0 min-w-0 flex-col overflow-hidden bg-bg', visible ? 'flex' : 'hidden')}
    style={{ gridColumn: side === 1 ? 3 : 1, gridRow: 1 }}
    onPointerDownCapture={() => useUI.getState().focusSection(section)}
    onFocusCapture={() => useUI.getState().focusSection(section)}
  >
    {side !== undefined && <div className={cx('flex h-9 shrink-0 items-center gap-2 border-b border-line px-2', active ? 'bg-active' : 'bg-soft')}>
      {!right && <IconButton label={open ? 'Ocultar menú izquierdo' : 'Mostrar menú izquierdo'} aria-expanded={open} onClick={toggle}>{open ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</IconButton>}
      <select aria-label={right ? 'Apartado derecho' : 'Apartado izquierdo'} value={section} onChange={e => useUI.getState().setViewSide(side, e.target.value as Section)} className="h-7 min-w-0 flex-1 rounded border border-line bg-bg px-2 text-[12px]">
        {SECTIONS.map(s => <option key={s} value={s}>{SECTION_LABELS[s]}</option>)}
      </select>
      {right && <IconButton label={open ? 'Ocultar menú derecho' : 'Mostrar menú derecho'} aria-expanded={open} onClick={toggle}>{open ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</IconButton>}
    </div>}
    <div className={cx('flex min-h-0 flex-1', right && 'flex-row-reverse')}>
      {open && <Sidebar section={section} right={right} />}
      {!open && side === undefined && <div className="shrink-0 border-r border-line bg-soft p-1"><IconButton label="Mostrar panel lateral" onClick={toggle}><PanelLeftOpen size={15} /></IconButton></div>}
      <main aria-label={SECTION_LABELS[section]} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === 'resources' && (catalogOpened || visible) && <div className={cx('min-h-0 flex-1', !library && 'hidden')}><Suspense fallback={<div className="p-4"><Spinner /></div>}><BibliotecaPanel /></Suspense></div>}
        <div className={cx('min-h-0 min-w-0 flex-1', section === 'resources' && library ? 'hidden' : 'flex')}>
          <Workspace section={section} />
        </div>
      </main>
    </div>
  </section>;
}

function ViewSeparator() {
  const ratio = useUI(s => s.viewRatio);
  return <div role="separator" aria-label="Ancho de las vistas" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={ratio} tabIndex={0}
    className="z-20 col-start-2 row-start-1 cursor-col-resize touch-none bg-line hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    onDoubleClick={() => useUI.getState().setViewRatio(50)}
    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); useUI.getState().setViewRatio(ratio + (e.key === 'ArrowRight' ? 5 : -5)); } }}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = e.currentTarget;
      const bounds = el.parentElement!.getBoundingClientRect();
      el.setPointerCapture(e.pointerId);
      document.body.classList.add('et-dragging', 'et-resizing');
      const move = (event: PointerEvent) => useUI.getState().setViewRatio((event.clientX - bounds.left) / bounds.width * 100);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        document.body.classList.remove('et-dragging', 'et-resizing');
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }} />;
}
