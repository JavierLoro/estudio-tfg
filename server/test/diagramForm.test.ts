import { describe, expect, it } from 'vitest';
import { diagramFieldKey, diagramForm, diagramFormKind, insertDiagramSource, moveDiagramRow, removeDiagramRow, updateDiagramFields, validateDiagramForm } from '../../web/src/lib/diagramForm.ts';
import { DIAGRAM_TEMPLATES } from '../../web/src/lib/diagramTemplates.ts';

const templates = DIAGRAM_TEMPLATES.slice(6);
describe('formularios de diagramas', () => {
  it.each(templates)('$label: reconoce campos y cambia solo el texto elegido', template => {
    const source = `---\ntitle: ${template.source.split('\n')[0]}\n---\n%% Comentario ficticio\n${template.source}`;
    const model = diagramForm(source)!;
    expect(model).not.toBeNull();
    expect(model.rows.length).toBeGreaterThan(1);
    const field = model.rows.flatMap(r => r.fields).find(f => !f.type && !f.choices)!;
    expect(field).toBeDefined();
    const edited = updateDiagramFields(source, [field], ['Texto nuevo']);
    expect(edited).toBe(source.slice(0, field.from) + 'Texto nuevo' + source.slice(field.to));
    expect(edited).toContain('%% Comentario ficticio');
    expect(model.additions.length).toBeGreaterThan(0);
  });
  it.each(templates)('$label: conserva CRLF y los fragmentos no reconocidos', template => {
    const source = template.source.replace(/\n/g, '\r\n');
    const model = diagramForm(source)!;
    expect(model.rows.length).toBe(diagramForm(template.source)!.rows.length);
    expect(model.rows.flatMap(r => r.fields).length).toBe(diagramForm(template.source)!.rows.flatMap(r => r.fields).length);
    const fields = model.rows.flatMap(r => r.fields);
    for (const field of fields) expect(source.slice(field.from, field.to)).toBe(field.gantt?.task.source ?? field.value);
    expect(new Set(fields.map(diagramFieldKey)).size).toBe(fields.length);
    const next = insertDiagramSource(source, source.length, model.additions[0].source);
    expect(next.startsWith(source)).toBe(true);
    expect(next.replace(/\r\n/g, '')).not.toContain('\n');
  });
  it('no confunde comentarios, cabeceras ni otros tipos con un formulario', () => {
    expect(diagramFormKind('%% pie\nflowchart TD\nA-->B')).toBeNull();
    expect(diagramFormKind('')).toBeNull();
    expect(diagramFormKind('pie showData')).toBe('pie');
  });
  it('aplica varios campos de una vez y conserva las opciones avanzadas', () => {
    const source = '%% ficticio\npie showData\n  "Uno" : 10\n  "Dos" : 20\n';
    const fields = diagramForm(source)!.rows.flatMap(r => r.fields);
    expect(updateDiagramFields(source, fields, ['Nombre largo', '15', 'Otro', '30']))
      .toBe('%% ficticio\npie showData\n  "Nombre largo" : 15\n  "Otro" : 30\n');
    expect(() => updateDiagramFields(source, fields, ['X"\nmal', '15', 'Otro', '30'])).toThrow(/delimitadores/);
    expect(() => updateDiagramFields(source, fields, ['Uno', '-1', 'Dos', '20'])).toThrow(/número/);
    expect(() => updateDiagramFields('otra fuente', fields, fields.map(f => f.value))).toThrow(/fuente/);
  });
  it('limita coordenadas y conserva opciones desconocidas sin modificarlas', () => {
    const source = DIAGRAM_TEMPLATES.find(t => t.id === 'cuadrantes')!.source;
    const field = diagramForm(source)!.rows.flatMap(r => r.fields).find(f => f.label === 'Coordenada X')!;
    expect(() => updateDiagramFields(source, [field], ['1.1'])).toThrow(/número/);
    const custom = 'requirementDiagram\n requirement r {\n  text: "Texto: con símbolos"\n  risk: custom\n }\n';
    const fields = diagramForm(custom)!.rows.flatMap(r => r.fields);
    expect(updateDiagramFields(custom, fields, ['Revisado', 'custom'])).toContain('text: "Revisado"');
    expect(() => updateDiagramFields(custom, fields, ['Revisado', 'invalid'])).toThrow(/selecciona/);
  });
  it('añade hijos sin mover las ramas siguientes ni repetir ids', () => {
    const source = 'kanban\n  pendiente[Pendiente]\n    nuevo1[Una tarea]\n  final[Final]\n';
    const model = diagramForm(source)!;
    const first = model.rows[0];
    const next = insertDiagramSource(source, first.child!.at, first.child!.source);
    expect(next).toContain('    nuevo1[Una tarea]\n    nuevo2[Nueva tarjeta]\n  final[Final]');
    expect(first.removable).toBe(false);
    expect(model.rows[1].child).toBeUndefined();
    expect(model.rows[1].removable).toBe(true);
    const mind = diagramForm('mindmap\n  root((Raíz))\n    ::icon(fa fa-book)\n    Rama\n      Hoja\n    Otra rama\n')!;
    expect(mind.rows.map(r => r.fields[0].value)).toEqual(['Raíz', 'Rama', 'Hoja', 'Otra rama']);
    expect(mind.rows.map(r => r.removable)).toEqual([false, false, true, true]);
  });
  it('las líneas CSV entrecomilladas y comentarios no se reescriben', () => {
    const source = 'sankey-beta\n"Origen, especial",Destino,10\nNormal,Otro,20\n';
    const model = diagramForm(source)!;
    expect(model.rows).toHaveLength(1);
    const field = model.rows[0].fields[2];
    expect(updateDiagramFields(source, [field], ['30'])).toContain('"Origen, especial",Destino,10\nNormal,Otro,30');
  });
});

