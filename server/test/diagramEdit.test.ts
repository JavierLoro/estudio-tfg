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
