import { create } from 'zustand';
import { api, ApiError, errorMessage, type SynctexForward } from '../api';
import { useCompile } from './compile';
import { useUI } from './ui';
import { openFile, openPdf } from './workspace';

/** Navegación código ↔ PDF (v0.4) y estado compartido del visor. */
interface PdfViewState {
  /** Zona pendiente de mostrar en el visor (código → PDF). */
  target: (SynctexForward & { nonce: number }) | null;
  page: number;
  pages: number;
}

export const usePdfView = create<PdfViewState>(() => ({ target: null, page: 0, pages: 0 }));

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

/** ⌘clic en el PDF: abre el `.tex` en la línea que generó ese punto. */
export async function openFromPdf(page: number, x: number, y: number, side = false) {
  try {
    const r = await api.synctexInverse(page, x, y, shownBuild());
    openFile('memoria', r.file, { line: r.line, side });
  } catch (e) {
    fail(e, 'No hay código asociado a ese punto del PDF.');
  }
}
