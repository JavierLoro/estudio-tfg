// Edición visual de diagramas (v0.8): tipo de diagrama, paleta de bloques por tipo y
// pequeñas transformaciones de texto. Funciones puras (sin DOM) para poder probarlas.
// Las operaciones estructurales (renombrar, conectar, borrar…) las hace Visimer sobre el
// propio texto; aquí solo va lo que le falta o lo que se traduce a su lenguaje.

// Sin dependencias de Visimer (ni de DOM): se prueba desde server/test/diagramEdit.test.ts.

/** Operación de Visimer (`editor.dispatch`); solo se usa la forma, la comprueba el compilador del lienzo. */
export type VisimerOp = { type: string; [k: string]: unknown };
/** Lo que la paleta necesita del análisis de Visimer (`editor.result`). */
export type VisimerResult = ParseLike;

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

/** Dibujo del bloque en la paleta (lo pinta el panel). */
export type Glyph =
  | 'stadium' | 'rect' | 'diamond' | 'lean' | 'cylinder' | 'group'
  | 'participant' | 'actor' | 'message' | 'note'
  | 'state' | 'start' | 'end' | 'choice' | 'class' | 'member' | 'entity' | 'attribute' | 'relation';

/** Bloque de la paleta. `make` devuelve la operación (o el texto nuevo) según lo seleccionado. */
export interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  glyph: Glyph;
  /** Si hay un bloque seleccionado (o bajo el que se suelta), el nuevo se une a él (flujo, estados). */
  after?: boolean;
  make(ctx: PaletteCtx): PaletteAction | null;
}
export interface PaletteCtx {
  /** Bloque de referencia: el seleccionado, o el que hay bajo el punto donde se suelta. */
  selection: string[];
  result: VisimerResult;
  code: string;
}
export type PaletteAction =
  | {
      kind: 'op';
      op: VisimerOp;
      /** abrir el texto del bloque nuevo para escribir */
      edit?: boolean;
      /** operaciones que siguen a la creación (recibe el id sin prefijo del bloque nuevo) */
      follow?: (rawId: string) => VisimerOp[];
    }
  | { kind: 'ops'; ops: VisimerOp[] }
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

const flowNode = (id: string, label: string, text: string, hint: string, shape: 'rect' | 'stadium' | 'diamond' | 'lean_r' | 'cylinder', glyph: Glyph): PaletteItem => ({
  id,
  label,
  hint,
  glyph,
  after: true,
  make: () => ({ kind: 'op', op: { type: 'addNode', shape, label: text }, edit: true }),
});

const FLOW: PaletteItem[] = [
  flowNode('inicio', 'Inicio / fin', 'Inicio', 'Óvalo para el inicio o el fin del proceso', 'stadium', 'stadium'),
  flowNode('paso', 'Paso', 'Paso', 'Rectángulo: una acción o paso', 'rect', 'rect'),
  flowNode('decision', 'Decisión', '¿Condición?', 'Rombo: una pregunta con varias salidas', 'diamond', 'diamond'),
  flowNode('datos', 'Datos', 'Datos', 'Paralelogramo: entrada o salida de datos', 'lean_r', 'lean'),
  flowNode('bd', 'Base de datos', 'Base de datos', 'Cilindro: almacén de datos', 'cylinder', 'cylinder'),
  {
    id: 'grupo',
    label: 'Grupo',
    hint: 'Agrupa el bloque seleccionado en un recuadro con título',
    glyph: 'group',
    make: (ctx) => {
      const id = sel(ctx, 'node:');
      return id ? { kind: 'text', code: wrapInGroup(ctx.code, id) } : null;
    },
  },
];

