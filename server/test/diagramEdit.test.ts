import { describe, expect, it } from 'vitest';
import { diagramKind, esVisimer, paletteFor, wrapInGroup } from '../../web/src/lib/diagramEdit.ts';

describe('diagramKind', () => {
  it('detecta el tipo saltando comentarios, init y cabecera', () => {
    expect(diagramKind('flowchart TD\n A-->B')).toBe('flowchart');
    expect(diagramKind('%% nota\n%%{init: {"theme":"neutral"}}%%\n\ngraph LR\n A-->B')).toBe('flowchart');
    expect(diagramKind('---\ntitle: x\n---\nsequenceDiagram\n A->>B: hola')).toBe('sequence');
    expect(diagramKind('stateDiagram-v2\n [*] --> A')).toBe('state');
    expect(diagramKind('classDiagram\n A <|-- B')).toBe('class');
    expect(diagramKind('erDiagram\n A ||--o{ B : tiene')).toBe('er');
  });
  it('los tipos sin edición visual y el vacío son «otro»', () => {
    expect(diagramKind('pie title X\n "a": 1')).toBe('otro');
    expect(diagramKind('gantt\n title x')).toBe('otro');
    expect(diagramKind('')).toBe('otro');
    expect(diagramKind('%% solo un comentario')).toBe('otro');
  });
});

describe('wrapInGroup', () => {
  it('añade un subgrafo con el bloque y respeta el resto', () => {
    const code = 'flowchart TD\n  %% mío\n  A --> B\n';
    expect(wrapInGroup(code, 'B')).toBe(`${code}  subgraph grupo1 [Grupo]\n    B\n  end\n`);
  });
  it('no repite ids de grupo ni exige salto de línea final', () => {
    const out = wrapInGroup('flowchart TD\n  subgraph grupo1 [X]\n    A\n  end\n  B', 'B');
    expect(out).toContain('subgraph grupo2 [Grupo]');
    expect(out.endsWith('  end\n')).toBe(true);
  });
});

describe('paleta', () => {
  const ctx = (selection: string[], participants: string[] = []) => ({
    selection,
    code: '',
    result: { sequence: { participants: participants.map((id) => ({ id })) } },
  });
  it('flujo: los bloques son nodos con su forma; Grupo exige un bloque seleccionado', () => {
    const items = paletteFor('flowchart');
    expect(items.map((i) => i.label)).toEqual(['Inicio / fin', 'Paso', 'Decisión', 'Datos', 'Base de datos', 'Grupo']);
    expect(items[2].make(ctx([]))).toMatchObject({ kind: 'op', op: { type: 'addNode', shape: 'diamond' } });
    const grupo = items[5];
    expect(grupo.make(ctx([]))).toBeNull();
    expect(grupo.make(ctx(['node:A']))).toMatchObject({ kind: 'text' });
  });
  it('secuencia: el mensaje va del seleccionado al siguiente, o entre los dos últimos', () => {
    const msg = paletteFor('sequence').find((i) => i.id === 'mensaje')!;
    expect(msg.make(ctx([], ['A']))).toBeNull();
    expect(msg.make(ctx([], ['A', 'B', 'C']))).toMatchObject({ op: { source: 'B', target: 'C' } });
    expect(msg.make(ctx(['participant:A'], ['A', 'B', 'C']))).toMatchObject({ op: { source: 'A', target: 'B' } });
    expect(msg.make(ctx(['participant:C'], ['A', 'B', 'C']))).toMatchObject({ op: { source: 'C', target: 'A' } });
  });
  it('sin edición visual no hay paleta', () => {
    expect(paletteFor('otro')).toEqual([]);
  });
});

