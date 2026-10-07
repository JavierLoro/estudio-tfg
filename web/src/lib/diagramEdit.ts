// Edición visual de diagramas (v0.8): tipo de diagrama, paleta de bloques por tipo y
// pequeñas transformaciones de texto. Funciones puras (sin DOM) para poder probarlas.
// Las operaciones estructurales (renombrar, conectar, borrar…) las hace Visimer sobre el
// propio texto; aquí solo va lo que le falta o lo que se traduce a su lenguaje.

// Sin dependencias de Visimer (ni de DOM): se prueba desde server/test/diagramEdit.test.ts.

/** Operación de Visimer (`editor.dispatch`); solo se usa la forma, la comprueba el compilador del lienzo. */
export type VisimerOp = { type: string; [k: string]: unknown };
/** Lo que la paleta necesita del análisis de Visimer (`editor.result`). */
export interface VisimerResult {
  sequence?: { participants: { id: string }[] } | null;
}

export type DiagramKind = 'flowchart' | 'sequence' | 'state' | 'class' | 'er' | 'otro';

/** Tipos con edición visual completa; el resto se ve en el lienzo pero solo se edita con código. */
export const EDITABLE_KINDS: ReadonlySet<DiagramKind> = new Set(['flowchart', 'sequence', 'state', 'class', 'er']);

/** Tipo del diagrama según su primera línea con contenido (sin comentarios, `%%{init}%%` ni cabecera `---`). */
export function diagramKind(code: string): DiagramKind {
  let inFront = false;
  for (const raw of code.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l === '---') {
      inFront = !inFront;
      continue;
    }
    if (inFront || l.startsWith('%%')) continue;
    if (/^(flowchart|graph)\b/.test(l)) return 'flowchart';
    if (/^sequenceDiagram\b/.test(l)) return 'sequence';
    if (/^stateDiagram(-v2)?\b/.test(l)) return 'state';
    if (/^classDiagram(-v2)?\b/.test(l)) return 'class';
    if (/^erDiagram\b/.test(l)) return 'er';
    return 'otro';
  }
  return 'otro';
}

export const KIND_LABEL: Record<DiagramKind, string> = {
  flowchart: 'Flujo',
  sequence: 'Secuencia',
  state: 'Estados',
  class: 'Clases',
  er: 'Entidad-relación',
  otro: 'Otro',
};

/** Bloque de la paleta. `make` devuelve la operación (o el texto nuevo) según lo seleccionado. */
export interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  /** Si hay un bloque seleccionado, el nuevo se une a él (flujo, estados). */
  after?: boolean;
  make(ctx: PaletteCtx): PaletteAction | null;
}
export interface PaletteCtx {
  selection: string[];
  result: VisimerResult;
  code: string;
}
export type PaletteAction =
  | { kind: 'op'; op: VisimerOp; /** abrir el texto del bloque nuevo para escribir */ edit?: boolean }
  | { kind: 'text'; code: string };

const sel = (ctx: PaletteCtx, prefix: string) => {
  const s = ctx.selection.find((e) => e.startsWith(prefix));
  return s ? s.slice(prefix.length) : null;
};

/** Texto con un grupo (`subgraph`) que contiene el bloque `nodeId`. */
export function wrapInGroup(code: string, nodeId: string): string {
  const used = new Set([...code.matchAll(/^\s*subgraph\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]));
  let n = 1;
  while (used.has(`grupo${n}`)) n++;
  const body = code.endsWith('\n') ? code : `${code}\n`;
  return `${body}  subgraph grupo${n} [Grupo]\n    ${nodeId}\n  end\n`;
}

const flowNode = (id: string, label: string, text: string, hint: string, shape: 'rect' | 'stadium' | 'diamond' | 'lean_r' | 'cylinder'): PaletteItem => ({
  id,
  label,
  hint,
  after: true,
  make: () => ({ kind: 'op', op: { type: 'addNode', shape, label: text }, edit: true }),
});