const SEQ: PaletteItem[] = [
  { id: 'participante', label: 'Participante', hint: 'Una caja (sistema, componente…)', glyph: 'participant', make: () => ({ kind: 'op', op: { type: 'seq.addParticipant', ptype: 'participant', name: 'Participante' }, edit: true }) },
  { id: 'actor', label: 'Actor', hint: 'Una persona (muñeco)', glyph: 'actor', make: () => ({ kind: 'op', op: { type: 'seq.addParticipant', ptype: 'actor', name: 'Actor' }, edit: true }) },
  {
    id: 'mensaje',
    label: 'Mensaje',
    hint: 'Flecha entre dos participantes (desde el seleccionado, o entre los dos últimos)',
    glyph: 'message',
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
    glyph: 'note',
    make: (ctx) => {
      const ps = ctx.result.sequence?.participants ?? [];
      const p = sel(ctx, 'participant:') ?? ps[0]?.id;
      return p ? { kind: 'op', op: { type: 'seq.addNote', participant: p, placement: 'right of', text: 'Nota' }, edit: true } : null;
    },
  },
];

const STATE: PaletteItem[] = [
  { id: 'estado', label: 'Estado', hint: 'Un estado (se une al seleccionado)', glyph: 'state', after: true, make: () => ({ kind: 'op', op: { type: 'st.addState', label: 'Estado' }, edit: true }) },
  {
    id: 'inicio',
    label: 'Inicio',
    hint: 'Punto de inicio ([*]): con un estado seleccionado lo une a él; si no, crea un estado inicial',
    glyph: 'start',
    make: (ctx) => {
      const id = sel(ctx, 'state:');
      if (id) return { kind: 'ops', ops: [{ type: 'st.connect', source: '[*]', target: id }] };
      return { kind: 'op', op: { type: 'st.addState', label: 'Estado' }, edit: true, follow: (n) => [{ type: 'st.connect', source: '[*]', target: n }] };
    },
  },
  {
    id: 'fin',
    label: 'Fin',
    hint: 'Punto final ([*]): con un estado seleccionado lo une a él; si no, crea un estado final',
    glyph: 'end',
    make: (ctx) => {
      const id = sel(ctx, 'state:');
      if (id) return { kind: 'ops', ops: [{ type: 'st.connect', source: id, target: '[*]' }] };
      return { kind: 'op', op: { type: 'st.addState', label: 'Estado' }, edit: true, follow: (n) => [{ type: 'st.connect', source: n, target: '[*]' }] };
    },
  },
  {
    id: 'decision',
    label: 'Decisión',
    hint: 'Rombo de decisión (se une al seleccionado)',
    glyph: 'choice',
    after: true,
    make: () => ({ kind: 'op', op: { type: 'st.addState' }, follow: (n) => [{ type: 'st.setStateType', id: n, stype: 'choice' }] }),
  },
];

const CLASS: PaletteItem[] = [
  { id: 'clase', label: 'Clase', hint: 'Una clase nueva', glyph: 'class', make: () => ({ kind: 'op', op: { type: 'cl.addClass', name: 'Clase' }, edit: true }) },
  {
    id: 'miembro',
    label: 'Atributo o método',
    hint: 'Añade una línea a la clase seleccionada',
    glyph: 'member',
    make: (ctx) => {
      const id = sel(ctx, 'class:');
      return id ? { kind: 'op', op: { type: 'cl.addMember', id, text: '+atributo' } } : null;
    },
  },
];

const ER: PaletteItem[] = [
  { id: 'entidad', label: 'Entidad', hint: 'Una entidad nueva (en MAYÚSCULAS)', glyph: 'entity', make: () => ({ kind: 'op', op: { type: 'er.addEntity', name: 'ENTIDAD' }, edit: true }) },
  {
    id: 'atributo',
    label: 'Atributo',
    hint: 'Añade un atributo a la entidad seleccionada',
    glyph: 'attribute',
    make: (ctx) => {
      const id = sel(ctx, 'entity:');
      return id ? { kind: 'op', op: { type: 'er.addAttribute', id, text: 'string atributo' } } : null;
    },
  },
  {
    id: 'relacion',
    label: 'Relación',
    hint: 'Relación entre la entidad seleccionada (o la penúltima) y otra',
    glyph: 'relation',
    make: (ctx) => {
      const es = ctx.result.er?.entities ?? [];
      if (es.length < 2) return null;
      const from = sel(ctx, 'entity:') ?? es[es.length - 2].id;
      const i = es.findIndex((e) => e.id === from);
      if (i < 0) return null;
      const to = es[(i + 1) % es.length].id;
      return { kind: 'ops', ops: [{ type: 'er.connect', source: from, target: to, label: 'tiene' }] };
    },
  },
];

