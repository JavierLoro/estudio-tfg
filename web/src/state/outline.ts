// Vista Documento (v0.3): índice de la memoria (GET /api/memoria/outline).
// Se recarga al arrancar, con SSE `outline`, al aplicar ajustes y, como respaldo,
// tras guardar/compilar o cambios en disco de la memoria.

import { create } from 'zustand';
import { api, ApiError, errorMessage, type NewSectionRequest, type OutlineItem, type OutlineResponse } from '../api';

interface OutlineState {
  data: OutlineResponse | null;
  error: string | null;
  /** El servidor no tiene el endpoint (404): se sugiere la pestaña Archivos. */
  unavailable: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  setData: (d: OutlineResponse) => void;
}

let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export const useOutline = create<OutlineState>((set) => ({
  data: null,
  error: null,
  unavailable: false,
  loading: false,
  refresh: async () => {
    const mine = ++seq;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    set({ loading: true });
    try {
      const data = await api.outline();
      if (mine !== seq) return;
      set({ data: normalizeOutline(data), error: null, unavailable: false });
    } catch (e) {
      if (mine !== seq) return;
      const unavailable = e instanceof ApiError && e.status === 404;
      set({ error: unavailable ? 'El servidor no ofrece la vista Documento.' : errorMessage(e), unavailable });
    } finally {
      if (mine === seq) set({ loading: false });
    }
  },
  setData: (d) => {
    seq++;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    set({ data: normalizeOutline(d), error: null, unavailable: false, loading: false });
  },
}));

/** Recarga diferida (respaldo si no llega el SSE `outline`). */
export function refreshOutlineSoon(delay = 1200) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void useOutline.getState().refresh();
  }, delay);
}

/** Datos del SSE `outline`: el índice completo o solo un aviso. */
export function handleOutlineEvent(raw: string) {
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* aviso sin datos */
  }
  if (data && typeof data === 'object' && Array.isArray((data as OutlineResponse).items)) {
    useOutline.getState().setData(data as OutlineResponse);
  } else {
    void useOutline.getState().refresh();
  }
}

/** Crea un apartado. En 409 relee el índice antes de propagar el error. */
export async function createSection(body: NewSectionRequest) {
  try {
    const r = await api.createSection(body);
    void useOutline.getState().refresh();
    return r;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) await useOutline.getState().refresh();
    throw e;
  }
}

function normalizeItem(it: OutlineItem): OutlineItem {
  return {
    ...it,
    title: it.title ?? '',
    number: it.number ?? null,
    line: typeof it.line === 'number' && it.line > 0 ? it.line : 1,
    enabled: it.enabled !== false,
    words: typeof it.words === 'number' ? it.words : 0,
    warnings: Array.isArray(it.warnings) ? it.warnings : [],
    children: Array.isArray(it.children) ? it.children.map(normalizeItem) : [],
  };
}

/** Tolerante con respuestas incompletas (campos ausentes no rompen la interfaz). */
function normalizeOutline(d: OutlineResponse): OutlineResponse {
  return {
    main: d.main ?? '',
    items: Array.isArray(d.items) ? d.items.map(normalizeItem) : [],
    words: typeof d.words === 'number' ? d.words : 0,
    generatedAt: d.generatedAt ?? '',
    warnings: Array.isArray(d.warnings) ? d.warnings : [],
  };
}

/** Recorrido en orden del documento. */
export function walkOutline(items: OutlineItem[], fn: (it: OutlineItem, depth: number, parent: OutlineItem | null) => void, depth = 0, parent: OutlineItem | null = null) {
  for (const it of items) {
    fn(it, depth, parent);
    walkOutline(it.children, fn, depth + 1, it);
  }
}

/** id → posición en el orden del documento. */
export function outlineOrder(data: OutlineResponse | null): Map<string, number> {
  const m = new Map<string, number>();
  if (!data) return m;
  let i = 0;
  walkOutline(data.items, (it) => m.set(it.id, i++));
  return m;
}

export function findOutlineItem(data: OutlineResponse | null, id: string): OutlineItem | null {
  let found: OutlineItem | null = null;
  if (data) walkOutline(data.items, (it) => {
    if (!found && it.id === id) found = it;
  });
  return found;
}

/** «3.2 Azure Policy» */
export function outlineLabel(it: { number: string | null; title: string }): string {
  return it.number ? `${it.number} ${it.title}` : it.title;
}

/** 950 → «950», 1234 → «1,2k», 12000 → «12k». */
export function compactWords(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  const s = k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, '');
  return s.replace('.', ',') + 'k';
}
