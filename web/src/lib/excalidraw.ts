import './excalidrawAssets';
import { exportToSvg, exportToCanvas, getCommonBounds } from '@excalidraw/excalidraw';
import type { ExcalidrawElement, NonDeleted } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import { parseExcalidraw } from '../../../shared/excalidraw';
import type { RenderError, RenderOk } from './diagram';

declare global { interface Window { EXCALIDRAW_ASSET_PATH?: string } }
export { parseExcalidraw };
const sources = import.meta.glob('../assets/excalidraw/*.excalidraw', { query: '?raw', import: 'default' });
export async function excalidrawTemplate(id: string): Promise<string> {
  if (id === 'vacio') return JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} });
  const source = sources[`../assets/excalidraw/${id}.excalidraw`];
  if (!source) throw new Error('Plantilla Excalidraw no disponible');
  return await source() as string;
}

export function excalidrawSize(content: string): { ok: true; width: number; height: number } | RenderError {
  try {
    const elements = parseExcalidraw(content).elements.filter(e => !e.isDeleted) as ExcalidrawElement[];
    if (!elements.length) throw new Error('Añade contenido al dibujo antes de exportarlo');
    const [x, y, right, bottom] = getCommonBounds(elements);
    return { ok: true, width: right - x + 20, height: bottom - y + 20 };
  } catch (e) { return { ok: false, message: (e as Error).message, line: null }; }
}

export async function renderExcalidraw(content: string): Promise<(RenderOk & { pdf: string }) | RenderError> {
  try {
    const scene = parseExcalidraw(content);
    const elements = scene.elements.filter(e => !e.isDeleted) as NonDeleted<ExcalidrawElement>[];
    if (!elements.length) throw new Error('Añade contenido al dibujo antes de exportarlo');
    const appState = { ...scene.appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false } as Partial<AppState>;
    const files = scene.files as BinaryFiles;
    const svg = await exportToSvg({ elements, appState, files });
    const [, , width, height] = svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const scale = 300 / 96;
    if (!Number.isFinite(width + height) || width <= 0 || height <= 0
      || Math.max(width, height) * scale > 16384 || width * height * scale ** 2 > 32_000_000)
      throw new Error('El dibujo es demasiado grande para exportarlo a 300 ppp; divídelo en varios diagramas');
    const canvas = await exportToCanvas({ elements, appState, files,
      getDimensions: (w: number, h: number) => ({ width: Math.ceil(w * scale), height: Math.ceil(h * scale), scale }) });
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'pt', format: [width * 0.75, height * 0.75], orientation: width > height ? 'landscape' : 'portrait', compress: true });
    // shortcut: PDF como imagen a 300 ppp; usar otro conversor si se necesita texto seleccionable.
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width * 0.75, height * 0.75);
    canvas.width = canvas.height = 0;
    return { ok: true, svg: svg.outerHTML, width, height, pdf: pdf.output('datauristring').split(',')[1] };
  } catch (e) { return { ok: false, message: (e as Error).message, line: null }; }
}
