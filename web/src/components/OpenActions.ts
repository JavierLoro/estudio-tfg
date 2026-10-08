import type { MouseEvent } from 'react';
import { isMac } from '../lib/kbd';
import { sideByEvent, sideHint } from '../lib/shortcuts';
import { openContextMenu, type MenuItem } from './ContextMenu';

/** Los enlaces internos abren paneles, también con el botón central y desde el menú. */
export function openActions(open: (side: boolean) => void, menu?: () => MenuItem[]) {
  return {
    onClick: (e: MouseEvent) => {
      e.preventDefault();
      open(sideByEvent(e));
    },
    onMouseDown: (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault(); // Evitar desplazamiento automático.
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      open(true);
    },
    onContextMenu: (e: MouseEvent) => {
      e.stopPropagation();
      // macOS convierte Ctrl+clic en un clic secundario.
      if (isMac && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        open(true);
        return;
      }
      const items = menu?.() ?? [
        { label: 'Abrir', run: () => open(false) },
        { label: 'Abrir al lado', hint: sideHint(), run: () => open(true) },
      ];
      if (items.length) openContextMenu(e, items);
    },
  };
}
