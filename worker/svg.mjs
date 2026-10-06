// Validación del SVG que llega a POST /svg2pdf (diagramas de la memoria, v0.8).
//
// No es un parser XML: es una lista de rechazos conservadora sobre el texto. El SVG
// lo genera Mermaid en el navegador; aquí solo se comprueba que no pueda hacer que
// rsvg-convert cargue nada de fuera (DTD/entidades, hojas de estilo, imágenes o
// fuentes por URL). Además, el worker pasa el SVG por stdin (sin URL base), así que
// rsvg no puede resolver rutas relativas aunque se colara alguna.

export const MAX_SVG_BYTES = 5 * 1024 * 1024;

/** Referencia local permitida: `#id` o `data:` (incrustada). */
const isLocalRef = (v) => /^\s*(#|data:)/i.test(v);

/**
 * Devuelve null si el SVG es aceptable o el motivo (en español) si no.
 * @param {string} text
 */
export function checkSvg(text) {
  if (typeof text !== 'string' || !text.trim()) return 'El SVG está vacío';
  if (Buffer.byteLength(text, 'utf8') > MAX_SVG_BYTES) return `El SVG supera el máximo de ${MAX_SVG_BYTES / 1024 / 1024} MB`;
  if (text.includes('\0')) return 'El SVG contiene caracteres NUL';
  // Sin DTD ni entidades (XXE, «billion laughs») ni hojas de estilo externas.
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) return 'El SVG no puede declarar DOCTYPE ni entidades';
  if (/<\?xml-stylesheet/i.test(text)) return 'El SVG no puede enlazar hojas de estilo externas';
  // Raíz: <svg …> tras la declaración XML, comentarios y espacios.
  const head = text.replace(/^﻿/, '').replace(/^(\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->)*/, '');
  if (!/^<svg[\s>]/.test(head)) return 'No es un SVG (la raíz debe ser <svg>)';
  // href / xlink:href / src: solo anclas internas o data:.
  const attr = /(?:^|[\s"'])((?:[A-Za-z_][\w.-]*:)?(?:href|src))\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of text.matchAll(attr)) {
    const v = m[2] ?? m[3] ?? '';
    if (!isLocalRef(v)) return `Referencia externa no permitida (${m[1]}="${v.slice(0, 60)}")`;
  }
  // CSS: sin @import y con url() solo internas.
  if (/@import/i.test(text)) return 'El SVG no puede importar hojas de estilo (@import)';
  for (const m of text.matchAll(/url\(\s*(?:&quot;|&apos;|["'])?([^"')&]*)/gi)) {
    if (!isLocalRef(m[1])) return `Referencia externa no permitida (url(${m[1].slice(0, 60)}))`;
  }
  // Escapes CSS que podrían disfrazar `url(` o `@import` (p. ej. `u\72l(`).
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (/\\[0-9a-f]/i.test(m[1])) return 'El CSS del SVG no puede usar escapes';
  }
  if (/\sstyle\s*=\s*("[^"]*\\[0-9a-f][^"]*"|'[^']*\\[0-9a-f][^']*')/i.test(text)) return 'El CSS del SVG no puede usar escapes';
  return null;
}
