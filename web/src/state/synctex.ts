import { useEffect } from 'react';
import { create } from 'zustand';
import { api, ApiError, errorMessage, type SynctexForward, type SynctexOutline } from '../api';
import { useCompile } from './compile';
import { useOutline } from './outline';
import { useUI } from './ui';
import { openFile, openPdf } from './workspace';

/** Navegación código ↔ PDF (v0.4) y estado compartido del visor. */
interface PdfViewState {
  /** Zona pendiente de mostrar en el visor (código → PDF). */
  target: (SynctexForward & { nonce: number }) | null;
  page: number;
  pages: number;
  /** Posición de lectura: punto del PDF (pt, origen arriba) cerca del borde superior de la vista; null sin visor. */
  pos: { page: number; y: number } | null;
  /** Último desplazamiento del visor (`performance.now()`). */
  scrolledAt: number;
}

export const usePdfView = create<PdfViewState>(() => ({ target: null, page: 0, pages: 0, pos: null, scrolledAt: 0 }));

let nonce = 0;

/** Build del PDF que se está mostrando (`/api/pdf/<build>.pdf`). */
export function shownBuild(): string | undefined {
  const url = useCompile.getState().last?.pdfUrl;
  const m = url ? /^\/api\/pdf\/(.+)\.pdf$/.exec(url) : null;
  return m ? decodeURIComponent(m[1]) : undefined;
}

function fail(e: unknown, fallback: string) {
  const text = e instanceof ApiError && e.status === 404 ? fallback : errorMessage(e);
  useUI.getState().toast({ kind: 'warn', text });
}

/** «Ver en PDF»: abre el panel PDF y salta a la zona generada por `file:line`. */
export async function showInPdf(file: string, line: number) {
  if (!useCompile.getState().last?.pdfUrl) {
    useUI.getState().toast({ kind: 'info', text: 'Compila la memoria para poder verla en el PDF.' });
    return;
  }
  try {
    const r = await api.synctexForward(file, line, shownBuild());
    openPdf();
    usePdfView.setState({ target: { ...r, nonce: ++nonce } });
  } catch (e) {
    fail(e, `No se encontró ${file}:${line} en el PDF (¿falta compilar?).`);
  }
}

/** Mod-clic en el PDF: abre el `.tex` en la línea que generó ese punto. */
export async function openFromPdf(page: number, x: number, y: number, side = false) {
  try {
    const r = await api.synctexInverse(page, x, y, shownBuild());
    openFile('memoria', r.file, { line: r.line, side });
  } catch (e) {
    fail(e, 'No hay código asociado a ese punto del PDF.');
  }
}

// ---- Apartado que se está leyendo en el PDF ----

interface OutlineMapState {
  /** Posición del título de cada apartado en el PDF mostrado (orden del documento). */
  map: SynctexOutline | null;
  /** Apartado que contiene la posición de lectura del visor. */
  active: string | null;
}

export const useOutlineMap = create<OutlineMapState>(() => ({ map: null, active: null }));

let mapSeq = 0;
let mapTimer: ReturnType<typeof setTimeout> | null = null;

/** Relee el mapa apartado → PDF (diferido: el índice y el PDF suelen cambiar a la vez). */
function refreshOutlineMapSoon(delay = 400) {
  if (mapTimer) clearTimeout(mapTimer);
  mapTimer = setTimeout(() => {
    mapTimer = null;
    const mine = ++mapSeq;
    if (!useCompile.getState().last?.pdfUrl) {
      useOutlineMap.setState({ map: null });
      return;
    }
    api.synctexOutline(shownBuild()).then(
      (map) => mine === mapSeq && useOutlineMap.setState({ map }),
      // Sin synctex o sin PDF: no se resalta nada.
      () => mine === mapSeq && useOutlineMap.setState({ map: null }),
    );
  }, delay);
}

/** Último apartado cuyo título queda en o por encima de la posición de lectura (empate → el posterior). */
function computeActive(): string | null {
  const pos = usePdfView.getState().pos;
  const items = useOutlineMap.getState().map?.items;
  if (!pos || !items?.length) return null;
  let best: { id: string; page: number; y: number } | null = null;
  for (const it of items) {
    if (it.page > pos.page || (it.page === pos.page && it.y > pos.y)) continue;
    if (!best || it.page > best.page || (it.page === best.page && it.y >= best.y)) best = it;
  }
  return best?.id ?? null;
}

function updateActive() {
  const active = computeActive();
  if (active !== useOutlineMap.getState().active) useOutlineMap.setState({ active });
}

usePdfView.subscribe((s, prev) => {
  if (s.pos !== prev.pos) updateActive();
});
useOutlineMap.subscribe((s, prev) => {
  if (s.map !== prev.map) updateActive();
});

/** id del apartado visible en el PDF; solo provoca renderizado cuando cambia. */
export function useActiveOutlineId(): string | null {
  const pdfUrl = useCompile((s) => s.last?.pdfUrl);
  const outline = useOutline((s) => s.data);
  useEffect(() => refreshOutlineMapSoon(), [pdfUrl, outline]);
  return useOutlineMap((s) => s.active);
}