describe('operaciones del formulario sin código', () => {
  it('añade sectores con nombres únicos y rechaza etiquetas duplicadas', () => {
    let source = 'pie showData\n  "Nuevo sector" : 10\n';
    for (let i = 0; i < 2; i++) source = insertDiagramSource(source, source.length, diagramForm(source)!.additions[0].source);
    expect(source).toContain('"Nuevo sector 2" : 10');
    expect(source).toContain('"Nuevo sector 3" : 10');
    const field = diagramForm(source)!.rows[1].fields[0];
    expect(() => updateDiagramFields(source, [field], ['Nuevo sector'])).toThrow(/etiqueta diferente/);
    expect(source).toContain('"Nuevo sector 2"');
  });
  it('elimina un nodo C4 y todas sus relaciones, conservando otros nodos y comentarios', () => {
    const source = 'C4Context\r\n%% ficticio\r\n  Person(a, "A")\r\n  System(b, "B")\r\n  System(c, "C")\r\n  Rel(a,b,"usa")\r\n  Rel_D(b,c,"consulta")\r\n  BiRel(a,c,"comparte")\r\n';
    const row = diagramForm(source)!.rows.find(r => r.id === 'b')!;
    const next = removeDiagramRow(source, row.from);
    expect(next).toBe('C4Context\r\n%% ficticio\r\n  Person(a, "A")\r\n  System(c, "C")\r\n  BiRel(a,c,"comparte")\r\n');
  });
  it('elimina elementos y requisitos junto a relaciones en ambas direcciones', () => {
    const source = 'requirementDiagram\n  requirement a {\n    id: A\n    text: Texto\n    risk: low\n    verifymethod: test\n  }\n  element b {\n    type: Prueba\n  }\n  element c {\n    type: Otro\n  }\n  b - satisfies -> a\n  a <- verifies - c\n%% conservar\n';
    const next = removeDiagramRow(source, diagramForm(source)!.rows.find(r => r.id === 'a')!.from);
    expect(next).not.toContain('requirement a');
    expect(next).not.toContain('satisfies');
    expect(next).not.toContain('verifies');
    expect(next).toContain('element b');
    expect(next).toContain('element c');
    expect(next).toContain('%% conservar');
  });
  it('mueve una tarjeta con metadatos y reordena columnas sin reescribirlas', () => {
    const source = 'kanban\r\n  p[Pendiente]\r\n    a[Primera] @{ assigned: "Ana" }\r\n    b[Segunda]\r\n  f[Final]\r\n    c[Otra]\r\n';
    let model = diagramForm(source)!;
    const card = model.rows.find(r => r.fields[0].value === 'Primera')!;
    const column = model.rows.find(r => r.fields[0].value === 'Final')!;
    const next = moveDiagramRow(source, card.from, column.from);
    expect(next).toBe('kanban\r\n  p[Pendiente]\r\n    b[Segunda]\r\n  f[Final]\r\n    c[Otra]\r\n    a[Primera] @{ assigned: "Ana" }\r\n');
    model = diagramForm(next)!;
    const first = model.rows.find(r => r.fields[0].value === 'Pendiente')!;
    const reordered = moveDiagramRow(next, model.rows.find(r => r.fields[0].value === 'Final')!.from, null, first.from);
    expect(reordered).toBe('kanban\r\n  f[Final]\r\n    c[Otra]\r\n    a[Primera] @{ assigned: "Ana" }\r\n  p[Pendiente]\r\n    b[Segunda]\r\n');
  });
  it('reubica un subárbol mental con sus metadatos y conserva el resto literalmente', () => {
    const source = 'mindmap\n  root((Proyecto))\n    Rama\n      ::icon(fa fa-book)\n      Hoja\n        Nieto\n    Otra\n      Destino\n';
    const rows = diagramForm(source)!.rows;
    const next = moveDiagramRow(source, rows.find(r => r.fields[0].value === 'Rama')!.from, rows.find(r => r.fields[0].value === 'Destino')!.from);
    expect(next).toBe('mindmap\n  root((Proyecto))\n    Otra\n      Destino\n        Rama\n          ::icon(fa fa-book)\n          Hoja\n            Nieto\n');
  });
  it('protege la raíz, impide ciclos y no borra ramas con hijos', () => {
    const source = 'mindmap\n  root((Raíz))\n    Rama\n      Hoja\n    Otra\n';
    const rows = diagramForm(source)!.rows;
    expect(() => moveDiagramRow(source, rows[0].from, rows[3].from)).toThrow(/destino/);
    expect(() => moveDiagramRow(source, rows[1].from, rows[2].from)).toThrow(/destino|sí misma/);
    expect(() => removeDiagramRow(source, rows[1].from)).toThrow(/contenga/);
    const next = moveDiagramRow(source, rows[3].from, rows[0].from, rows[1].from);
    expect(next).toBe('mindmap\n  root((Raíz))\n    Otra\n    Rama\n      Hoja\n');
  });
  it('Gantt expone estado, prioridad, hito y dependencias y conserva líneas ajenas', () => {
    const source = 'gantt\r\n  dateFormat YYYY-MM-DD\r\n%% conservar\r\n  Primera :a, 2026-01-01, 7d\r\n  Segunda :active, b, after a, 3d\r\n';
    const row = diagramForm(source)!.rows.find(r => r.id === 'b')!;
    const fields = row.fields;
    const values = fields.map(f => ({ 'Estado de tarea': 'done', 'Prioridad de tarea': 'crit', 'Tipo de tarea': 'milestone', 'Fin o duración': '0d' }[f.label] ?? f.value));
    const next = updateDiagramFields(source, fields, values);
    expect(next).toBe('gantt\r\n  dateFormat YYYY-MM-DD\r\n%% conservar\r\n  Primera :a, 2026-01-01, 7d\r\n  Segunda :done, crit, milestone, b, after a, 0d\r\n');
    expect(diagramForm(next)!.rows.find(r => r.id === 'b')!.fields.find(f => f.label === 'Dependencias')!.value).toBe('a');
  });
  it('Gantt permite varias dependencias y cambiar de dependencia a fecha', () => {
    const source = 'gantt\n  A :a, 2026-01-01, 3d\n  B :b, 2026-01-01, 3d\n  C :c, 2026-01-01, 3d\n';
    let fields = diagramForm(source)!.rows.find(r => r.id === 'c')!.fields;
    const next = updateDiagramFields(source, fields, fields.map(f => f.label === 'Dependencias' ? 'a b' : f.label === 'Inicio' ? '' : f.value));
    expect(next).toContain('C :c, after a b, 3d');
    fields = diagramForm(next)!.rows.find(r => r.id === 'c')!.fields;
    const dated = updateDiagramFields(next, fields, fields.map(f => f.label === 'Dependencias' ? '' : f.label === 'Inicio' ? '2026-02-01' : f.value));
    expect(dated).toContain('C :c, 2026-02-01, 3d');
  });
  it('Gantt rechaza ciclos, dependencias inexistentes y fechas invertidas', () => {
    expect(() => validateDiagramForm('gantt\n A :a, after b, 1d\n B :b, after a, 1d\n')).toThrow(/ciclo/);
    expect(() => validateDiagramForm('gantt\n A :a, after inexistente, 1d\n')).toThrow(/no existe/);
    const source = 'gantt\n A :a, 2026-02-01, 2026-02-08\n';
    const field = diagramForm(source)!.rows[0].fields.find(f => f.label === 'Fin o duración')!;
    expect(() => updateDiagramFields(source, [field], ['2026-01-01'])).toThrow(/anterior/);
  });
  it('no interpreta tareas dentro de comentarios ni pierde dependencias de sintaxis avanzada', () => {
    const source = 'gantt\n%% Falsa :falsa, 2026-01-01, 3d\n  Implícita :previa, 3d\n  Tarea :siguiente, after previa, 2d\n';
    expect(diagramForm(source)!.rows.filter(r => r.name === 'Tarea')).toHaveLength(1);
    expect(() => validateDiagramForm(source)).not.toThrow();
    const field = diagramForm(source)!.rows[0].fields[0];
    expect(updateDiagramFields(source, [field], ['Renombrada'])).toBe(source.replace('  Tarea :', '  Renombrada :'));
  });
  it.each(['gantt', 'timeline'])('%s mueve elementos y secciones completas con comentarios', kind => {
    const task = (name: string) => kind === 'gantt' ? `${name} :${name}, 2026-01-01, 7d` : `${name} : Acontecimiento`;
    const source = `${kind}\n  title Título\n  section Una\n  ${task('a')}\n%% conservar\n  ${task('b')}\n  section Dos\n  ${task('c')}\n`;
    let model = diagramForm(source)!;
    const a = model.rows.find(r => r.fields[0].value === 'a')!;
    const two = model.rows.find(r => r.fields[0].value === 'Dos')!;
    const next = moveDiagramRow(source, a.from, two.from);
    expect(next).toContain(`section Dos\n  ${task('c')}\n  ${task('a')}\n%% conservar\n`);
    model = diagramForm(next)!;
    const first = model.rows.find(r => r.fields[0].value === 'Una')!;
    const reordered = moveDiagramRow(next, model.rows.find(r => r.fields[0].value === 'Dos')!.from, null, first.from);
    expect(reordered.indexOf('section Dos')).toBeLessThan(reordered.indexOf('section Una'));
    expect(reordered.match(/%% conservar/g)).toHaveLength(1);
  });
  it('explica por qué no puede eliminarse el último flujo Sankey', () => {
    const source = 'sankey-beta\nA,B,10\n';
    expect(() => removeDiagramRow(source, diagramForm(source)!.rows[0].from)).toThrow(/al menos un flujo/);
  });
});
