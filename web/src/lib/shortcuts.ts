import { isMac, kbd } from './kbd.js';

export type Shortcut = 'quickOpen' | 'capture' | 'showInPdf' | 'noteMode' | 'sidebar' | 'save';

/** F8/F9 no usan AltGr ni los atajos de las herramientas del navegador. */
export function shortcutFor(action: Shortcut, mac = isMac): string {
  switch (action) {
    case 'capture': return mac ? 'Mod-Shift-C' : 'Ctrl-Shift-F8';
    case 'showInPdf': return mac ? 'Mod-Shift-j' : 'Ctrl-Shift-F9';
    case 'quickOpen': return 'Mod-K';
    case 'noteMode': return 'Mod-E';
    case 'sidebar': return 'Mod-B';
    case 'save': return 'Mod-S';
  }
}

type KeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'getModifierState'>;

/** Coincidencia exacta: AltGr, composición y modificadores extra no ejecutan acciones. */
export function matchesShortcut(e: KeyEvent, action: Shortcut, mac = isMac): boolean {
  if (e.isComposing || e.altKey || e.getModifierState('AltGraph')) return false;
  if (mac ? !(e.metaKey || e.ctrlKey) : (!e.ctrlKey || e.metaKey)) return false;
  const parts = shortcutFor(action, mac).split('-');
  return e.shiftKey === parts.includes('Shift') && e.key.toLowerCase() === parts.at(-1)!.toLowerCase();
}

type SideEvent = { altKey: boolean; ctrlKey: boolean; shiftKey: boolean; button?: number };

export function sideByEvent(e: SideEvent): boolean {
  return e.altKey || (e.ctrlKey && e.shiftKey) || e.button === 1;
}

export function sideHint(mac = isMac): string {
  return kbd(mac ? 'Alt-clic' : 'Ctrl-Shift-clic', mac);
}
