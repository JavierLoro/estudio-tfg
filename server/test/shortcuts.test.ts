import { describe, expect, it } from 'vitest';
import { matchesShortcut, shortcutFor, sideByEvent, sideHint, type Shortcut } from '../../web/src/lib/shortcuts.ts';
import { kbd } from '../../web/src/lib/kbd.ts';
import { EditorState } from '../../web/node_modules/@codemirror/state/dist/index.js';
import { keymap, runScopeHandlers, type EditorView } from '../../web/node_modules/@codemirror/view/dist/index.js';

const key = (name: string, extra: Partial<KeyboardEvent> = {}) => ({
  key: name, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
  isComposing: false, getModifierState: () => false, ...extra,
});

describe('atajos de acciones sin conflictos con AltGr', () => {
  it.each<[Shortcut, string, string]>([
    ['capture', 'Mod-Shift-C', 'Ctrl-Shift-F8'],
    ['showInPdf', 'Mod-Shift-j', 'Ctrl-Shift-F9'],
    ['quickOpen', 'Mod-K', 'Mod-K'],
    ['noteMode', 'Mod-E', 'Mod-E'],
    ['sidebar', 'Mod-B', 'Mod-B'],
    ['save', 'Mod-S', 'Mod-S'],
  ])('%s mantiene Mac y usa la misma combinación en textos y eventos', (action, mac, other) => {
    expect(shortcutFor(action, true)).toBe(mac);
    expect(shortcutFor(action, false)).toBe(other);
    for (const [shortcut, isMac] of [[mac, true], [other, false]] as const) {
      const parts = shortcut.split('-');
      expect(matchesShortcut(key(parts.at(-1)!, {
        ctrlKey: !isMac, metaKey: isMac, shiftKey: parts.includes('Shift'),
      }), action, isMac)).toBe(true);
    }
  });

  it('los atajos antiguos de DevTools no ejecutan acciones fuera de Mac', () => {
    expect(matchesShortcut(key('C', { shiftKey: true }), 'capture', false)).toBe(false);
    expect(matchesShortcut(key('J', { shiftKey: true }), 'showInPdf', false)).toBe(false);
    expect(kbd(shortcutFor('capture', false), false)).toBe('Ctrl+Mayús+F8');
    expect(kbd(shortcutFor('showInPdf', false), false)).toBe('Ctrl+Mayús+F9');
  });

  it.each([
    { ctrlKey: false }, { metaKey: true }, { shiftKey: true }, { altKey: true },
    { isComposing: true }, { getModifierState: (name: string) => name === 'AltGraph' },
  ])('no captura escritura ni modificadores extra: %j', (extra) => {
    expect(matchesShortcut(key('k', extra), 'quickOpen', false)).toBe(false);
  });

  it('AltGr no abre Capturar aunque otra tecla coincida', () => {
    expect(matchesShortcut(key('F8', { shiftKey: true, altKey: true }), 'capture', false)).toBe(false);
    expect(matchesShortcut(key('F8', { shiftKey: true, getModifierState: () => true }), 'capture', false)).toBe(false);
  });

  it.each([true, false])('CodeMirror ejecuta Ver en PDF con Mayús (Mac=%s)', (mac) => {
    let calls = 0;
    const state = EditorState.create({ extensions: keymap.of([{
      // Mod depende del SO donde corre el test; aquí se fija la tecla de cada plataforma.
      key: shortcutFor('showInPdf', mac).replace('Mod-', 'Meta-'),
      preventDefault: true,
      run: () => { calls++; return true; },
    }]) });
    const view = { state } as EditorView;
    const event = key(mac ? 'J' : 'F9', {
      metaKey: mac, ctrlKey: !mac, shiftKey: true, keyCode: mac ? 74 : 120,
    }) as KeyboardEvent;
    expect(runScopeHandlers(view, event, 'editor')).toBe(true);
    expect(calls).toBe(1);
    expect(runScopeHandlers(view, { ...event, altKey: true }, 'editor')).toBe(false);
    expect(calls).toBe(1);
  });
});

describe('apertura al lado independiente del gestor de ventanas', () => {
  it.each<[Partial<{ altKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }>, boolean]>([
    [{}, false], [{ altKey: true }, true], [{ ctrlKey: true, shiftKey: true }, true],
    [{ button: 1 }, true], [{ ctrlKey: true }, false], [{ shiftKey: true }, false], [{ button: 2 }, false],
  ])('%j → %s', (extra, side) => {
    expect(sideByEvent({ altKey: false, ctrlKey: false, shiftKey: false, ...extra })).toBe(side);
  });

  it('anuncia un gesto sin Alt fuera de Mac y conserva el texto de Mac', () => {
    expect(sideHint(true)).toBe('⌥clic');
    expect(sideHint(false)).toBe('Ctrl+Mayús+clic');
  });
});
