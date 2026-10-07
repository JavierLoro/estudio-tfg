export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEYS: Record<string, string> = {
  Escape: 'Esc',
  Space: 'Espacio',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  '-': '−',
};

const MAC_KEYS: Record<string, string> = {
  ...KEYS,
  Mod: '⌘', Meta: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Shift: '⇧',
  Enter: '↵', Backspace: '⌫', Delete: '⌦', Tab: '⇥',
};

const OTHER_KEYS: Record<string, string> = {
  ...KEYS,
  Mod: 'Ctrl', Control: 'Ctrl', Shift: 'Mayús',
  Enter: 'Intro', Backspace: 'Retroceso', Delete: 'Supr',
};

/** Texto de un atajo con sintaxis de CodeMirror; `mac` permite probar ambas plataformas. */
export function kbd(shortcut: string, mac = isMac): string {
  const keys = mac ? MAC_KEYS : OTHER_KEYS;
  // Conserva el último guion cuando es la propia tecla (Mod--).
  return shortcut.split(/-(?=.)/)
    .map((key) => keys[key] ?? (key.length === 1 ? key.toUpperCase() : key))
    .join(mac ? '' : '+');
}
