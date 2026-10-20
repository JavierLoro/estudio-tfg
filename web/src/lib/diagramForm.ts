// Formularios sobre fragmentos de la fuente: lo que no reconocemos se conserva literalmente.
import { diagramHeader } from './diagramEdit.js';

const FORM_KINDS = {
  gantt: 'Gantt', timeline: 'Cronología', mindmap: 'Mapa mental', C4Context: 'Arquitectura C4',
  kanban: 'Kanban', requirementDiagram: 'Requisitos', pie: 'Sectores', quadrantChart: 'Cuadrantes',
  'sankey-beta': 'Sankey',
} as const;
export type FormKind = keyof typeof FORM_KINDS;
export function diagramFormKind(code: string): FormKind | null {
  const word = diagramHeader(code)?.text.split(/\s/)[0] ?? '';
  return Object.hasOwn(FORM_KINDS, word) ? word as FormKind : null;
}

export interface DiagramField {
  label: string;
  from: number;
  to: number;
  value: string;
  type?: 'number' | 'date';
  min?: number;
  max?: number;
  choices?: readonly (readonly [string, string])[];
  forbidden?: string;
  key?: string;
  optional?: boolean;
  multiple?: boolean;
  gantt?: { task: GanttTask; part: keyof GanttValues };
}
interface GanttValues { state: string; critical: string; milestone: string; start: string; dependencies: string; end: string }
interface GanttTask { from: number; to: number; source: string; id: string; tags: string[]; values: GanttValues }
export const diagramFieldKey = (field: DiagramField) => field.key ?? String(field.from);
export interface DiagramRow {
  name: string;
  from: number;
  to: number;
  fields: DiagramField[];
  removable: boolean;
  child?: { at: number; source: string };
  id?: string;
  move?: { parent: number | null; end: number; indent: string; group: 'tree' | 'section' | 'item'; targets: { from: number | null; label: string }[] };
}
export interface DiagramAddition { label: string; source: string }

