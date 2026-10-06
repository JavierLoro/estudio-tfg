/**
 * Parser mínimo de SyncTeX (formato de texto, ya descomprimido) y búsquedas
 * directa (código → PDF) e inversa (PDF → código).
 *
 * Coordenadas de salida en puntos PDF (bp) con origen en la esquina superior
 * izquierda de la página. En el archivo, `h` ya incluye el margen de 1in y `v`
 * es la línea base medida desde arriba; ambas en sp × Unit.
 */

/** Caja (`[` vbox / `(` hbox) en orden de apertura (DFS). */
export interface SyncBox {
  kind: 'h' | 'v';
  tag: number;
  line: number;
  page: number;
  h: number;
  v: number;
  w: number;
  ht: number;
  dp: number;
  /** Caja que la contiene (índice en `boxes`) o -1. */
  parent: number;
  /**
   * Contiene directamente hojas del mismo archivo con otra línea: TeX etiqueta las
   * cajas de línea de un párrafo con la línea donde acaba, así que la suya no es fiable.
   */
  mixed: boolean;
}

/** Registro hoja (x, k, g, $, r y cajas vacías v/h). */
export interface SyncLeaf {
  /**
   * Tipo de registro: x, k, g, $, r, h (hbox vacía), v (vbox vacía) o `_` para las
   * marcas sin contenido propio: cajas vacías sin tamaño y la `x` con la que TeX abre
   * cada caja de línea (lleva la línea de la caja, no la del texto que sigue).
   */
  kind: string;
  tag: number;
  line: number;
  page: number;
  h: number;
  v: number;
  /** Caja más interna que la contiene (índice en `boxes`) o -1. */
  box: number;
}

export interface SynctexData {
  /** tag → nombre tal cual aparece en `Input:` (relativo a la memoria o absoluto de TeX Live). */
  files: Map<number, string>;
  boxes: SyncBox[];
  leaves: SyncLeaf[];
  /** Índices por página: rangos [start, end) en boxes/leaves. */
  pages: Map<number, { boxStart: number; boxEnd: number; leafStart: number; leafEnd: number }>;
  /** sp×Unit → bp. */
  scale: number;
  xOffset: number;
  yOffset: number;
}

