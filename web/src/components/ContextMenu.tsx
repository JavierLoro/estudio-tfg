import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

export interface MenuItem {
  label: string;
  hint?: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  title?: string;
  origin: HTMLElement | null;
}

const useMenu = create<{ menu: MenuState | null }>(() => ({ menu: null }));

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[], title?: string) {
  e.preventDefault();
  const previous = useMenu.getState().menu;
  const active = document.activeElement as HTMLElement | null;
  const origin = active?.closest('[role="menu"]') ? previous?.origin ?? null : active;
  useMenu.setState({ menu: { x: e.clientX, y: e.clientY, items, title, origin } });
}

const close = (restore = false) => {
  const origin = useMenu.getState().menu?.origin;
  useMenu.setState({ menu: null });
  if (restore && origin?.isConnected) origin.focus({ preventScroll: true });
};

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    const rect = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)) + 'px';
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close(true);
    };
    const onBlur = () => close();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    (ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? ref.current)?.focus();
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [menu]);
  if (!menu) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={menu.title ?? 'Menú contextual'}
      tabIndex={-1}
      className="fixed z-[1100] max-h-[calc(100dvh-16px)] min-w-[200px] max-w-[calc(100vw-16px)] overflow-auto rounded-md border border-line bg-bg py-1 shadow-pop"
      style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}
      onKeyDown={(e) => {
        e.stopPropagation();
        const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          btns[(i + 1) % btns.length]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          btns[(i - 1 + btns.length) % btns.length]?.focus();
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          (e.key === 'Home' ? btns[0] : btns.at(-1))?.focus();
        }
      }}
    >
      {menu.title && <div title={menu.title} className="max-w-[340px] truncate border-b border-line px-3 py-1 text-[12px] font-semibold text-muted">{menu.title}</div>}
      {menu.items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          className={`flex min-h-7 w-full items-center gap-3 px-3 py-1 text-left text-[12.5px] hover:bg-hover focus:bg-hover focus:outline-none disabled:opacity-40 ${it.danger ? 'text-danger' : ''}`}
          onClick={() => {
            close(true);
            it.run();
          }}
        >
          <span className="flex-1">{it.label}</span>
          {it.hint && <span className="text-[11px] text-faint">{it.hint}</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