const FLOW: PaletteItem[] = [
  flowNode('inicio', 'Inicio / fin', 'Inicio', 'Óvalo para el inicio o el fin del proceso', 'stadium'),
  flowNode('paso', 'Paso', 'Paso', 'Rectángulo: una acción o paso', 'rect'),
  flowNode('decision', 'Decisión', '¿Condición?', 'Rombo: una pregunta con varias salidas', 'diamond'),
  flowNode('datos', 'Datos', 'Datos', 'Paralelogramo: entrada o salida de datos', 'lean_r'),
  flowNode('bd', 'Base de datos', 'Base de datos', 'Cilindro: almacén de datos', 'cylinder'),
  {
    id: 'grupo',
    label: 'Grupo',
    hint: 'Agrupa el bloque seleccionado en un recuadro con título',
    make: (ctx) => {
      const id = sel(ctx, 'node:');
      return id ? { kind: 'text', code: wrapInGroup(ctx.code, id) } : null;
    },
  },
];

const SEQ: PaletteItem[] = [
  { id: 'participante', label: 'Participante', hint: 'Una caja (sistema, componente…)', make: () => ({ kind: 'op', op: { type: 'seq.addParticipant', ptype: 'participant', name: 'Participante' }, edit: true }) },
  { id: 'actor', label: 'Actor', hint: 'Una persona (muñeco)', make: () => ({ kind: 'op', op: { type: 'seq.addParticipant', ptype: 'actor', name: 'Actor' }, edit: true }) },
  {
    id: 'mensaje',
    label: 'Mensaje',
    hint: 'Flecha entre dos participantes (desde el seleccionado, o entre los dos últimos)',
    make: (ctx) => {
      const ps = ctx.result.sequence?.participants ?? [];
      if (ps.length < 2) return null;
      const from = sel(ctx, 'participant:');
      const i = from ? ps.findIndex((p) => p.id === from) : ps.length - 2;
      const a = ps[i < 0 ? ps.length - 2 : i];
      const b = ps[(ps.indexOf(a) + 1) % ps.length];
      return { kind: 'op', op: { type: 'seq.addMessage', source: a.id, target: b.id, text: 'Mensaje' }, edit: true };
    },
  },
  {
    id: 'nota',
    label: 'Nota',
    hint: 'Nota junto al participante seleccionado (o el primero)',
    make: (ctx) => {
      const ps = ctx.result.sequence?.participants ?? [];
      const p = sel(ctx, 'participant:') ?? ps[0]?.id;
      return p ? { kind: 'op', op: { type: 'seq.addNote', participant: p, placement: 'right of', text: 'Nota' }, edit: true } : null;
    },
  },
];

const STATE: PaletteItem[] = [
  { id: 'estado', label: 'Estado', hint: 'Un estado (se une al seleccionado)', after: true, make: () => ({ kind: 'op', op: { type: 'st.addState', label: 'Estado' }, edit: true }) },
];

const CLASS: PaletteItem[] = [
  { id: 'clase', label: 'Clase', hint: 'Una clase nueva', make: () => ({ kind: 'op', op: { type: 'cl.addClass', name: 'Clase' }, edit: true }) },
  {
    id: 'miembro',
    label: 'Atributo o método',
    hint: 'Añade una línea a la clase seleccionada',
    make: (ctx) => {
      const id = sel(ctx, 'class:');
      return id ? { kind: 'op', op: { type: 'cl.addMember', id, text: '+atributo' } } : null;
    },
  },
];

const ER: PaletteItem[] = [
  { id: 'entidad', label: 'Entidad', hint: 'Una entidad nueva (en MAYÚSCULAS)', make: () => ({ kind: 'op', op: { type: 'er.addEntity', name: 'ENTIDAD' }, edit: true }) },
  {
    id: 'atributo',
    label: 'Atributo',
    hint: 'Añade un atributo a la entidad seleccionada',
    make: (ctx) => {
      const id = sel(ctx, 'entity:');
      return id ? { kind: 'op', op: { type: 'er.addAttribute', id, text: 'string atributo' } } : null;
    },
  },
];

const PALETTES: Record<DiagramKind, PaletteItem[]> = { flowchart: FLOW, sequence: SEQ, state: STATE, class: CLASS, er: ER, otro: [] };

export function paletteFor(kind: DiagramKind): PaletteItem[] {
  return PALETTES[kind];
}

