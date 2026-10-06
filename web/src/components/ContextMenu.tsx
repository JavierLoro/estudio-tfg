import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

export interface MenuItem {
  label: string;
  hint?: string;
  run: () => void;
  danger?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

const useMenu = create<{ menu: MenuState | null }>(() => ({ menu: null }));

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) {
  e.preventDefault();
  useMenu.setState({ menu: { x: e.clientX, y: e.clientY, items } });
}

const close = () => useMenu.setState({ menu: null });

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - menu.items.length * 28 - 12);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[1100] min-w-[200px] rounded-md border border-line bg-bg py-1 shadow-pop"
      style={{ left: x, top: y }}
      onKeyDown={(e) => {
        const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          btns[(i + 1) % btns.length]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          btns[(i - 1 + btns.length) % btns.length]?.focus();
        }
      }}
    >
      {menu.items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={`flex h-7 w-full items-center gap-3 px-3 text-left text-[12.5px] hover:bg-hover focus:bg-hover focus:outline-none ${it.danger ? 'text-danger' : ''}`}
          onClick={() => {
            close();
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