export interface ForwardHit {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InverseHit {
  file: string;
  line: number;
}

const SP_PER_BP = 65781.76;
// tipo, tag, line, [column], h, v, [W[, H, D]]
const RECORD_RE = /^([[(vhxkg$r])(\d+),(-?\d+)(?:,-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;
/** Auxiliares generados por LaTeX: no son fuentes editables. */
const GENERATED_RE = /\.(aux|toc|lof|lot|lol|out|bbl|nav|snm|ind|idx|gls|glo|acn|acr|alg|loa|brf)$/i;

export function parseSynctex(text: string): SynctexData {
  const files = new Map<number, string>();
  const boxes: SyncBox[] = [];
  const leaves: SyncLeaf[] = [];
  const pages: SynctexData['pages'] = new Map();
  let unit = 1;
  let mag = 1000;
  let xOff = 0;
  let yOff = 0;
  let page = 0;
  let pageInfo: { boxStart: number; boxEnd: number; leafStart: number; leafEnd: number } | null = null;
  const stack: number[] = [];
  /** Caja recién abierta y aún sin hijos. */
  let fresh = -1;
  let inContent = false;

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line) continue;
    const c = line[0];
    if (line.startsWith('Input:')) {
      const m = /^Input:(\d+):(.*)$/.exec(line);
      if (m) files.set(Number(m[1]), m[2]);
      continue;
    }
    if (!inContent) {
      const m = /^(Unit|Magnification|X Offset|Y Offset):(-?[\d.]+)/.exec(line);
      if (m) {
        const n = Number(m[2]);
        if (Number.isFinite(n)) {
          if (m[1] === 'Unit' && n > 0) unit = n;
          else if (m[1] === 'Magnification' && n > 0) mag = n;
          else if (m[1] === 'X Offset') xOff = n;
          else if (m[1] === 'Y Offset') yOff = n;
        }
      } else if (line.startsWith('Content:')) inContent = true;
      continue;
    }
    if (line.startsWith('Postamble:')) break;
    if (c === '{') {
      page = Number(line.slice(1)) || page + 1;
      pageInfo = { boxStart: boxes.length, boxEnd: boxes.length, leafStart: leaves.length, leafEnd: leaves.length };
      pages.set(page, pageInfo);
      stack.length = 0;
      continue;
    }
    if (c === '}') {
      if (pageInfo) {
        pageInfo.boxEnd = boxes.length;
        pageInfo.leafEnd = leaves.length;
      }
      pageInfo = null;
      stack.length = 0;
      continue;
    }
    if (c === ']' || c === ')') {
      stack.pop();
      fresh = -1;
      continue;
    }
    if (!pageInfo) continue;
    const m = RECORD_RE.exec(line);
    if (!m) continue; // registros desconocidos (!offset, f, <, >…): se ignoran
    const tag = Number(m[2]);
    const ln = Number(m[3]);
    const h = Number(m[4]);
    const v = Number(m[5]);
    const parent = stack.length ? stack[stack.length - 1] : -1;
    if (c === '[' || c === '(') {
      boxes.push({ kind: c === '[' ? 'v' : 'h', tag, line: ln, page, h, v, w: Number(m[6] ?? 0), ht: Number(m[7] ?? 0), dp: Number(m[8] ?? 0), parent, mixed: false });
      stack.push(boxes.length - 1);
      fresh = boxes.length - 1;
    } else {
      const sizeless = (c === 'h' || c === 'v') && !Number(m[6] ?? 0) && !Number(m[7] ?? 0) && !Number(m[8] ?? 0);
      const opener = c === 'x' && parent >= 0 && parent === fresh && boxes[parent].tag === tag && boxes[parent].line === ln;
      fresh = -1;
      leaves.push({ kind: sizeless || opener ? '_' : c, tag, line: ln, page, h, v, box: parent });
      if (parent >= 0) {
        const p = boxes[parent];
        if (p.tag === tag && p.line !== ln) p.mixed = true;
      }
    }
  }
  if (pageInfo) {
    pageInfo.boxEnd = boxes.length;
    pageInfo.leafEnd = leaves.length;
  }
  const scale = (unit * mag) / 1000 / SP_PER_BP;
  return { files, boxes, leaves, pages, scale, xOffset: (xOff * unit) / SP_PER_BP, yOffset: (yOff * unit) / SP_PER_BP };
}

/** Normaliza una ruta relativa: quita `./`, barras repetidas y separadores de Windows. */
function normRel(p: string): string {
  return p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')
    .join('/');
}

const stripTex = (p: string) => p.replace(/\.tex$/i, '');

/** Fuente de la memoria: relativa, sin `..` y que no sea un auxiliar generado. */
export function isSourceFile(name: string): boolean {
  if (!name || name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) return false;
  const n = normRel(name);
  return n !== '' && !n.split('/').includes('..') && !GENERATED_RE.test(n);
}

function tagsFor(data: SynctexData, file: string): Set<number> {
  const want = normRel(file);
  const exact = new Set<number>();
  const loose = new Set<number>();
  for (const [tag, name] of data.files) {
    if (!isSourceFile(name)) continue;
    const n = normRel(name);
    if (n === want) exact.add(tag);
    else if (stripTex(n) === stripTex(want)) loose.add(tag);
  }
  return exact.size ? exact : loose;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxRect(data: SynctexData, b: SyncBox): Rect {
  const s = data.scale;
  const xa = b.h * s + data.xOffset;
  const xb = (b.h + b.w) * s + data.xOffset;
  return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: (b.v - b.ht) * s + data.yOffset, y1: (b.v + b.dp) * s + data.yOffset };
}

/** Caja de línea: sube por la cadena de hboxes hasta la que cuelga de una vbox (o de nada). */
function lineBox(data: SynctexData, idx: number): number {
  let i = idx;
  while (i >= 0 && data.boxes[i].kind !== 'h') i = data.boxes[i].parent;
  if (i < 0) return -1;
  while (data.boxes[i].parent >= 0 && data.boxes[i].parent !== i && data.boxes[data.boxes[i].parent].kind === 'h') i = data.boxes[i].parent;
  return i;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Caja sin superficie (p. ej. las cajas a 0,0 de la cabecera o el pie vacíos). */
const isFlat = (b: SyncBox) => b.w === 0 || b.ht + b.dp === 0;

/** Hojas que corresponden a contenido visible (los k/g sueltos suelen ser finales de párrafo). */
const STRONG = new Set(['x', '$', 'r', 'h', 'v']);

interface Cand {
  page: number;
  /** Caja de línea (índice) o -1. */
  lb: number;
  /** Posición del registro en bp, por si no hay caja de línea. */
  px: number;
  py: number;
  /** 0 hoja visible, 1 caja propia de esa línea, 2 hoja débil (k/g), 3 sin superficie. */
  tier: number;
}

const pt = (data: SynctexData, h: number, v: number) => ({ px: h * data.scale + data.xOffset, py: v * data.scale + data.yOffset });

/**
 * Código → PDF. `null` si el archivo no aparece en el synctex.
 * `heading`: la línea es un título; se ignoran los registros que deja en las páginas que expulsa.
 */
export function forward(data: SynctexData, file: string, line: number, opts: { heading?: boolean } = {}): ForwardHit | null {
  const tags = tagsFor(data, file);
  if (!tags.size) return null;
  const byLine = new Map<number, Cand[]>();
  const add = (l: number, c: Cand) => {
    const arr = byLine.get(l);
    if (arr) arr.push(c);
    else byLine.set(l, [c]);
  };
  for (const r of data.leaves) {
    if (!tags.has(r.tag) || r.line <= 0) continue;
    const lb = r.box >= 0 ? lineBox(data, r.box) : -1;
    const flat = lb >= 0 && isFlat(data.boxes[lb]);
    add(r.line, { page: r.page, lb, ...pt(data, r.h, r.v), tier: flat ? 3 : STRONG.has(r.kind) && (lb >= 0 || r.kind === 'r') ? 0 : 2 });
  }
  data.boxes.forEach((b, i) => {
    if (!tags.has(b.tag) || b.line <= 0 || b.kind !== 'h' || b.mixed) return;
    const lb = lineBox(data, i);
    add(b.line, { page: b.page, lb, ...pt(data, b.h, b.v), tier: isFlat(data.boxes[lb]) ? 3 : 1 });
  });
  if (!byLine.size) return null;

  const bestTier = new Map<number, number>();
  for (const [l, cs] of byLine) bestTier.set(l, cs.reduce((m, c) => Math.min(m, c.tier), 9));
  const best = (l: number) => bestTier.get(l) ?? 9;
  const lines = [...byLine.keys()].sort((a, b) => a - b);
  // La línea pedida si tiene contenido visible; si no, la siguiente que lo tenga y, si no, la anterior.
  const pick = (maxTier: number) =>
    best(line) <= maxTier
      ? line
      : (lines.find((l) => l > line && best(l) <= maxTier) ?? lines.filter((l) => l < line && best(l) <= maxTier).pop());
  const target = pick(1) ?? pick(2) ?? pick(3);
  if (target === undefined) return null;
  const all = byLine.get(target)!;
  const tierMax = Math.max(1, best(target));
  const cands = all.filter((c) => c.tier <= tierMax);
  // En un título se descartan las páginas que TeX envió mientras leía esa línea (su caja raíz
  // lleva esa línea): son el material anterior que expulsa el `\cleardoublepage` de un `\chapter`.
  const shipped = (p: number) => {
    const info = data.pages.get(p);
    const root = info && info.boxStart < info.boxEnd ? data.boxes[info.boxStart] : null;
    return !!root && root.parent < 0 && root.line === target && tags.has(root.tag);
  };
  const pool = opts.heading && cands.some((c) => !shipped(c.page)) ? cands.filter((c) => !shipped(c.page)) : cands;
  const page = pool.reduce((m, c) => Math.min(m, c.page), Infinity);
  const onPage = cands.filter((c) => c.page === page);

  const rects: Rect[] = [];
  const seen = new Set<number>();
  for (const c of onPage) {
    if (c.lb >= 0 && !isFlat(data.boxes[c.lb])) {
      if (!seen.has(c.lb)) rects.push(boxRect(data, data.boxes[c.lb]));
      seen.add(c.lb);
    }
  }
  if (!rects.length) {
    // Sin caja de línea útil: una marca de una línea de alto en la posición del registro.
    const c = onPage[0];
    rects.push({ x0: c.px, y0: c.py - 10, x1: c.px + 10, y1: c.py + 2 });
  }
  // Unión de cajas de línea contiguas a la más alta (evita abarcar p. ej. una nota al pie lejana).
  rects.sort((a, b) => a.y0 - b.y0);
  let rect = { ...rects[0] };
  for (const r of rects.slice(1)) {
    if (r.y0 > rect.y1 + 16) break;
    rect = { x0: Math.min(rect.x0, r.x0), y0: Math.min(rect.y0, r.y0), x1: Math.max(rect.x1, r.x1), y1: Math.max(rect.y1, r.y1) };
  }
  const x = Math.max(0, rect.x0);
  const y = Math.max(0, rect.y0);
  return { page, x: round(x), y: round(y), w: round(Math.max(1, rect.x1 - x)), h: round(Math.max(1, rect.y1 - y)) };
}

/** PDF → código. `null` si en esa página no hay nada de la memoria. */
export function inverse(data: SynctexData, page: number, x: number, y: number): InverseHit | null {
  const info = data.pages.get(page);
  if (!info) return null;
  const src = (tag: number) => {
    const n = data.files.get(tag);
    return n !== undefined && isSourceFile(n) ? normRel(n) : null;
  };
  const TOL = 1;
  const BELOW = 36;
  const GAP = 4;
  // 1) hbox más pequeña que contiene el punto. Si no hay, la más cercana; pero si el
  //    clic queda claramente por debajo de ella (p. ej. entre párrafos o bajo un título),
  //    la siguiente por debajo.
  let inBox = -1;
  let inArea = Infinity;
  let below = -1;
  let belowD = Infinity;
  let near = -1;
  let nearD = Infinity;
  let nearAboveDy = 0;
  for (let i = info.boxStart; i < info.boxEnd; i++) {
    const b = data.boxes[i];
    if (b.kind !== 'h' || isFlat(b)) continue;
    const r = boxRect(data, b);
    const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
    if (dx <= TOL && y >= r.y0 - TOL && y <= r.y1 + TOL) {
      const area = (r.x1 - r.x0) * (r.y1 - r.y0);
      if (area < inArea) {
        inArea = area;
        inBox = i;
      }
      continue;
    }
    if (r.y0 >= y && r.y0 - y <= BELOW && dx <= TOL && r.y0 - y < belowD) {
      belowD = r.y0 - y;
      below = i;
    }
    const dy = y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0;
    const d = dy * 1000 + dx;
    if (d < nearD) {
      nearD = d;
      near = i;
      nearAboveDy = y > r.y1 ? dy : 0;
    }
  }
  const box = inBox >= 0 ? inBox : below >= 0 && nearAboveDy > GAP ? below : near;

  if (box >= 0) {
    // 2) hojas de esa caja (o de sus descendientes) de archivos de la memoria.
    const inside = (bi: number) => {
      for (let j = bi; j >= 0; j = data.boxes[j].parent) if (j === box) return true;
      return false;
    };
    const direct: SyncLeaf[] = [];
    const nested: SyncLeaf[] = [];
    for (let i = info.leafStart; i < info.leafEnd; i++) {
      const l = data.leaves[i];
      if (l.box < 0 || l.line <= 0 || src(l.tag) === null) continue;
      if (l.box === box) direct.push(l);
      else if (inside(l.box)) nested.push(l);
    }
    let pool = direct.length ? direct : nested;
    // Las marcas (apertura de caja, cajas vacías) solo si no hay otra cosa.
    if (pool.some((l) => l.kind !== '_')) pool = pool.filter((l) => l.kind !== '_');
    if (pool.length) {
      // El archivo predominante en la caja (los \ref, \ac… dejan registros del archivo principal).
      const count = new Map<number, number>();
      for (const l of pool) count.set(l.tag, (count.get(l.tag) ?? 0) + 1);
      const tag = [...count].sort((a, b) => b[1] - a[1])[0][0];
      pool = pool.filter((l) => l.tag === tag);
      // La más cercana en horizontal, preferentemente a la izquierda del clic.
      let left: SyncLeaf | null = null;
      let right: SyncLeaf | null = null;
      for (const l of pool) {
        const strong = STRONG.has(l.kind);
        if (l.h * data.scale + data.xOffset <= x) {
          if (!left || l.h > left.h || (l.h === left.h && strong)) left = l;
        } else if (!right || l.h < right.h || (l.h === right.h && strong && !STRONG.has(right.kind))) right = l;
      }
      const l = (left ?? right)!;
      return { file: src(l.tag)!, line: l.line };
    }
    // 3) la propia caja o sus antecesoras.
    for (let j = box; j >= 0; j = data.boxes[j].parent) {
      const b = data.boxes[j];
      const f = src(b.tag);
      if (f && b.line > 0) return { file: f, line: b.line };
    }
  }

  // 4) registro de la memoria más cercano en la página.
  let fb: InverseHit | null = null;
  let fbD = Infinity;
  const consider = (tag: number, line: number, h: number, v: number) => {
    const f = src(tag);
    if (!f || line <= 0) return;
    const p = pt(data, h, v);
    const d = Math.abs(p.py - y) * 4 + Math.abs(p.px - x);
    if (d < fbD) {
      fbD = d;
      fb = { file: f, line };
    }
  };
  for (let i = info.leafStart; i < info.leafEnd; i++) {
    const l = data.leaves[i];
    consider(l.tag, l.line, l.h, l.v);
  }
  for (let i = info.boxStart; i < info.boxEnd; i++) {
    const b = data.boxes[i];
    consider(b.tag, b.line, b.h, b.v);
  }
  return fb;
}

export interface OutlineRefLine {
  id: string;
  file: string;
  line: number;
}

export interface OutlinePos {
  id: string;
  page: number;
  y: number;
}

/** Resultados de `forward` por synctex analizado (se reutilizan mientras siga en la caché del compilador). */
const forwardMemo = new WeakMap<SynctexData, Map<string, ForwardHit | null>>();

/** Posición en el PDF (página y borde superior) del título de cada apartado; se omiten los que no aparecen. */
export function outlinePositions(data: SynctexData, refs: OutlineRefLine[]): OutlinePos[] {
  let memo = forwardMemo.get(data);
  if (!memo) forwardMemo.set(data, (memo = new Map()));
  const out: OutlinePos[] = [];
  for (const r of refs) {
    const key = `${r.file}\0${r.line}`;
    let hit = memo.get(key);
    if (hit === undefined) memo.set(key, (hit = forward(data, r.file, r.line, { heading: true })));
    if (hit) out.push({ id: r.id, page: hit.page, y: hit.y });
  }
  return out;
}
