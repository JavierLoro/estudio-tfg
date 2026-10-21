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
    expect(grupo.make(ctx(['node:A']))).toMatchObject({ kind: 'op', op: { type: 'et.createGroup', id: 'A' } });
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
import { svgColorHex, attributeParts, attributeText, memberParts, memberText, controlSource, nextParticipantId, erCard, buildModel, connectOp, deleteBlockOp, deleteLinkOp, directionOp, linkLabelOp, renameOp, shapeOp, shapeOptions, type DiagramKind, type VisimerOp } from '../../web/src/lib/diagramEdit.ts';

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
  const next = controlSource(ed.code, ed.result, op!);
  if (next !== null) ed.setCode(next);
  else ed.dispatch(op as never);
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


describe('controles estructurales sin código', () => {
  it('Actor y Participante tienen ids seguros y alias separados aunque se repitan sus nombres', () => {
    const ed = new MermaidWysiwygEditor({ code: 'sequenceDiagram\n  participant P1 as Sistema\n' });
    for (const id of ['actor', 'participante', 'actor']) {
      const item = paletteFor('sequence').find((p) => p.id === id)!;
      const action = item.make({ code: ed.code, result: ed.result, selection: [] });
      expect(action?.kind).toBe('op');
      if (!action || action.kind !== 'op') throw new Error('Falta la operación');
      const result = ed.dispatch(action.op as never);
      for (const follow of action.follow?.(result!.created![0].slice('participant:'.length)) ?? []) apply(ed, follow);
    }
    expect(ed.result.sequence!.participants.map((p) => [p.id, p.label])).toEqual([['P1', 'Sistema'], ['P2', 'Actor'], ['P3', 'Participante'], ['P4', 'Actor']]);
    expect(nextParticipantId(ed.result)).toBe('P5');
    apply(ed, connectOp('sequence', 'participant:P2', 'participant:P3'));
    expect(ed.code).toContain('P2->>P3: Mensaje');
    expect(ed.code).not.toContain('Actor->>');
  });

  it('renombrar conserva ids, referencias, activaciones, notas y atributos de tipo', () => {
    const source = 'sequenceDiagram\n  %% comentario\n  participant A@{ "type": "database" }\n  actor B as Persona\n  A->>B: hola\n  activate B\n  Note right of A: nota\n  deactivate B\n';
    const ed = new MermaidWysiwygEditor({ code: source });
    const out = apply(ed, renameOp('sequence', 'participant:A', 'Base de datos'));
    expect(out).toContain('participant A as Base de datos@{ "type": "database" }');
    expect(out).toContain('A->>B: hola');
    expect(out).toContain('Note right of A: nota');
    expect(apply(ed, renameOp('sequence', 'participant:B', 'Usuario final'))).toContain('actor B as Usuario final');
    expect(ed.code).toContain('activate B\n');
    expect(ed.code).toContain('deactivate B\n');
    expect(ed.result.sequence!.participants.map((p) => p.id)).toEqual(['A', 'B']);
  });

  it('renombrar un participante implícito añade una declaración sin tocar mensajes', () => {
    const ed = new MermaidWysiwygEditor({ code: '%% nota\nsequenceDiagram\n  A->>B: mensaje\n' });
    const out = apply(ed, renameOp('sequence', 'participant:A', 'Persona'));
    expect(out).toContain('participant A as Persona');
    expect(out).toContain('A->>B: mensaje');
    expect(ed.result.sequence!.participants[0].label).toBe('Persona');
  });

  it('los atributos ER se editan por campos, se borran individualmente y conservan el resto', () => {
    const { ed } = model('erDiagram\n  %% original\n  A {\n    int id PK "Identificador"\n    string titulo\n  }\n  A ||--o{ B : tiene\n');
    const a = buildModel('er', ed.result).blocks.find((b) => b.raw === 'A')!;
    expect(a.members).toHaveLength(2);
    const parts = attributeParts(a.members![0].text)!;
    expect(parts).toEqual({ type: 'int', name: 'id', keys: 'PK', comment: 'Identificador' });
    apply(ed, { type: 'er.setAttributeText', id: 'A', attrLine: a.members![0].line, text: attributeText({ ...parts, type: 'uuid', keys: 'PK,FK' }) });
    expect(ed.code).toContain('uuid id PK,FK "Identificador"');
    const attr = buildModel('er', ed.result).blocks.find((b) => b.raw === 'A')!.members![1];
    apply(ed, { type: 'er.setAttributeText', id: 'A', attrLine: attr.line, text: '' });
    expect(ed.code).not.toContain('string titulo');
    expect(ed.code).toContain('%% original');
    expect(ed.code).toContain('A ||--o{ B : tiene');
  });

  it('edita cardinalidades ER y tipo identificador desde operaciones instaladas', () => {
    const { ed } = model('erDiagram\n  A ||--o{ B : tiene\n');
    let l = buildModel('er', ed.result).links[0];
    expect(erCard(l.style!.leftCard!)).toBe('exactly-one');
    expect(erCard(l.style!.rightCard!)).toBe('zero-or-more');
    apply(ed, { type: 'er.setCardinality', relId: l.id, side: 'left', card: 'zero-or-one' });
    l = buildModel('er', ed.result).links[0];
    apply(ed, { type: 'er.setCardinality', relId: l.id, side: 'right', card: 'one-or-more' });
    apply(ed, { type: 'er.setIdentifying', relId: l.id, identifying: false });
    expect(ed.code).toContain('A |o..|{ B : tiene');
  });

  it('edita atributos y métodos, visibilidad y relaciones de clases sin sustituir el documento', () => {
    const { ed } = model('classDiagram\n  %% conservar\n  class A {\n    +String nombre\n    +buscar(String texto) bool\n  }\n  A "1" --> "*" B : crea\n');
    let b = buildModel('class', ed.result).blocks.find((b) => b.raw === 'A')!;
    const parts = memberParts(b.members![1].text);
    expect(parts).toEqual({ name: 'buscar', type: 'bool', parameters: 'String texto', visibility: '+', modifier: '', method: true });
    apply(ed, { type: 'cl.setMemberText', id: 'A', memberLine: b.members![1].line, text: memberText({ ...parts, visibility: '-', type: 'int', modifier: '$' }) });
    expect(ed.code).toContain('-buscar(String texto) int$');
    b = buildModel('class', ed.result).blocks.find((b) => b.raw === 'A')!;
    apply(ed, { type: 'cl.deleteMember', id: 'A', memberLine: b.members![0].line });
    expect(ed.code).not.toContain('+String nombre');
    const l = buildModel('class', ed.result).links[0];
    expect(l.style).toMatchObject({ op: '-->', sourceCard: '1', targetCard: '*' });
    apply(ed, { type: 'cl.setRelationType', relId: l.id, op: '*--' });
    apply(ed, { type: 'cl.setCardinality', relId: l.id, side: 'target', value: '1..*' });
    expect(ed.code).toContain('A "1" *-- "1..*" B : crea');
    expect(ed.code).toContain('%% conservar');
  });

  it('activar durante un mensaje añade una pareja equilibrada y se puede quitar', () => {
    const source = 'sequenceDiagram\n  A->>B: uno\n  B-->>A: dos\n';
    const ed = new MermaidWysiwygEditor({ code: source });
    let id = buildModel('sequence', ed.result).links[0].id;
    expect(apply(ed, { type: 'et.activation', eventId: id })).toContain('activate B\n  A->>B: uno\n  deactivate B');
    id = buildModel('sequence', ed.result).links[0].id;
    expect(apply(ed, { type: 'et.activation', eventId: id })).toBe(source);
  });

  it('mover nodos entre grupos mantiene flechas, etiquetas y pertenencia de los demás', () => {
    const source = 'flowchart LR\n  %% conservar\n  subgraph uno [Uno]\n    A[Primero] --> B[Segundo]\n  end\n  subgraph dos [Dos]\n    C[Tercero]\n  end\n';
    const ed = new MermaidWysiwygEditor({ code: source });
    apply(ed, { type: 'et.moveGroup', id: 'A', group: 'dos' });
    let m = buildModel('flowchart', ed.result);
    expect(m.blocks.find((b) => b.raw === 'A')).toMatchObject({ label: 'Primero', parent: 'dos' });
    expect(m.blocks.find((b) => b.raw === 'B')).toMatchObject({ label: 'Segundo', parent: 'uno' });
    expect(m.links.map((l) => [l.from, l.to])).toEqual([['node:A', 'node:B']]);
    expect(ed.code).toContain('%% conservar');
    apply(ed, { type: 'et.moveGroup', id: 'A', group: '' });
    m = buildModel('flowchart', ed.result);
    expect(m.blocks.find((b) => b.raw === 'A')!.parent).toBeNull();
    expect(m.blocks.find((b) => b.raw === 'B')!.parent).toBe('uno');
  });

  it('crear grupo coloca el nodo dentro sin cambiar sus conexiones', () => {
    const { ed } = model('flowchart LR\n  A[Uno] --> B[Dos]\n');
    apply(ed, { type: 'et.createGroup', id: 'A' });
    const m = buildModel('flowchart', ed.result);
    expect(m.blocks.find((b) => b.raw === 'A')!.parent).toBe('grupo1');
    expect(m.blocks.find((b) => b.raw === 'B')!.parent).toBeNull();
    expect(m.links).toHaveLength(1);
  });
});


