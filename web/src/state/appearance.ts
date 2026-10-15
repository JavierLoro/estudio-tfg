import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { load, save } from '../lib/storage';

// Apariencia: preferencias locales de este navegador (no van al servidor).
export type Theme = 'light' | 'dark' | 'system';
export type TextSize = 'normal' | 'grande' | 'muy-grande';
export type Density = 'comoda' | 'compacta';

const KEY = 'et:appearance';

interface Appearance {
  theme: Theme;
  textSize: TextSize;
  density: Density;
}

const DEFAULTS: Appearance = { theme: 'system', textSize: 'normal', density: 'comoda' };

function sanitize(v: Partial<Appearance> | null): Appearance {
  const out = { ...DEFAULTS };
  if (v && ['light', 'dark', 'system'].includes(v.theme as string)) out.theme = v.theme!;
  if (v && ['normal', 'grande', 'muy-grande'].includes(v.textSize as string)) out.textSize = v.textSize!;
  if (v && ['comoda', 'compacta'].includes(v.density as string)) out.density = v.density!;
  return out;
}

/** Atributos en <html>: el CSS de index.css hace el resto (tokens, tamaño raíz, densidad). */
function apply(a: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = a.theme;
  root.dataset.textSize = a.textSize;
  root.dataset.density = a.density;
}

interface AppearanceState extends Appearance {
  set: (patch: Partial<Appearance>) => void;
}

export const useAppearance = create<AppearanceState>((set, get) => {
  const initial = sanitize(load<Partial<Appearance> | null>(KEY, null));
  apply(initial);
  return {
    ...initial,
    set: (patch) => {
      const next = sanitize({ ...get(), ...patch });
      apply(next);
      save(KEY, next);
      set(next);
    },
  };
});

function systemDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** Tema efectivo (resuelve «Sistema»), para lo que no se pinta con CSS: Dockview, mermaid. */
export function isDarkTheme(): boolean {
  const t = useAppearance.getState().theme;
  return t === 'dark' || (t === 'system' && systemDark());
}

export function useDarkTheme(): boolean {
  const theme = useAppearance((s) => s.theme);
  const [sys, setSys] = useState(systemDark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const fn = () => setSys(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return theme === 'dark' || (theme === 'system' && sys);
}
