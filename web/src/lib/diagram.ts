// Diagramas de la memoria (v0.8): dibujo con aspecto de impresión, preparación del SVG para
// exportar y PNG a 2×. Se carga en diferido (lleva Mermaid y la fuente).
//
// Fidelidad: el navegador mide el texto con la fuente con la que el worker (rsvg-convert)
// lo dibuja. Es Source Sans 3 de @fontsource/source-sans-3 (versión fija, la misma que
// descarga worker/Dockerfile), y se cargan exactamente los mismos .woff que instala el
// worker. Las etiquetas son texto SVG puro (htmlLabels: false, sin foreignObject).

import type { MermaidConfig } from 'mermaid';
import latin400 from '@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff?url';
import latin400i from '@fontsource/source-sans-3/files/source-sans-3-latin-400-italic.woff?url';
import latin700 from '@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff?url';
import latin700i from '@fontsource/source-sans-3/files/source-sans-3-latin-700-italic.woff?url';
import ext400 from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-400-normal.woff?url';
import ext700 from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-700-normal.woff?url';
import { withMermaid } from './mermaid';

export const DIAGRAM_FONT = 'Source Sans 3';
const FONT_STACK = `"${DIAGRAM_FONT}", sans-serif`;

// Rangos de los subconjuntos de fontsource (latin y latin-ext).
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const FACES: { url: string; weight: string; style: string; range: string }[] = [
  { url: latin400, weight: '400', style: 'normal', range: LATIN },
  { url: latin400i, weight: '400', style: 'italic', range: LATIN },
  { url: latin700, weight: '700', style: 'normal', range: LATIN },
  { url: latin700i, weight: '700', style: 'italic', range: LATIN },
  { url: ext400, weight: '400', style: 'normal', range: LATIN_EXT },
  { url: ext700, weight: '700', style: 'normal', range: LATIN_EXT },
];

let fontsPromise: Promise<void> | null = null;

/** Registra y carga la fuente de los diagramas (una vez). Sin ella no se dibuja: las medidas saldrían mal. */
export function loadDiagramFont(): Promise<void> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const faces = FACES.map((f) => new FontFace(DIAGRAM_FONT, `url(${f.url}) format('woff')`, { weight: f.weight, style: f.style, unicodeRange: f.range }));
      for (const f of faces) document.fonts.add(f);
      await Promise.all(faces.map((f) => f.load()));
      await Promise.all([document.fonts.load(`400 16px "${DIAGRAM_FONT}"`), document.fonts.load(`700 16px "${DIAGRAM_FONT}"`)]);
    })();
    fontsPromise.catch(() => {
      fontsPromise = null;
    });
  }
  return fontsPromise;
}

/** Configuración de impresión: tema neutro (negro y grises), texto SVG puro y la fuente de los diagramas. */
export function printConfig(seed: string): MermaidConfig {
  return {
    theme: 'neutral',
    darkMode: false,
    fontFamily: FONT_STACK,
    htmlLabels: false,
    // Los ajustes por tipo están obsoletos (manda htmlLabels), pero se fijan por si acaso.
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
    themeVariables: { fontFamily: FONT_STACK, fontSize: '15px', background: '#ffffff' },
    // Impresión: sin sombras ni filtros (además, las sombras meten transparencias en el PDF y
    // pdfTeX avisa «multiple pdfs with page group» si dos figuras caen en la misma página) y con
    // el fondo de las etiquetas de las flechas opaco (la línea no las tacha).
    themeCSS: '*{filter:none !important;}.edgeLabel rect,.labelBkg{opacity:1 !important;fill:#ffffff !important;background-color:#ffffff !important;}',
    // Mismos ids para la misma fuente: el SVG exportado no cambia si el diagrama no cambia.
    deterministicIds: true,
    deterministicIDSeed: seed,
  };
}

/**
 * «Mermaid» para el lienzo editable (Visimer): mismo dibujo que el de la exportación (tema de
 * impresión, texto SVG puro, misma fuente) y pasando por la cola de lib/mermaid.ts, para no
 * pisar la configuración global de las notas. Ignora el `initialize` de Visimer.
 */
export function canvasMermaid(seed: string) {
  return {
    initialize: () => undefined,
    parse: (code: string) => withMermaid(printConfig(seed), (m) => m.parse(code)),
    render: async (id: string, code: string) => {
      await loadDiagramFont();
      return withMermaid(printConfig(seed), (m) => m.render(id, code));
    },
  };
}

export interface RenderOk {
  ok: true;
  svg: string;
  width: number;
  height: number;
}
export interface RenderError {
  ok: false;
  message: string;
  /** Línea de la fuente (1-based) si Mermaid la indica. */
  line: number | null;
}