const PALETTES: Record<DiagramKind, PaletteItem[]> = { flowchart: FLOW, sequence: SEQ, state: STATE, class: CLASS, er: ER, otro: [] };

export function paletteFor(kind: DiagramKind): PaletteItem[] {
  return PALETTES[kind];
}

// ---------- Modelo del diagrama para el panel de propiedades ----------
// Lista bloques y conexiones desde el análisis de Visimer (`editor.result`) y construye las
// operaciones de edición por tipo. Sin DOM ni dependencias: se prueba con el motor real.

export interface Block {
  /** Id de entidad de Visimer (`node:A`, `state:S`, `class:C`, `entity:E`, `participant:P`). */
  id: string;
  /** Id sin prefijo (el del código Mermaid). */
  raw: string;
  label: string;
  /** Forma o tipo actual (flujo, estados, secuencia). */
  shape: string | null;
}
export interface Link {
  /** Id de entidad de Visimer de la conexión (cambia si cambia el orden del código). */
  id: string;
  /** Id del bloque origen / destino; null en los puntos `[*]` de los estados. */
  from: string | null;
  to: string | null;
  fromLabel: string;
  toLabel: string;
  label: string;
}
export interface Model {
  blocks: Block[];
  links: Link[];
  /** Dirección actual (`TD`, `LR`…) o null si el tipo no la tiene. */
  direction: string | null;
  hasDirection: boolean;
}

/** Lo que se usa del análisis de Visimer (`ParseResult`); estructural para no depender del paquete. */
export interface ParseLike {
  flowchart?: {
    direction: string | null;
    nodes: { id: string; label: string; shape: string }[];
    edges: { entityId: string; source: string; target: string; label: string | null }[];
  } | null;
  state?: {
    direction: { value: string } | null;
    states: { id: string; label: string; stereotype: string | null }[];
    transitions: { entityId: string; source: string; target: string; label: string | null }[];
  } | null;
  classGraph?: {
    direction: { value: string } | null;
    classes: { id: string; label: string }[];
    relations: { entityId: string; source: string; target: string; label: string | null }[];
  } | null;
  er?: {
    entities: { id: string; label: string }[];
    relations: { entityId: string; source: string; target: string; label: string }[];
  } | null;
  sequence?: {
    participants: { id: string; label?: string; ptype?: string }[];
    events?: { kind: string; entityId: string; stmt: { source?: string; target?: string; text: string } }[];
  } | null;
}

/** `node:A` → `A`. */
export const rawId = (entityId: string) => entityId.slice(entityId.indexOf(':') + 1);

/** Texto de un bloque vacío (p. ej. una decisión de estados): se muestra algo en vez de nada. */
const orDash = (s: string, fallback: string) => (s.trim() ? s : fallback);

