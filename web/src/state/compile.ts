import { create } from 'zustand';
import { api, errorMessage, type CompileResult, type Diagnostic } from '../api';
import { load, save } from '../lib/storage';
import { normalize } from '../lib/paths';
import { refreshOutlineSoon } from './outline';

interface CompileState {
  last: CompileResult | null;
  compiling: boolean;
  error: string | null;
  /** Momento (cliente) en que se lanzó la última compilación que terminó. */
  lastCompileRequestedAt: number;
  /** Último guardado/cambio en disco de cualquier archivo de la memoria. */
  memoriaChangedAt: number;
  markMemoriaChanged: () => void;
  setResult: (r: CompileResult, requestedAt?: number) => void;
  fetchLast: () => Promise<void>;
  compile: () => Promise<CompileResult | null>;
}

const KEY = 'et:compile-times';
const saved = load<{ req: number; changed: number }>(KEY, { req: 0, changed: 0 });

function persist(s: { lastCompileRequestedAt: number; memoriaChangedAt: number }) {
  save(KEY, { req: s.lastCompileRequestedAt, changed: s.memoriaChangedAt });
}

let inflightStart = 0;

export const useCompile = create<CompileState>((set, get) => ({
  last: null,
  compiling: false,
  error: null,
  lastCompileRequestedAt: saved.req,
  memoriaChangedAt: saved.changed,

  markMemoriaChanged: () => {
    set({ memoriaChangedAt: Date.now() });
    persist(get());
  },

  setResult: (r, requestedAt) => {
    // Resultado llegado por SSE: si hay una compilación nuestra en curso, usa su inicio.
    const req = requestedAt ?? (inflightStart || Date.parse(r.startedAt) || Date.now());
    set({ last: r, error: null, lastCompileRequestedAt: Math.max(req, get().lastCompileRequestedAt) });
    persist(get());
    // Los avisos «errores» del índice dependen de la última compilación.
    refreshOutlineSoon(800);
  },

  fetchLast: async () => {
    try {
      const r = await api.lastCompile();
      if (r) set({ last: r });
    } catch {
      /* el panel muestra "sin compilaciones" */
    }
  },

  compile: async () => {
    if (get().compiling) return null;
    const startedAt = Date.now();
    inflightStart = startedAt;
    set({ compiling: true, error: null });
    try {
      const r = await api.compile();
      get().setResult(r, startedAt);
      return r;
    } catch (e) {
      set({ error: errorMessage(e) });
      return null;
    } finally {
      inflightStart = 0;
      set({ compiling: false });
    }
  },
}));

export function isPdfOutdated(s: Pick<CompileState, 'lastCompileRequestedAt' | 'memoriaChangedAt' | 'last'>): boolean {
  if (!s.last) return false;
  return s.memoriaChangedAt > s.lastCompileRequestedAt;
}

/**
 * Normaliza la ruta de un diagnóstico a una ruta relativa a la raíz `memoria`.
 * El worker compila en un temporal, así que puede venir como `./cap.tex`, `/tmp/x/cap.tex`…
 * Devuelve null si es un archivo ajeno a la memoria (p. ej. un .sty de TeX Live).
 */
export function diagPath(file: string, known?: string[]): string | null {
  let f = file.replace(/\\/g, '/');
  if (!f.startsWith('/')) return normalize(f);
  f = normalize(f);
  if (known) {
    // Coincidencia por sufijo más larga con los archivos conocidos.
    let best = '';
    for (const k of known) {
      if ((f === k || f.endsWith('/' + k)) && k.length > best.length) best = k;
    }
    if (best) return best;
    return null;
  }
  return /texmf|texlive/.test(f) ? null : f.slice(f.lastIndexOf('/') + 1);
}

export function countDiags(d: Diagnostic[] | undefined) {
  let errors = 0;
  let warnings = 0;
  for (const x of d ?? []) {
    if (x.severity === 'error') errors++;
    else warnings++;
  }
  return { errors, warnings };
}