/** Traducciones de la interfaz de Visimer (barra flotante y menús) al español. */
export const VISIMER_ES: Record<string, string> = {
  Delete: 'Borrar',
  'Edit text': 'Cambiar texto',
  'Node shape': 'Cambiar forma',
  Colors: 'Colores',
  Duplicate: 'Duplicar',
  Rectangle: 'Rectángulo',
  Rounded: 'Redondeado',
  Stadium: 'Óvalo',
  Diamond: 'Rombo (decisión)',
  Hexagon: 'Hexágono',
  Circle: 'Círculo',
  Cylinder: 'Cilindro (base de datos)',
  Subroutine: 'Subproceso',
  Fill: 'Relleno',
  Border: 'Borde',
  Text: 'Texto',
  Stroke: 'Trazo',
  Arrow: 'Flecha',
  'No arrow': 'Sin flecha',
  'Double point': 'Punta doble',
  Cross: 'Cruz',
  'Double cross': 'Cruz doble',
  Dot: 'Punto',
  'Double dot': 'Punto doble',
  Solid: 'Continua',
  Dotted: 'Punteada',
  Thick: 'Gruesa',
  Invisible: 'Invisible',
  'Edge color': 'Color de la flecha',
  'Animate edge': 'Animar flecha',
  'Edge curve (diagram-wide)': 'Curvatura (todo el diagrama)',
  'Edge curve': 'Curvatura',
  'Default (curved)': 'Curva',
  'Natural spline': 'Suave',
  'Straight segments': 'Recta',
  Default: 'Curva',
  Natural: 'Suave',
  Linear: 'Recta',
  'Reverse direction': 'Invertir dirección',
  'Rename subgraph': 'Cambiar título del grupo',
  'State type': 'Tipo de estado',
  'Add note': 'Añadir nota',
  Note: 'Nota',
  'Move to composite': 'Meter en un estado compuesto',
  'Add member': 'Añadir atributo o método',
  Annotation: 'Anotación',
  'Remove annotation': 'Quitar anotación',
  'Rename class': 'Cambiar nombre de la clase',
  'Relation type': 'Tipo de relación',
  'Add attribute': 'Añadir atributo',
  'Rename entity': 'Cambiar nombre de la entidad',
  'Edit label': 'Cambiar texto',
  'Edit value': 'Cambiar valor',
  Rename: 'Cambiar nombre',
  'Participant type': 'Tipo de participante',
  'Message type': 'Tipo de mensaje',
  'Wrap in fragment': 'Envolver en bucle o condición',
  Fragment: 'Bucle o condición',
  'Cardinality (e.g. 1, 0..1, 1..*, *)': 'Cardinalidad (p. ej. 1, 0..1, 1..*, *)',
  'Zoom out': 'Alejar',
  'Zoom in': 'Acercar',
  'Fit diagram': 'Ajustar al panel',
  'Click to insert here · drag to another participant to connect': 'Clic: insertar aquí · arrastrar a otro participante: unir con una flecha',
  '↩ Self message': '↩ Mensaje a sí mismo',
  '▭ Note over': '▭ Nota encima',
  '▭ Note left': '▭ Nota a la izquierda',
  '▭ Note right': '▭ Nota a la derecha',
  'solid line': 'Línea continua',
  'solid arrow': 'Flecha continua',
  'dotted line': 'Línea punteada',
  'dotted arrow': 'Flecha punteada',
  'solid cross': 'Cruz continua',
  'dotted cross': 'Cruz punteada',
  'solid async': 'Asíncrono continuo',
  'dotted async': 'Asíncrono punteado',
  participant: 'Participante',
  actor: 'Actor',
  boundary: 'Frontera',
  control: 'Control',
  entity: 'Entidad',
  database: 'Base de datos',
  collections: 'Colecciones',
  queue: 'Cola',
  choice: 'Decisión',
  fork: 'Bifurcación',
  join: 'Unión',
  state: 'Estado',
  'Wrap in loop': 'Envolver en bucle',
  'Wrap in alt': 'Envolver en alternativa (si / si no)',
  'Wrap in opt': 'Envolver en opcional',
  'Wrap in par': 'Envolver en paralelo',
  'Wrap in critical': 'Envolver en región crítica',
  'Wrap in break': 'Envolver en interrupción',
  'Wrap in rect': 'Envolver en recuadro',
};

/** Traduce un texto de Visimer (también «Fill: #fff» → «Relleno: #fff»); lo desconocido queda igual. */
export function esVisimer(text: string): string {
  const hit = VISIMER_ES[text];
  if (hit) return hit;
  const m = /^([A-Za-z ]+): (.+)$/.exec(text);
  if (m && VISIMER_ES[m[1]]) return `${VISIMER_ES[m[1]]}: ${m[2] === 'default' ? 'por defecto' : m[2]}`;
  return text;
}