describe('conservación de fuente en controles locales', () => {
  it('conserva CRLF al renombrar implícitos y al activar mensajes', () => {
    const ed = new MermaidWysiwygEditor({ code: '%% conservar\r\nsequenceDiagram\r\n  A->>B: mensaje\r\n' });
    apply(ed, renameOp('sequence', 'participant:A', 'Persona'));
    expect(ed.code).toContain('sequenceDiagram\r\n  participant A as Persona\r\n');
    const id = buildModel('sequence', ed.result).links[0].id;
    apply(ed, { type: 'et.activation', eventId: id });
    expect(ed.code.replace(/\r\n/g, '')).not.toContain('\n');
    expect(ed.code).toContain('%% conservar\r\n');
  });
  it('mueve estados simples entre compuestos conservando comentarios y CRLF', () => {
    const ed = new MermaidWysiwygEditor({ code: 'stateDiagram-v2\r\n  %% conservar\r\n  [*] --> A\r\n  state A\r\n  state Grupo {\r\n    B\r\n  }\r\n' });
    apply(ed, { type: 'et.moveGroup', id: 'A', group: 'Grupo' });
    expect(ed.code.replace(/\r\n/g, '')).not.toContain('\n');
    expect(ed.code).toContain('%% conservar\r\n');
    expect(ed.code).toContain('[*] --> A');
    expect(buildModel('state', ed.result).blocks.find((b) => b.raw === 'A')!.parent).toBe('Grupo');
    apply(ed, { type: 'et.moveGroup', id: 'A', group: '' });
    expect(buildModel('state', ed.result).blocks.find((b) => b.raw === 'A')!.parent).toBeNull();
  });
  it('mueve nodos con CRLF y deja los comentarios de grupos intactos', () => {
    const ed = new MermaidWysiwygEditor({ code: 'flowchart LR\r\n  subgraph uno [Uno]\r\n    %% primero\r\n    A[Inicio] --> B[Paso]\r\n  end\r\n  subgraph dos [Dos]\r\n    %% segundo\r\n    C[Fin]\r\n  end\r\n' });
    apply(ed, { type: 'et.moveGroup', id: 'B', group: 'dos' });
    expect(ed.code.replace(/\r\n/g, '')).not.toContain('\n');
    expect(ed.code).toContain('%% primero\r\n');
    expect(ed.code).toContain('%% segundo\r\n');
    expect(buildModel('flowchart', ed.result).blocks.find((b) => b.raw === 'B')!.parent).toBe('dos');
  });
});