export function buildModel(kind: DiagramKind, r: ParseLike): Model {
  const none: Model = { blocks: [], links: [], direction: null, hasDirection: false };
  if (kind === 'flowchart' && r.flowchart) {
    const g = r.flowchart;
    const blocks = g.nodes.map((n) => ({ id: `node:${n.id}`, raw: n.id, label: n.label, shape: n.shape }));
    const lab = (raw: string) => g.nodes.find((n) => n.id === raw)?.label ?? raw;
    const links = g.edges.map((e) => ({ id: e.entityId, from: `node:${e.source}`, to: `node:${e.target}`, fromLabel: lab(e.source), toLabel: lab(e.target), label: e.label ?? '' }));
    return { blocks, links, direction: g.direction ?? 'TD', hasDirection: true };
  }
  if (kind === 'state' && r.state) {
    const g = r.state;
    const blocks = g.states.map((s) => ({ id: `state:${s.id}`, raw: s.id, label: orDash(s.label, s.id), shape: s.stereotype ? s.stereotype.replace(/[<>]/g, '') : 'state' }));
    const end = (raw: string, pseudo: string) => (raw === '[*]' ? { id: null, label: pseudo } : { id: `state:${raw}`, label: g.states.find((s) => s.id === raw)?.label || raw });
    const links = g.transitions.map((t) => {
      const a = end(t.source, 'Inicio');
      const b = end(t.target, 'Fin');
      return { id: t.entityId, from: a.id, to: b.id, fromLabel: a.label, toLabel: b.label, label: t.label ?? '' };
    });
    return { blocks, links, direction: g.direction?.value ?? 'TD', hasDirection: true };
  }
  if (kind === 'class' && r.classGraph) {
    const g = r.classGraph;
    const blocks = g.classes.map((c) => ({ id: `class:${c.id}`, raw: c.id, label: c.label, shape: null }));
    const lab = (raw: string) => g.classes.find((c) => c.id === raw)?.label ?? raw;
    const links = g.relations.map((e) => ({ id: e.entityId, from: `class:${e.source}`, to: `class:${e.target}`, fromLabel: lab(e.source), toLabel: lab(e.target), label: e.label ?? '' }));
    return { blocks, links, direction: g.direction?.value ?? 'TD', hasDirection: true };
  }
  if (kind === 'er' && r.er) {
    const g = r.er;
    const blocks = g.entities.map((c) => ({ id: `entity:${c.id}`, raw: c.id, label: c.label, shape: null }));
    const links = g.relations.map((e) => ({ id: e.entityId, from: `entity:${e.source}`, to: `entity:${e.target}`, fromLabel: e.source, toLabel: e.target, label: e.label }));
    return { blocks, links, direction: null, hasDirection: false };
  }
  if (kind === 'sequence' && r.sequence) {
    const g = r.sequence;
    const blocks = g.participants.map((p) => ({ id: `participant:${p.id}`, raw: p.id, label: p.label ?? p.id, shape: p.ptype ?? null }));
    const lab = (raw: string) => g.participants.find((p) => p.id === raw)?.label ?? raw;
    const links = (g.events ?? [])
      .filter((e) => e.kind === 'message')
      .map((e) => ({ id: e.entityId, from: `participant:${e.stmt.source}`, to: `participant:${e.stmt.target}`, fromLabel: lab(e.stmt.source ?? ''), toLabel: lab(e.stmt.target ?? ''), label: e.stmt.text.trim() }));
    return { blocks, links, direction: null, hasDirection: false };
  }
  return none;
}

/** ¿El id de entidad es un bloque (no una conexión, nota, etc.)? */
export const isBlockId = (id: string) => /^(node|state|class|entity|participant):/.test(id);

export interface ShapeOption {
  id: string;
  label: string;
}
const FLOW_SHAPES: ShapeOption[] = [
  { id: 'rect', label: 'Paso' },
  { id: 'round', label: 'Paso redondeado' },
  { id: 'stadium', label: 'Inicio / fin' },
  { id: 'diamond', label: 'Decisión' },
  { id: 'lean_r', label: 'Datos' },
  { id: 'cylinder', label: 'Base de datos' },
  { id: 'hexagon', label: 'Preparación' },
  { id: 'circle', label: 'Conector' },
  { id: 'subroutine', label: 'Subproceso' },
];
const STATE_SHAPES: ShapeOption[] = [
  { id: 'state', label: 'Estado' },
  { id: 'choice', label: 'Decisión' },
  { id: 'fork', label: 'Bifurcación' },
  { id: 'join', label: 'Unión' },
];
const PARTICIPANT_SHAPES: ShapeOption[] = [
  { id: 'participant', label: 'Participante' },
  { id: 'actor', label: 'Actor' },
  { id: 'boundary', label: 'Frontera' },
  { id: 'control', label: 'Control' },
  { id: 'entity', label: 'Entidad' },
  { id: 'database', label: 'Base de datos' },
  { id: 'collections', label: 'Colecciones' },
  { id: 'queue', label: 'Cola' },
];