describe('esVisimer', () => {
  it('traduce las etiquetas conocidas y deja el resto', () => {
    expect(esVisimer('Delete')).toBe('Borrar');
    expect(esVisimer('Edit text')).toBe('Cambiar texto');
    expect(esVisimer('Node shape')).toBe('Cambiar forma');
    expect(esVisimer('Fill: #ff0000')).toBe('Relleno: #ff0000');
    expect(esVisimer('Fill: default')).toBe('Relleno: por defecto');
    expect(esVisimer('Algo raro')).toBe('Algo raro');
  });
});

// ---- Modelo y operaciones del panel de propiedades (con el motor real de Visimer) ----
import { MermaidWysiwygEditor } from '../../web/node_modules/@visimer/core/dist/index.js';
import { buildModel, connectOp, deleteBlockOp, deleteLinkOp, directionOp, linkLabelOp, renameOp, shapeOp, shapeOptions, type DiagramKind, type VisimerOp } from '../../web/src/lib/diagramEdit.ts';

const FLOW = `%%{init: {"theme":"neutral"}}%%
flowchart TD
  %% mi comentario
  A([Inicio]) --> B[Leer los datos]
  B --> C{¿Válidos?}
  C -->|Sí| D[Procesar]
  C -->|No| E[Mostrar error]
  classDef x fill:#fff
`;
const model = (code: string) => {
  const ed = new MermaidWysiwygEditor({ code });
  return { ed, kind: diagramKind(code) as DiagramKind, m: buildModel(diagramKind(code), ed.result as never) };
};
const apply = (ed: MermaidWysiwygEditor, op: VisimerOp | null) => {
  expect(op).not.toBeNull();
  ed.dispatch(op as never);
  return ed.code;
};

describe('buildModel', () => {
  it('lista bloques y conexiones de un diagrama de flujo', () => {
    const { m } = model(FLOW);
    expect(m.blocks.map((b) => [b.label, b.shape])).toEqual([['Inicio', 'stadium'], ['Leer los datos', 'rect'], ['¿Válidos?', 'diamond'], ['Procesar', 'rect'], ['Mostrar error', 'rect']]);
    expect(m.links).toHaveLength(4);
    expect(m.links[3]).toMatchObject({ fromLabel: '¿Válidos?', toLabel: 'Mostrar error', label: 'No' });
    expect(m.direction).toBe('TD');
    expect(m.hasDirection).toBe(true);
  });
  it('estados: [*] se llama Inicio / Fin', () => {
    const { m } = model('stateDiagram-v2\n  [*] --> A\n  A --> [*]\n');
    expect(m.blocks.map((b) => b.raw)).toEqual(['A']);
    expect(m.links.map((l) => [l.fromLabel, l.toLabel])).toEqual([['Inicio', 'A'], ['A', 'Fin']]);
  });
  it('secuencia y ER no tienen dirección; solo cuentan mensajes y relaciones', () => {
    const s = model('sequenceDiagram\n  A->>B: hola\n  Note right of B: nota\n  B-->>A: vale\n').m;
    expect(s.blocks).toHaveLength(2);
    expect(s.links.map((l) => l.label)).toEqual(['hola', 'vale']);
    expect(s.hasDirection).toBe(false);
    const e = model('erDiagram\n  CLIENTE ||--o{ PEDIDO : hace\n').m;
    expect(e.blocks).toHaveLength(2);
    expect(e.links[0]).toMatchObject({ fromLabel: 'CLIENTE', label: 'hace' });
  });
  it('clases con dirección', () => {
    const c = model('classDiagram\n  direction LR\n  A <|-- B : hereda\n').m;
    expect(c.direction).toBe('LR');
    expect(c.links[0].label).toBe('hereda');
  });
});

