// Solo se carga cuando el motor local carece de rsvg-convert. No rasteriza el texto.
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import regular from '@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff?sfnt';
import italic from '@fontsource/source-sans-3/files/source-sans-3-latin-400-italic.woff?sfnt';
import bold from '@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff?sfnt';
import bolditalic from '@fontsource/source-sans-3/files/source-sans-3-latin-700-italic.woff?sfnt';
import extRegular from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-400-normal.woff?sfnt';
import extItalic from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-400-italic.woff?sfnt';
import extBold from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-700-normal.woff?sfnt';
import extBolditalic from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-700-italic.woff?sfnt';
import { prepareSvg } from './diagram';

const FONTS = {
  SourceSans3: { normal: regular, italic, bold, bolditalic },
  SourceSans3Ext: { normal: extRegular, italic: extItalic, bold: extBold, bolditalic: extBolditalic },
};
let fontsReady: Promise<void> | undefined;

function loadPdfFont(): Promise<void> {
  return fontsReady ??= Promise.all(Object.entries(FONTS).flatMap(([family, fonts]) => Object.entries(fonts).map(async ([style, data]) => {
    const face = new FontFace(family, `url(data:font/ttf;base64,${data})`, {
      weight: style.startsWith('bold') ? '700' : '400', style: style.endsWith('italic') ? 'italic' : 'normal',
    });
    await face.load();
    document.fonts.add(face);
  }))).then(() => undefined).catch(error => { fontsReady = undefined; throw error; });
}

/** Convierte el SVG de impresión generado por Mermaid; devuelve PDF en base64 para la API. */
export async function diagramPdf(svg: string): Promise<string> {
  await loadPdfFont();
  const { width, height } = prepareSvg(svg);
  if (Math.max(width, height) * 0.75 > 14400) throw new Error('El diagrama supera el tamaño máximo del PDF; divídelo antes de exportar');
  const root = document.importNode(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement, true);
  const doc = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'pt',
    format: [width * 0.75, height * 0.75], putOnlyUsedFonts: true, compress: true });
  for (const [family, fonts] of Object.entries(FONTS)) for (const [style, font] of Object.entries(fonts)) {
    const file = `${family}-${style}.ttf`;
    doc.addFileToVFS(file, font);
    doc.addFont(file, family, style);
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;pointer-events:none';
  host.appendChild(root);
  document.body.appendChild(host);
  try {
    // Resolver el CSS con el navegador evita diferencias en cascada, colores y pesos «bolder».
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (!(el instanceof SVGElement)) continue;
      const css = getComputedStyle(el);
      for (const property of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
        'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight', 'font-style', 'text-anchor'])
        el.style.setProperty(property, css.getPropertyValue(property));
      el.style.fontFamily = 'SourceSans3';
      const gradient = /^url\(["']?#([^"')]+)["']?\)$/.exec(css.stroke);
      if (gradient) {
        // shortcut: borde degradado aproximado por su gris medio; cambiar el conversor si se exige fidelidad exacta del trazo.
        const stops = root.querySelector(`#${CSS.escape(gradient[1])}`)?.querySelectorAll('stop');
        if (!stops?.length) throw new Error('El borde del diagrama tiene un degradado no válido');
        const colors = Array.from(stops, stop => getComputedStyle(stop).stopColor.match(/[\d.]+/g)!.map(Number));
        el.style.stroke = `rgb(${[0, 1, 2].map(i => Math.round(colors.reduce((sum, color) => sum + color[i], 0) / colors.length)).join(',')})`;
        // Un degradado horizontal sin ancho no se pinta en rsvg (divisores verticales de las entidades).
        if (el instanceof SVGGraphicsElement && el.getBBox().width < 0.001) el.style.stroke = 'none';
      }
      // En SVG «0 0» es continuo; PDF lo interpreta como una línea invisible.
      if (/^[0\s,.px]+$/.test(css.strokeDasharray)) el.style.strokeDasharray = 'none';
    }
    root.querySelectorAll('style').forEach(el => el.remove());
    // Los subconjuntos TTF no tienen fallback automático como las fuentes CSS del navegador.
    for (const text of root.querySelectorAll('text')) {
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      for (const node of nodes) {
        const css = getComputedStyle(node.parentElement!);
        const style = (Number(css.fontWeight) >= 600 ? 'bold' : '') + (css.fontStyle === 'italic' ? 'italic' : '') || 'normal';
        doc.setFont('SourceSans3', style);
        const latin = doc.getFont().metadata;
        doc.setFont('SourceSans3Ext', style);
        const extended = doc.getFont().metadata;
        const runs: { family: string; text: string }[] = [];
        for (const char of node.data) {
          const code = char.codePointAt(0)!;
          const family = /\s/.test(char) || latin.characterToGlyph(code) ? 'SourceSans3' : extended.characterToGlyph(code) ? 'SourceSans3Ext' : null;
          if (!family || code > 0xffff) throw new Error(`La fuente del PDF no incluye «${char}»; cambia ese carácter antes de exportar`);
          if (runs.at(-1)?.family === family) runs.at(-1)!.text += char;
          else runs.push({ family, text: char });
        }
        if (runs.some(run => run.family === 'SourceSans3Ext')) {
          const parent = node.parentElement!;
          const replaceSpan = parent.localName === 'tspan' && parent.childNodes.length === 1;
          const spans = runs.map((run, i) => {
            const span = replaceSpan ? parent.cloneNode(false) as SVGElement : document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            if (i > 0) for (const attribute of ['id', 'x', 'y', 'dx', 'dy']) span.removeAttribute(attribute);
            span.style.fontFamily = run.family;
            span.textContent = run.text;
            return span;
          });
          if (replaceSpan) parent.replaceWith(...spans);
          else node.replaceWith(...spans);
        }
      }
    }
    await svg2pdf(root, doc, { width: width * 0.75, height: height * 0.75, loadImages: false, loadExternalStyleSheets: false });
    return doc.output('datauristring').split(',')[1];
  } finally { host.remove(); }
}
