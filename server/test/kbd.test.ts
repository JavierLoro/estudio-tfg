import { afterEach, describe, expect, it, vi } from 'vitest';
import { kbd } from '../../web/src/lib/kbd.ts';

describe('texto de atajos por plataforma', () => {
  it.each([
    ['Mod-Shift-C', '⌘⇧C', 'Ctrl+Mayús+C'],
    ['Mod-s', '⌘S', 'Ctrl+S'],
    ['Mod-Enter', '⌘↵', 'Ctrl+Intro'],
    ['Shift-Enter', '⇧↵', 'Mayús+Intro'],
    ['Alt-Enter', '⌥↵', 'Alt+Intro'],
    ['Alt-clic', '⌥clic', 'Alt+clic'],
    ['Mod-clic', '⌘clic', 'Ctrl+clic'],
    ['Mod-Backspace', '⌘⌫', 'Ctrl+Retroceso'],
    ['Delete', '⌦', 'Supr'],
    ['Mod-+', '⌘+', 'Ctrl++'],
    ['Mod--', '⌘−', 'Ctrl+−'],
    ['Mod-Shift-z', '⌘⇧Z', 'Ctrl+Mayús+Z'],
    ['Ctrl-Alt-ArrowLeft', '⌃⌥←', 'Ctrl+Alt+←'],
    ['Escape', 'Esc', 'Esc'],
    ['F2', 'F2', 'F2'],
    ['Enter', '↵', 'Intro'],
    ['Backspace', '⌫', 'Retroceso'],
  ])('%s en Mac y fuera de Mac', (shortcut, mac, other) => {
    expect(kbd(shortcut, true)).toBe(mac);
    expect(kbd(shortcut, false)).toBe(other);
  });
});

describe('detección de plataforma para los textos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each([
    ['MacIntel', true],
    ['iPad', true],
    ['Win32', false],
    ['Linux x86_64', false],
  ])('%s', async (platform, mac) => {
    vi.stubGlobal('navigator', { platform, userAgent: '' });
    vi.resetModules();
    const helper = await import('../../web/src/lib/kbd.ts');
    expect(helper.isMac).toBe(mac);
    expect(helper.kbd('Mod-Shift-C')).toBe(kbd('Mod-Shift-C', mac));
  });

  it('permite importarlo sin navegador', async () => {
    vi.stubGlobal('navigator', undefined);
    vi.resetModules();
    const helper = await import('../../web/src/lib/kbd.ts');
    expect(helper.kbd('Mod-Shift-C')).toBe('Ctrl+Mayús+C');
  });
});