describe('operaciones del panel (flujo)', () => {
  it('renombrar, cambiar forma, etiqueta de conexión y dirección tocan solo su línea', () => {
    const { ed, kind } = model(FLOW);
    expect(apply(ed, renameOp(kind, 'node:E', 'Mostrar el error'))).toContain('E[Mostrar el error]');
    expect(apply(ed, shapeOp(kind, 'node:D', 'diamond'))).toContain('D{Procesar}');
    const edge = buildModel(kind, ed.result as never).links[3];
    expect(apply(ed, linkLabelOp(kind, edge.id, 'Nunca'))).toContain('C -->|Nunca| E');
    const out = apply(ed, directionOp(kind, 'LR'));
    expect(out).toContain('flowchart LR');
    // Lo demás queda igual: comentarios, init y classDef.
    expect(out).toContain('%%{init: {"theme":"neutral"}}%%');
    expect(out).toContain('  %% mi comentario\n');
    expect(out.endsWith('  classDef x fill:#fff\n')).toBe(true);
    expect(out).toContain('A([Inicio]) --> B[Leer los datos]');
  });
  it('quitar una conexión borra solo esa flecha; conectar añade una', () => {
    const { ed, kind } = model(FLOW);
    const e = buildModel(kind, ed.result as never).links.find((l) => l.label === 'Sí')!;
    const out = apply(ed, deleteLinkOp(kind, e.id));
    expect(out).not.toContain('|Sí|');
    expect(out).toContain('C -->|No| E[Mostrar error]');
    expect(apply(ed, connectOp(kind, 'node:D', 'node:A'))).toContain('D --> A');
  });
  it('borrar un bloque quita también sus flechas', () => {
    const { ed, kind } = model(FLOW);
    const out = apply(ed, deleteBlockOp(kind, 'node:E'));
    expect(out).not.toContain('Mostrar error');
  });
  it('las formas válidas dependen del tipo', () => {
    expect(shapeOptions('flowchart').map((s) => s.id)).toContain('diamond');
    expect(shapeOptions('state').map((s) => s.id)).toEqual(['state', 'choice', 'fork', 'join']);
    expect(shapeOptions('er')).toEqual([]);
  });
});

describe('operaciones del panel (otros tipos)', () => {
  it('estados: cambiar a decisión, etiqueta y borrado de transición', () => {
    const { ed, kind } = model('stateDiagram-v2\n  [*] --> A\n  A --> B\n');
    expect(apply(ed, shapeOp(kind, 'state:A', 'choice'))).toContain('state A <<choice>>');
    const t = buildModel(kind, ed.result as never).links[1];
    expect(apply(ed, linkLabelOp(kind, t.id, 'sí'))).toContain('A --> B: sí');
    const t2 = buildModel(kind, ed.result as never).links[1];
    expect(apply(ed, deleteLinkOp(kind, t2.id))).not.toContain('A --> B');
    expect(apply(ed, directionOp(kind, 'LR'))).toContain('direction LR');
  });
  it('secuencia: renombrar participante, mensaje y tipo', () => {
    const { ed, kind } = model('sequenceDiagram\n  participant A\n  A->>B: hola\n');
    expect(apply(ed, shapeOp(kind, 'participant:A', 'actor'))).toContain('actor A');
    const l = buildModel(kind, ed.result as never).links[0];
    expect(apply(ed, linkLabelOp(kind, l.id, 'adiós'))).toContain('A->>B: adiós');
    expect(apply(ed, connectOp(kind, 'participant:B', 'participant:A'))).toContain('B->>A: Mensaje');
  });
  it('ER y clases: etiqueta de relación y conectar', () => {
    const er = model('erDiagram\n  A ||--o{ B : hace\n  C {\n    int id\n  }\n');
    expect(apply(er.ed, linkLabelOp(er.kind, buildModel(er.kind, er.ed.result as never).links[0].id, 'tiene'))).toContain('A ||--o{ B : tiene');
    expect(apply(er.ed, connectOp(er.kind, 'entity:B', 'entity:C'))).toContain('B ||--o{ C : tiene');
    const cl = model('classDiagram\n  A <|-- B\n');
    expect(apply(cl.ed, connectOp(cl.kind, 'class:B', 'class:A'))).toMatch(/B --> A/);
  });
});