/** Formas (o tipos) válidas para un bloque del diagrama; vacío si el tipo no las tiene. */
export function shapeOptions(kind: DiagramKind): ShapeOption[] {
  return kind === 'flowchart' ? FLOW_SHAPES : kind === 'state' ? STATE_SHAPES : kind === 'sequence' ? PARTICIPANT_SHAPES : [];
}

export function renameOp(kind: DiagramKind, blockId: string, text: string): VisimerOp | null {
  const id = rawId(blockId);
  switch (kind) {
    case 'flowchart': return { type: 'renameNode', id, label: text };
    case 'state': return { type: 'st.setStateLabel', id, label: text };
    case 'class': return { type: 'cl.renameClass', id, name: text };
    case 'er': return { type: 'er.renameEntity', id, name: text };
    case 'sequence': return { type: 'seq.renameParticipant', id, name: text };
    default: return null;
  }
}

export function shapeOp(kind: DiagramKind, blockId: string, shape: string): VisimerOp | null {
  const id = rawId(blockId);
  switch (kind) {
    case 'flowchart': return { type: 'setNodeShape', id, shape };
    case 'state': return { type: 'st.setStateType', id, stype: shape };
    case 'sequence': return { type: 'seq.setParticipantType', id, ptype: shape };
    default: return null;
  }
}

export function connectOp(kind: DiagramKind, fromBlock: string, toBlock: string): VisimerOp | null {
  const source = rawId(fromBlock);
  const target = rawId(toBlock);
  switch (kind) {
    case 'flowchart': return { type: 'connect', source, target };
    case 'state': return { type: 'st.connect', source, target };
    case 'class': return { type: 'cl.connect', source, target };
    case 'er': return { type: 'er.connect', source, target, label: 'tiene' };
    case 'sequence': return { type: 'seq.addMessage', source, target, text: 'Mensaje' };
    default: return null;
  }
}

export function deleteLinkOp(kind: DiagramKind, linkId: string): VisimerOp | null {
  switch (kind) {
    case 'flowchart': return { type: 'deleteEdge', edgeId: linkId };
    case 'state': return { type: 'st.deleteTransition', transId: linkId };
    case 'class': return { type: 'cl.deleteRelation', relId: linkId };
    case 'er': return { type: 'er.deleteRelation', relId: linkId };
    case 'sequence': return { type: 'seq.deleteEvent', eventId: linkId };
    default: return null;
  }
}

export function linkLabelOp(kind: DiagramKind, linkId: string, label: string): VisimerOp | null {
  switch (kind) {
    case 'flowchart': return { type: 'setEdgeLabel', edgeId: linkId, label };
    case 'state': return { type: 'st.setTransitionLabel', transId: linkId, label };
    case 'class': return { type: 'cl.setRelationLabel', relId: linkId, label };
    case 'er': return { type: 'er.setRelationLabel', relId: linkId, label };
    case 'sequence': return { type: 'seq.setEventText', eventId: linkId, text: label };
    default: return null;
  }
}

export function directionOp(kind: DiagramKind, direction: 'TD' | 'LR'): VisimerOp | null {
  switch (kind) {
    case 'flowchart': return { type: 'setDirection', direction };
    case 'state': return { type: 'st.setDirection', direction };
    case 'class': return { type: 'cl.setDirection', direction };
    default: return null;
  }
}

export function deleteBlockOp(kind: DiagramKind, blockId: string): VisimerOp | null {
  const id = rawId(blockId);
  switch (kind) {
    case 'flowchart': return { type: 'deleteNode', id };
    case 'state': return { type: 'st.deleteState', id };
    case 'class': return { type: 'cl.deleteClass', id };
    case 'er': return { type: 'er.deleteEntity', id };
    case 'sequence': return { type: 'seq.deleteParticipant', id };
    default: return null;
  }
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