describe('grupos compuestos y referencias compartidas', () => {
  it('crear un compuesto mantiene etiqueta, conexiones y devuelve pertenencia editable', () => {
    const ed = new MermaidWysiwygEditor({ code: 'stateDiagram-v2\n  %% conservar\n  [*] --> A\n  A: Preparando\n  A --> B\n' });
    apply(ed, { type: 'st.moveToComposite', id: 'A' });
    const m = buildModel('state', ed.result);
    expect(m.blocks.find((b) => b.raw === 'A')).toMatchObject({ label: 'Preparando', parent: 'Composite1' });
    expect(m.groups).toEqual([{ id: 'Composite1', label: 'Composite1', parent: null }]);
    expect(m.links).toHaveLength(2);
    expect(ed.code).toContain('%% conservar');
  });
  it('mover conserva la etiqueta efectiva y las clases de referencias distintas', () => {
    const ed = new MermaidWysiwygEditor({ code: 'flowchart LR\n  A[Antes]:::primera\n  A[Después]\n  A:::segunda\n  subgraph grupo [Destino]\n    B[Otro]\n  end\n  classDef primera fill:#fff\n  classDef segunda stroke:#111\n' });
    apply(ed, { type: 'et.moveGroup', id: 'A', group: 'grupo' });
    const node = ed.result.flowchart!.nodes.find((n) => n.id === 'A')!;
    expect(node.label).toBe('Después');
    expect(node.subgraph).toBe('grupo');
    expect(node.classes).toEqual(['primera', 'segunda']);
    expect(ed.code).toContain('classDef primera fill:#fff');
  });
});


describe('colores del SVG para los controles nativos', () => {
  it('convierte canales opacos y no representa transparencias como colores opacos falsos', () => {
    expect(svgColorHex('rgb(0, 15, 255)')).toBe('#000fff');
    expect(svgColorHex('rgb(255,255,255)')).toBe('#ffffff');
    expect(svgColorHex('rgba(255, 0, 0, 0.5)')).toBeNull();
    expect(svgColorHex('none')).toBeNull();
  });
});


describe('fragmentos de secuencia', () => {
  it('envuelve el mensaje con ayuda en español y conserva CRLF', () => {
    const ed = new MermaidWysiwygEditor({ code: 'sequenceDiagram\r\n  A->>B: hola\r\n' });
    const id = buildModel('sequence', ed.result).links[0].id;
    apply(ed, { type: 'seq.wrapInFragment', eventId: id, kind: 'loop' });
    expect(ed.code).toContain('loop Repetir\r\n    A->>B: hola\r\n  end');
    expect(ed.code.replace(/\r\n/g, '')).not.toContain('\n');
    expect(buildModel('sequence', ed.result).links).toHaveLength(1);
  });
});