export function diagramForm(code: string) {
  const kind = diagramFormKind(code);
  if (!kind) return null;
  const header = diagramHeader(code)!;
  const start = code.indexOf('\n', header.from);
  const offset = start < 0 ? code.length : start + 1;
  const body = code.slice(offset);
  const matches = (pattern: RegExp) => body.matchAll(new RegExp(pattern.source.replaceAll('$', '\\r?$'), pattern.flags));
  const rows: DiagramRow[] = [];
  const additions: DiagramAddition[] = [];
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  let n = 1;
  while (new RegExp(`\\bnuevo${n}\\b`).test(code)) n++;
  const id = `nuevo${n}`;
  type FieldSpec = string | Omit<DiagramField, 'value' | 'from' | 'to'>;
  const collect = (pattern: RegExp, name: string, specs: FieldSpec[], removable = true) => {
    for (const m of matches(pattern)) {
      if (m[0].trimStart().startsWith('%%')) continue;
      const fields = specs.flatMap((spec, i) => {
        const s = typeof spec === 'string' ? { label: spec } : spec;
        const group = i + 1;
        const span = m.indices?.[group];
        return span ? [{ ...s, from: offset + span[0], to: offset + span[1], value: m[group] }] : [];
      });
      rows.push({ name, from: offset + m.index!, to: offset + m.index! + m[0].length, fields, removable });
    }
  };
  const add = (label: string, source: string) => additions.push({ label, source: source.replace(/\n/g, eol) });
  const text = (label: string, forbidden = '') => ({ label, forbidden });
  const num = (label: string, max?: number) => ({ label, type: 'number' as const, min: 0, max });

  if (kind !== 'mindmap' && kind !== 'kanban' && kind !== 'sankey-beta')
    collect(/^[ \t]*title[ \t]+([^\r\n]+)$/dgm, 'Título', ['Título'], false);
  if (kind === 'pie') {
    collect(/^[ \t]*"([^"\r\n]*)"[ \t]*:[ \t]*(\d+(?:\.\d+)?)[ \t]*$/dgm, 'Sector', [text('Etiqueta', '"'), num('Valor')]);
    const labels = new Set(rows.filter(r => r.name === 'Sector').map(r => r.fields[0].value.trim()));
    let label = 'Nuevo sector', suffix = 2;
    while (labels.has(label)) label = `Nuevo sector ${suffix++}`;
    add('Añadir sector', `  "${label}" : 10\n`);
  } else if (kind === 'gantt') {
    collect(/^[ \t]*section[ \t]+([^\r\n]+)$/dgm, 'Sección', ['Nombre de sección'], false);
    for (const m of matches(/^[ \t]*([^:\r\n]+?)[ \t]*:([^\r\n]+)$/dgm)) {
      if (m[0].trimStart().startsWith('%%')) continue;
      const tokens = m[2].split(',').map(t => t.trim());
      const tags: string[] = [];
      while (['active', 'done', 'crit', 'milestone', 'vert'].includes(tokens[0])) tags.push(tokens.shift()!);
      const taskId = tokens.length === 3 ? tokens.shift()! : '';
      if (tokens.length !== 2 || (taskId && !/^[\w-]+$/.test(taskId)) || !/^(?:\d{4}-\d{2}-\d{2}|after\s+[\w -]+)$/.test(tokens[0])) continue;
      const span = m.indices![2]!;
      const task: GanttTask = { from: offset + span[0], to: offset + span[1], source: m[2], id: taskId, tags,
        values: { state: tags.includes('done') ? 'done' : tags.includes('active') ? 'active' : '', critical: tags.includes('crit') ? 'crit' : '',
          milestone: tags.includes('milestone') ? 'milestone' : '', start: tokens[0].startsWith('after ') ? '' : tokens[0],
          dependencies: tokens[0].startsWith('after ') ? tokens[0].slice(6).trim().replace(/\s+/g, ' ') : '', end: tokens[1] } };
      const specs: [keyof GanttValues, Omit<DiagramField, 'from' | 'to' | 'value'>][] = [
        ['state', { label: 'Estado de tarea', choices: [['', 'Pendiente'], ['active', 'Activa'], ['done', 'Completada']] }],
        ['critical', { label: 'Prioridad de tarea', choices: [['', 'Normal'], ['crit', 'Crítica']] }],
        ['milestone', { label: 'Tipo de tarea', choices: [['', 'Tarea'], ['milestone', 'Hito']] }],
        ['start', { label: 'Inicio', type: 'date' }], ['dependencies', { label: 'Dependencias', multiple: true, choices: [] }],
        ['end', { label: 'Fin o duración' }],
      ];
      rows.push({ name: 'Tarea', id: taskId || undefined, from: offset + m.index!, to: offset + m.index! + m[0].length, removable: true,
        fields: [{ label: 'Nombre', forbidden: ':', from: offset + m.indices![1]![0], to: offset + m.indices![1]![1], value: m[1] },
          ...specs.map(([part, spec]) => ({ ...spec, from: task.from, to: task.to, value: task.values[part], optional: part !== 'end',
            key: `${task.from}:${part}`, gantt: { task, part } }))] });
    }
    for (const row of rows.filter(r => r.name === 'Tarea')) row.fields.find(f => f.gantt?.part === 'dependencies')!.choices = rows
      .filter(r => r.name === 'Tarea' && r.id && r !== row).map(r => [r.id!, r.fields[0].value]);
    add('Añadir tarea', `  Nueva tarea :${id}, 2026-01-01, 2026-01-08\n`);
    add('Añadir sección', '  section Nueva sección\n');
  } else if (kind === 'timeline') {
    collect(/^[ \t]*section[ \t]+([^\r\n]+)$/dgm, 'Sección', ['Nombre de sección'], false);
    collect(/^[ \t]*([^:\r\n]+?)[ \t]*:[ \t]*([^\r\n]+)$/dgm, 'Hito', [text('Periodo', ':'), 'Acontecimiento']);
    add('Añadir hito', '  Nuevo periodo : Nuevo acontecimiento\n');
    add('Añadir sección', '  section Nueva sección\n');
  } else if (kind === 'mindmap' || kind === 'kanban') {
    // shortcut: formas especiales y metadatos siguen en código; el formulario conserva sus delimitadores.
    const pattern = kind === 'kanban'
      ? /^([ \t]*)([\w-]+)\[([^\]\r\n]*)\](?:[ \t]*@\{[^\r\n]*\})?[ \t]*$/dgm
      : /^([ \t]*)(?:[\w-]+)?(\(\(|\(|\[\[|\[|\{|\)\))([^\r\n]*?)(?:\)\)|\)|\]\]|\]|\}|\(\()[ \t]*$|^([ \t]*)([^\s%()[\]{}][^\r\n]*)$/dgm;
    for (const m of matches(pattern)) {
      if (m[0].trimStart().startsWith('::')) continue;
      const labelGroup = kind === 'kanban' ? 3 : m[3] !== undefined ? 3 : 5;
      const indent = kind === 'kanban' || m[3] !== undefined ? m[1] : m[4];
      const span = m.indices![labelGroup]!;
      const from = offset + m.index!, to = from + m[0].length;
      rows.push({ name: kind === 'mindmap' ? 'Idea' : 'Columna o tarjeta', from, to,
        fields: [{ label: 'Texto', from: offset + span[0], to: offset + span[1], value: m[labelGroup], forbidden: '[](){}' }],
        removable: false,
        child: { at: to, source: `${indent}  ${kind === 'kanban' ? `${id}[Nueva tarjeta]` : 'Nueva idea'}` },
      });
    }
    const rootIndent = rows.length ? code.slice(rows[0].from, rows[0].to).match(/^[ \t]*/)![0].length : 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const indent = code.slice(row.from, row.to).match(/^[ \t]*/)![0].length;
      const next = rows.slice(i + 1).find(r => code.slice(r.from, r.to).match(/^[ \t]*/)![0].length <= indent);
      row.child!.at = next?.from ?? code.length;
      // No se elimina una rama entera por accidente: solo hojas, y nunca la raíz del mapa.
      row.removable = (kind === 'kanban' || indent > rootIndent) && (rows[i + 1]?.from === next?.from || i === rows.length - 1);
      if (kind === 'kanban' && indent > rootIndent) row.child = undefined;
    }
    add(kind === 'kanban' ? 'Añadir columna' : 'Añadir rama',
      `${' '.repeat(rootIndent + (kind === 'mindmap' && rows.length ? 2 : 0))}${kind === 'kanban' ? `${id}[Nueva columna]` : rows.length ? 'Nueva idea' : 'root((Proyecto))'}\n`);
  } else if (kind === 'C4Context') {
    collect(/^[ \t]*(?:Person(?:_Ext)?|System(?:_Ext|Db|Queue)?|Container(?:Db|Queue)?|Component(?:Db|Queue)?)\([ \t]*[\w-]+[ \t]*,[ \t]*"([^"\r\n]*)"(?:[ \t]*,[ \t]*"([^"\r\n]*)")?(?:[ \t]*,[ \t]*"([^"\r\n]*)")?[^\r\n]*\)[ \t]*$/dgm,
      'Persona o sistema', [text('Nombre', '"'), text('Descripción o tecnología', '"'), text('Descripción', '"')]);
    collect(/^[ \t]*(?:Rel(?:_[A-Za-z]+)?|BiRel)\([ \t]*([\w-]+)[ \t]*,[ \t]*([\w-]+)[ \t]*,[ \t]*"([^"\r\n]*)"[^\r\n]*\)[ \t]*$/dgm,
      'Relación', [text('Origen', ',() '), text('Destino', ',() '), text('Etiqueta', '"')]);
    add('Añadir persona', `  Person(${id}, "Nueva persona", "Descripción")\n`);
    add('Añadir sistema', `  System(${id}, "Nuevo sistema", "Descripción")\n`);
    const ids = [...matches(/^[ \t]*(?:Person\w*|System\w*|Container\w*|Component\w*)\([ \t]*([\w-]+)/gm)].map(m => m[1]);
    for (const row of rows) {
      if (row.name === 'Persona o sistema') { row.id = code.slice(row.from, row.to).match(/\(\s*([\w-]+)/)![1]; row.name += `: ${row.id}`; }
      if (row.name === 'Relación') for (const field of row.fields.slice(0, 2)) field.choices = ids.map(id => [id, id]);
    }
    if (ids.length > 1) add('Añadir relación', `  Rel(${ids[0]}, ${ids[1]}, "Nueva relación")\n`);
  } else if (kind === 'requirementDiagram') {
    for (const block of matches(/^[ \t]*(?:\w*Requirement|requirement|element)[ \t]+([\w-]+)[ \t]*\{[^{}]*\}/gm)) {
      const from = offset + block.index!;
      const fields: DiagramField[] = [];
      for (const m of block[0].matchAll(/^[ \t]*(id|text|risk|verifymethod|type|docref)[ \t]*:[ \t]*("[^"\r\n]*"|[^\r\n]+)[ \t]*\r?$/dgm)) {
        const span = m.indices![2]!;
        const value = m[2].trimEnd();
        const quoted = value.startsWith('"') && value.endsWith('"');
        const label = { id: 'Identificador', text: 'Descripción', risk: 'Riesgo', verifymethod: 'Verificación', type: 'Tipo', docref: 'Documento' }[m[1]]!;
        fields.push({ label, from: from + span[0] + Number(quoted), to: from + span[0] + value.length - Number(quoted),
          value: quoted ? value.slice(1, -1) : value, forbidden: '"{}',
          choices: m[1] === 'risk' ? [['low', 'Bajo'], ['medium', 'Medio'], ['high', 'Alto']]
            : m[1] === 'verifymethod' ? [['test', 'Prueba'], ['analysis', 'Análisis'], ['inspection', 'Inspección'], ['demonstration', 'Demostración']] : undefined });
      }
      rows.push({ name: `Elemento: ${block[1]}`, id: block[1], from, to: from + block[0].length, fields, removable: true });
    }
    collect(/^[ \t]*([\w-]+)[ \t]*-[ \t]*(contains|copies|derives|satisfies|verifies|refines|traces)[ \t]*->[ \t]*([\w-]+)[ \t]*$/dgm,
      'Relación', [text('Origen', ' -'), { label: 'Relación', choices: [['contains', 'Contiene'], ['copies', 'Copia'], ['derives', 'Deriva'], ['satisfies', 'Satisface'], ['verifies', 'Verifica'], ['refines', 'Refina'], ['traces', 'Traza']] }, text('Destino', ' -')]);
    collect(/^[ \t]*([\w-]+)[ \t]*<-[ \t]*(contains|copies|derives|satisfies|verifies|refines|traces)[ \t]*-[ \t]*([\w-]+)[ \t]*$/dgm,
      'Relación', [text('Destino', ' -'), { label: 'Relación', choices: [['contains', 'Contiene'], ['copies', 'Copia'], ['derives', 'Deriva'], ['satisfies', 'Satisface'], ['verifies', 'Verifica'], ['refines', 'Refina'], ['traces', 'Traza']] }, text('Origen', ' -')]);
    add('Añadir requisito', `  requirement ${id} {\n    id: ${id}\n    text: Nuevo requisito\n    risk: low\n    verifymethod: test\n  }\n`);
    add('Añadir elemento', `  element ${id} {\n    type: Aplicación\n  }\n`);
    const ids = [...matches(/^[ \t]*(?:\w*Requirement|requirement|element)[ \t]+([\w-]+)[ \t]*\{/gm)].map(m => m[1]);
    for (const row of rows.filter(r => r.name === 'Relación'))
      for (const field of [row.fields[0], row.fields[2]]) field.choices = ids.map(id => [id, id]);
    if (ids.length > 1) add('Añadir relación', `  ${ids[1]} - satisfies -> ${ids[0]}\n`);
  } else if (kind === 'quadrantChart') {
    collect(/^[ \t]*[xy]-axis[ \t]+(.+?)[ \t]*-->[ \t]*([^\r\n]+)$/dgm, 'Eje', ['Extremo inferior', 'Extremo superior'], false);
    collect(/^[ \t]*quadrant-[1-4][ \t]+([^\r\n]+)$/dgm, 'Cuadrante', ['Nombre de cuadrante'], false);
    collect(/^[ \t]*([^:\r\n]+?)[ \t]*:[ \t]*\[([\d.]+)[ \t]*,[ \t]*([\d.]+)\][ \t]*$/dgm,
      'Punto', [text('Etiqueta', ':[]'), num('Coordenada X', 1), num('Coordenada Y', 1)]);
    add('Añadir punto', '  Nuevo punto: [0.5, 0.5]\n');
  } else if (kind === 'sankey-beta') {
    // shortcut: CSV con comas dentro de etiquetas se edita en código; no se separa ni reescribe aquí.
    collect(/^([^,"\r\n]+),([^,"\r\n]+),(\d+(?:\.\d+)?)[ \t]*$/dgm,
      'Flujo', [text('Origen', ',"'), text('Destino', ',"'), num('Cantidad')]);
    add('Añadir flujo', 'Nuevo origen,Nuevo destino,10\n');
  }
  rows.sort((a, b) => a.from - b.from);
  addMovement(code, kind, rows);
  return { kind, label: FORM_KINDS[kind], rows, additions, eol };
}

/** Sustituye solo los campos editados; Gantt comparte un fragmento entre sus controles. */
export function updateDiagramFields(code: string, fields: DiagramField[], values: string[]): string {
  if (fields.length !== values.length) throw new Error('Faltan campos del formulario.');
  const edits: { from: number; to: number; value: string }[] = [];
  const tasks = new Map<GanttTask, GanttValues>();
  for (const [i, field] of fields.entries()) {
    const value = values[i];
    const source = field.gantt?.task;
    if (code.slice(field.from, field.to) !== (source?.source ?? field.value)) throw new Error('La fuente ha cambiado. Revisa el formulario antes de aplicar.');
    if (value === field.value) continue;
    if ((!value.trim() && !field.optional) || /[\r\n]/.test(value) || [...(field.forbidden ?? '')].some(c => value.includes(c)))
      throw new Error(`«${field.label}»: introduce un texto sin saltos de línea ni delimitadores de Mermaid.`);
    if (field.type === 'number' && (!Number.isFinite(Number(value)) || Number(value) < (field.min ?? 0) || Number(value) > (field.max ?? Infinity)))
      throw new Error(`«${field.label}»: introduce un número entre ${field.min ?? 0} y ${field.max ?? 'el máximo permitido'}.`);
    const selected = field.multiple ? value.split(' ').filter(Boolean) : [value];
    if (field.choices && selected.some(v => !field.choices!.some(([choice]) => choice === v)))
      throw new Error(`«${field.label}»: selecciona una opción de la lista.`);
    if (source) {
      const next = tasks.get(source) ?? { ...source.values };
      next[field.gantt!.part] = value;
      tasks.set(source, next);
    } else edits.push({ from: field.from, to: field.to, value });
  }
  for (const [task, values] of tasks) {
    if (!values.dependencies && !/^\d{4}-\d{2}-\d{2}$/.test(values.start)) throw new Error('Introduce una fecha de inicio o selecciona una dependencia.');
    if (!/^(?:\d{4}-\d{2}-\d{2}|\d+(?:ms|[smhdw])|until\s+[\w-]+)$/.test(values.end)) throw new Error('Introduce una fecha final o duración válida, por ejemplo 7d.');
    if (!values.dependencies && /^\d{4}-\d{2}-\d{2}$/.test(values.end) && values.end < values.start) throw new Error('La fecha final no puede ser anterior al inicio.');
    const tags = task.tags.filter(t => !['active', 'done', 'crit', 'milestone'].includes(t));
    tags.push(...[values.state, values.critical, values.milestone].filter(Boolean));
    const tokens = [...tags, ...(task.id ? [task.id] : []), values.dependencies ? `after ${values.dependencies}` : values.start, values.end];
    edits.push({ from: task.from, to: task.to, value: (task.source.match(/^\s*/)?.[0] ?? '') + tokens.join(', ') + (task.source.match(/\s*$/)?.[0] ?? '') });
  }
  for (const edit of edits.sort((a, b) => b.from - a.from)) code = code.slice(0, edit.from) + edit.value + code.slice(edit.to);
  validateDiagramForm(code);
  return code;
}

export function validateDiagramForm(code: string): void {
  const model = diagramForm(code);
  if (model?.kind === 'pie') {
    const names = model.rows.filter(r => r.name === 'Sector').map(r => r.fields[0].value.trim());
    if (new Set(names).size !== names.length) throw new Error('Cada sector debe tener una etiqueta diferente para que todas las cantidades aparezcan en el gráfico.');
  }
  if (model?.kind === 'gantt') {
    const graph = new Map(model.rows.filter(r => r.name === 'Tarea' && r.id).map(r => [r.id!, r.fields.find(f => f.gantt?.part === 'dependencies')!.value.split(' ').filter(Boolean)]));
    const ids = new Set([...graph.keys(), ...[...code.matchAll(/^[ \t]*(?!%%)[^:\r\n]+:[ \t]*(?:(?:active|done|crit|milestone|vert)[ \t]*,[ \t]*)*([\w-]+)[ \t]*,/gm)].map(m => m[1])]);
    const active = new Set<string>(), done = new Set<string>();
    const visit = (id: string) => {
      if (active.has(id)) throw new Error('Las dependencias de las tareas no pueden formar un ciclo.');
      if (done.has(id)) return;
      active.add(id);
      for (const dep of graph.get(id) ?? []) {
        if (!ids.has(dep)) throw new Error(`La tarea dependiente «${dep}» no existe. Revisa sus dependencias.`);
        visit(dep);
      }
      active.delete(id); done.add(id);
    };
    for (const id of graph.keys()) visit(id);
  }
}

function lineEnd(code: string, to: number): number {
  return code[to] === '\n' ? to + 1 : to;
}

function addMovement(code: string, kind: FormKind, rows: DiagramRow[]) {
  const tree = kind === 'mindmap' || kind === 'kanban';
  const sections = kind === 'gantt' || kind === 'timeline';
  if (!tree && !sections) return;
  const movable = rows.filter(r => tree || ['Sección', 'Tarea', 'Hito'].includes(r.name));
  const indentOf = (r: DiagramRow) => code.slice(r.from, r.to).match(/^[ \t]*/)![0];
  const sectionRows = movable.filter(r => r.name === 'Sección');
  for (const [i, row] of movable.entries()) {
    const indent = indentOf(row);
    const parent = tree ? movable.slice(0, i).reverse().find(r => indentOf(r).length < indent.length)
      : row.name === 'Sección' ? undefined : sectionRows.filter(r => r.from < row.from).at(-1);
    const next = movable.slice(i + 1).find(r => tree ? indentOf(r).length <= indent.length : row.name !== 'Sección' || r.name === 'Sección');
    row.move = { parent: parent?.from ?? null, end: next?.from ?? code.length, indent, group: tree ? 'tree' : row.name === 'Sección' ? 'section' : 'item', targets: [] };
  }
  for (const row of movable) {
    if (tree && kind === 'mindmap' && row === movable[0]) continue;
    const candidates = tree ? movable.filter(r => !(r.from >= row.from && r.from < row.move!.end) && (kind !== 'kanban' || r.move!.parent === null))
      : sectionRows;
    row.move!.targets = candidates.map(r => ({ from: r.from, label: r.fields[0].value }));
    if (kind === 'kanban' && row.move!.parent === null || sections) row.move!.targets.unshift({ from: null, label: sections ? 'Sin sección' : 'Columnas' });
    if (kind === 'kanban' && row.move!.parent === null || row.name === 'Sección') row.move!.targets = [{ from: null, label: row.name === 'Sección' ? 'Secciones' : 'Columnas' }];
  }
}

/** Mueve el fragmento completo, incluidos sus hijos y metadatos; nunca regenera el diagrama. */
export function moveDiagramRow(code: string, from: number, parent: number | null, before?: number): string {
  const model = diagramForm(code);
  const row = model?.rows.find(r => r.from === from);
  if (!row?.move || !row.move.targets.some(t => t.from === parent)) throw new Error('Ese destino no está permitido para este elemento.');
  const destination = parent === null ? undefined : model!.rows.find(r => r.from === parent);
  if (destination && destination.from >= row.from && destination.from < row.move.end) throw new Error('No se puede mover una rama dentro de sí misma.');
  const sibling = before === undefined ? undefined : model!.rows.find(r => r.from === before && r.move?.parent === parent && r.move.group === row.move!.group);
  if (before !== undefined && (!sibling || sibling === row)) throw new Error('La posición de destino ya no existe.');
  const tree = model!.kind === 'mindmap' || model!.kind === 'kanban';
  const indent = tree ? destination ? destination.move!.indent + '  ' : model!.rows.find(r => r.move?.parent === null)?.move?.indent ?? row.move.indent : row.move.indent;
  let fragment = code.slice(row.from, row.move.end);
  if (tree && indent !== row.move.indent) fragment = fragment.replace(/^[ \t]*(?=\S)/gm, whitespace => whitespace.startsWith(row.move!.indent) ? indent + whitespace.slice(row.move!.indent.length) : whitespace);
  const firstSection = model!.rows.find(r => r.name === 'Sección');
  const at = sibling?.from ?? destination?.move?.end ?? (row.name !== 'Sección' && (model!.kind === 'gantt' || model!.kind === 'timeline') ? firstSection?.from ?? code.length : code.length);
  const removed = code.slice(0, row.from) + code.slice(row.move.end);
  const adjusted = at > row.from ? at - (row.move.end - row.from) : at;
  const eol = model!.eol;
  if (fragment && !fragment.endsWith('\n') && adjusted < removed.length) fragment += eol;
  const next = insertDiagramSource(removed, adjusted, fragment);
  validateDiagramForm(next);
  return next;
}

export function removeDiagramRow(code: string, from: number): string {
  const model = diagramForm(code);
  const row = model?.rows.find(r => r.from === from);
  if (!row?.removable) throw new Error('No se puede eliminar este elemento mientras contenga otros elementos.');
  if (model!.kind === 'sankey-beta' && model!.rows.length === 1) throw new Error('Sankey necesita al menos un flujo. Añade otro antes de eliminar este.');
  const removed = [row];
  if (row.id && (model!.kind === 'C4Context' || model!.kind === 'requirementDiagram'))
    removed.push(...model!.rows.filter(r => r.name === 'Relación' && r.fields.some(f => ['Origen', 'Destino'].includes(f.label) && f.value === row.id)));
  let next = code;
  for (const item of removed.sort((a, b) => b.from - a.from)) next = next.slice(0, item.from) + next.slice(lineEnd(code, item.to));
  validateDiagramForm(next);
  return next;
}

export function insertDiagramSource(code: string, at: number, source: string): string {
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  return code.slice(0, at) + (at && code[at - 1] !== '\n' ? eol : '') + source + (source.endsWith('\n') ? '' : eol) + code.slice(at);
}