/** Línea del error de Mermaid: «Parse error on line 3», hash.loc o «line: 3». */
function errorLine(e: unknown): number | null {
  const any = e as { hash?: { loc?: { first_line?: number }; line?: number }; message?: string };
  const loc = any?.hash?.loc?.first_line;
  if (typeof loc === 'number' && loc > 0) return loc;
  if (typeof any?.hash?.line === 'number') return any.hash.line + 1;
  const m = /line[:\s]+(\d+)/i.exec(String(any?.message ?? e));
  return m ? Number(m[1]) : null;
}

function cleanMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s+$/, '');
}

let seq = 0;

/**
 * Dibuja la fuente con el aspecto de impresión y devuelve el SVG ya preparado para exportar.
 * `id`: id del <svg> (fijo al exportar, para que el archivo no cambie si la fuente no cambia).
 */
export async function renderDiagram(code: string, seed = 'diagrama', fixedId?: string): Promise<RenderOk | RenderError> {
  if (!code.trim()) return { ok: false, message: 'El diagrama está vacío', line: 1 };
  await loadDiagramFont();
  const id = fixedId ?? `et-diagram-${++seq}`;
  try {
    const out = await withMermaid(printConfig(seed), async (m) => {
      await m.parse(code);
      return m.render(id, code);
    });
    return { ok: true, ...prepareSvg(out.svg) };
  } catch (e) {
    return { ok: false, message: cleanMessage(e), line: errorLine(e) };
  } finally {
    // Mermaid deja a veces el contenedor temporal (p. ej. tras un error).
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/**
 * SVG listo para el worker: tamaño explícito en px (el del viewBox; Mermaid pone width="100%"
 * y max-width), xmlns, sin foreignObject. Lanza si no se puede convertir fielmente.
 */
export function prepareSvg(svgText: string): { svg: string; width: number; height: number } {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('Mermaid no generó un SVG válido');
  if (root.getElementsByTagName('foreignObject').length) throw new Error('El diagrama usa etiquetas HTML (foreignObject): no se puede exportar fielmente');
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) throw new Error('El SVG no tiene un viewBox válido');
  const width = Math.ceil(vb[2]);
  const height = Math.ceil(vb[3]);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  const style = (root.getAttribute('style') ?? '')
    .split(';')
    .filter((d) => d.trim() && !/^\s*max-width\s*:/i.test(d))
    .join(';');
  if (style) root.setAttribute('style', style);
  else root.removeAttribute('style');
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Mermaid parte las etiquetas en un <tspan> por palabra con el espacio al principio
  // («+String», « nombre»). El navegador lo respeta, pero rsvg-convert descarta el espacio
  // inicial de cada tspan (y dibuja el espacio duro sin anchura): las palabras saldrían
  // pegadas. Con xml:space="preserve" en cada <text> los dos lo respetan igual; antes se
  // quitan los nodos de solo espacios con saltos de línea (sangrías), que sí se verían.
  for (const t of Array.from(root.getElementsByTagName('text'))) {
    const walker = doc.createTreeWalker(t, NodeFilter.SHOW_TEXT);
    const drop: Node[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/^\s*\n\s*$/.test(n.nodeValue ?? '')) drop.push(n);
    for (const n of drop) n.parentNode?.removeChild(n);
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  }
  // Diagramas de estados: Mermaid da a cada estado un ancho mínimo y deja la etiqueta pegada
  // a la izquierda (igual en el navegador); en papel queda mejor centrada en su caja.
  for (const label of Array.from(root.querySelectorAll('g.node.statediagram-state > g.label'))) {
    const box = label.parentElement?.querySelector(':scope > rect.label-container');
    const m = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(label.getAttribute('transform') ?? '');
    if (!box || !m || Math.abs(Number(box.getAttribute('x')) * 2 + Number(box.getAttribute('width'))) > 0.5) continue;
    label.setAttribute('transform', `translate(0, ${m[2]})`);
    for (const t of Array.from(label.getElementsByTagName('text'))) t.setAttribute('text-anchor', 'middle');
  }
  return { svg: new XMLSerializer().serializeToString(root), width, height };
}

// ---- PNG a 2× ----

let fontCssPromise: Promise<string> | null = null;

/** @font-face con la fuente incrustada (un SVG dibujado como imagen no ve las fuentes de la página). */
function embeddedFontCss(): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = Promise.all(
      FACES.map(async (f) => {
        const buf = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return `@font-face{font-family:"${DIAGRAM_FONT}";font-weight:${f.weight};font-style:${f.style};unicode-range:${f.range};src:url(data:font/woff;base64,${btoa(bin)}) format("woff");}`;
      }),
    ).then((l) => l.join(''));
    fontCssPromise.catch(() => {
      fontCssPromise = null;
    });
  }
  return fontCssPromise;
}

/** PNG del SVG preparado a `scale`× con fondo blanco. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const css = await embeddedFontCss();
  const withFont = svg.replace(/<svg\b[^>]*>/, (tag) => `${tag}<style>${css}</style>`);
  const url = URL.createObjectURL(new Blob([withFont], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo dibujar el SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite dibujar en canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar el PNG'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
