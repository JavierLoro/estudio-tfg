import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../components/ui';
import { renderDiagram } from '../lib/diagram';
import type { DiagramFormDraft } from '../state/docs';
import { diagramFieldKey, diagramForm, insertDiagramSource, moveDiagramRow, removeDiagramRow, updateDiagramFields, validateDiagramForm, type DiagramField, type DiagramRow } from '../lib/diagramForm';

const input = 'h-8 w-full rounded border border-line-strong bg-bg px-2 text-[12px] text-fg outline-none focus:border-accent';

export default function DiagramForm({ code, seed, formDraft, onChange, onDraftChange }: {
  code: string; seed: string; formDraft: DiagramFormDraft | null;
  onChange: (code: string) => void; onDraftChange: (draft: DiagramFormDraft | null) => void;
}) {
  const draft = formDraft ?? { code, values: {} };
  const setDraft = (next: DiagramFormDraft) => {
    const changed = diagramForm(next.code)?.rows.flatMap(row => row.fields)
      .some(field => (next.values[diagramFieldKey(field)] ?? field.value) !== field.value);
    onDraftChange(changed ? next : null);
  };
  const formId = useId();
  const previous = diagramForm(draft.code);
  const pending = previous?.rows.flatMap(r => r.fields).some(f => (draft.values[diagramFieldKey(f)] ?? f.value) !== f.value) ?? false;
  const model = pending ? previous : diagramForm(code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const latest = useRef(code);
  latest.current = code;
  const mounted = useRef(true);
  const host = useRef<HTMLElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setError(''); }, [code]);
  if (!model) return null;

  const fields = model.rows.flatMap(row => row.fields);
  const valueOf = (field: DiagramField) => draft.values[diagramFieldKey(field)] ?? field.value;
  const changed = fields.some(f => valueOf(f) !== f.value);
  const stale = pending && draft.code !== code;
  const setValue = (field: DiagramField, value: string) => {
    const values = { ...draft.values, [diagramFieldKey(field)]: value };
    if (field.gantt && value && ['start', 'dependencies'].includes(field.gantt.part)) {
      const other = fields.find(f => f.gantt?.task === field.gantt!.task && f.gantt?.part === (field.gantt!.part === 'start' ? 'dependencies' : 'start'));
      if (other) values[diagramFieldKey(other)] = '';
    }
    setDraft({ code: pending ? draft.code : code, values });
  };
  const apply = async (make: () => string) => {
    if (busy) return;
    const active = document.activeElement as HTMLElement | null;
    const controls = [...host.current!.querySelectorAll<HTMLElement>('input, select, button')];
    const focusIndex = active ? controls.indexOf(active) : -1;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = make();
      validateDiagramForm(next);
      // shortcut: el analizador CSV de Mermaid solo acepta ASCII; retirar cuando Mermaid admita Unicode en Sankey.
      if (model.kind === 'sankey-beta' && /[^\x20-\x7e\r\n]/.test(next))
        throw new Error('Mermaid solo admite caracteres ASCII en Sankey. Usa etiquetas sin tildes ni eñes; la fuente anterior se conserva.');
      const result = await renderDiagram(next, seed);
      if (!mounted.current) return;
      if (latest.current !== code) throw new Error('La fuente cambió durante la validación. Revisa los campos y vuelve a aplicar.');
      if (!result.ok) throw new Error(`No se ha aplicado el cambio. Revisa los campos: ${result.message}`);
      onChange(next);
      setDraft({ code: next, values: {} });
      setMessage('Diagrama actualizado. Guarda para conservar los cambios en disco.');
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally {
      if (mounted.current) setBusy(false);
      // El botón Aplicar queda deshabilitado al terminar; recuperar un campo evita perder el foco.
      requestAnimationFrame(() => {
        const nextControls = host.current?.querySelectorAll<HTMLElement>('input, select, button');
        const target = nextControls?.[Math.max(0, Math.min(focusIndex, nextControls.length - 1))];
        if (active?.isConnected && !active.matches(':disabled')) active.focus();
        else if (target && !target.matches(':disabled')) target.focus();
        else host.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)')?.focus();
      });
    }
  };
  return <section ref={host} aria-label={`Formulario de ${model.label}`}
    className="flex h-full min-h-0 w-full max-w-full shrink-0 flex-col border-r border-line bg-bg text-fg">
    <div className="shrink-0 border-b border-line p-2">
      <h3 className="text-[13px] font-medium">{model.label}</h3>
      <p className="mt-1 text-[11px] text-muted">Edita los campos con Tab e Intro. Usa Código para las opciones avanzadas o la sintaxis que no aparezca aquí.</p>
      {model.kind === 'sankey-beta' && <p className="mt-1 text-[11px] text-muted">Sankey: etiquetas sin tildes ni eñes por una limitación de Mermaid.</p>}
    </div>
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={e => {
      e.preventDefault();
      if (!stale) void apply(() => updateDiagramFields(code, fields, fields.map(valueOf)));
    }}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line p-2">
        <Button type="submit" variant="primary" disabled={!changed || busy || stale}>Aplicar cambios</Button>
        {changed && <Button disabled={busy} onClick={() => setDraft({ code, values: {} })}>Descartar campos</Button>}
        <span role="status" className="text-[11px] text-muted">{busy ? 'Validando el diagrama…' : changed ? 'Hay campos sin aplicar.' : message}</span>
      </div>
      <fieldset disabled={busy} className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        <legend className="sr-only">Campos del diagrama</legend>
        {error && <p role="alert" className="text-[12px] break-words whitespace-pre-wrap text-danger">{error}</p>}
        {stale && <p role="alert" className="text-[12px] text-danger">La fuente cambió mientras había campos pendientes. Conservamos tus campos para que puedas copiarlos; descártalos para cargar la fuente nueva.</p>}
        {model.rows.map(row => <fieldset key={row.from} className="flex min-w-0 shrink-0 flex-col gap-2 rounded-md border border-line p-2">
          <legend className="max-w-full truncate px-1 text-[12px] font-medium">{['Tarea', 'Hito', 'Idea', 'Columna o tarjeta', 'Sector', 'Punto', 'Flujo'].includes(row.name) ? `${row.name}: ${row.fields[0]?.value ?? ''}` : row.name}</legend>
          {row.fields.map(field => <div key={diagramFieldKey(field)} className="flex flex-col gap-1 text-[11px] text-muted">
            <label htmlFor={`${formId}-${diagramFieldKey(field)}`}>{field.label}</label>
            {field.choices ? <select id={`${formId}-${diagramFieldKey(field)}`} className={field.multiple ? input + ' h-24' : input}
              multiple={field.multiple} value={field.multiple ? valueOf(field).split(' ').filter(Boolean) : valueOf(field)}
              aria-describedby={field.multiple ? `${formId}-${diagramFieldKey(field)}-help` : undefined}
              onChange={e => setValue(field, field.multiple ? [...e.target.selectedOptions].map(o => o.value).join(' ') : e.target.value)}>
              {!field.multiple && !field.choices.some(([v]) => v === field.value) && <option value={field.value}>{field.value}</option>}
              {field.multiple && field.value.split(' ').filter(v => v && !field.choices!.some(([choice]) => choice === v)).map(v => <option key={v} value={v}>{v}</option>)}
              {field.choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select> : <input id={`${formId}-${diagramFieldKey(field)}`} className={input} type={field.type ?? 'text'} value={valueOf(field)} required={!field.optional}
              aria-describedby={field.label === 'Fin o duración' ? `${formId}-${diagramFieldKey(field)}-help` : undefined}
              min={field.min} max={field.max} step={field.type === 'number' ? 'any' : undefined}
              onChange={e => setValue(field, e.target.value)} />}
            {field.label === 'Fin o duración' && <span id={`${formId}-${diagramFieldKey(field)}-help`}>Fecha AAAA-MM-DD o duración, por ejemplo 7d; para un hito, 0d.</span>}
            {field.multiple && <span id={`${formId}-${diagramFieldKey(field)}-help`}>Selecciona las tareas previas con Ctrl o ⌘. Sin selección se usa la fecha de inicio.</span>}
          </div>)}
          <div className="flex flex-wrap gap-1.5">
            {row.child && <Button disabled={busy || changed}
              onClick={() => void apply(() => insertDiagramSource(code, row.child!.at, row.child!.source))}>Añadir hijo</Button>}
            {row.removable && <Button variant="danger" disabled={busy || changed}
              onClick={() => void apply(() => removeDiagramRow(code, row.from))}>Eliminar</Button>}
          </div>
          {row.id && ['C4Context', 'requirementDiagram'].includes(model.kind) && <p className="text-[11px] text-muted">Al eliminarlo también se quitan sus relaciones.</p>}
          {row.move && row.move.targets.length > 0 && <RowMovement row={row} rows={model.rows} disabled={busy || changed}
            onMove={(parent, before) => void apply(() => moveDiagramRow(code, row.from, parent, before))} />}
        </fieldset>)}
        {!model.rows.length && <p className="text-[12px] text-muted">No hay campos reconocidos. Puedes añadir un elemento o editar el código.</p>}
        <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-line pt-2">
          {model.additions.map(a => <Button key={a.label} disabled={busy || changed}
            onClick={() => void apply(() => insertDiagramSource(code, code.length, a.source))}>{a.label}</Button>)}
        </div>
      </fieldset>
    </form>
  </section>;
}

function RowMovement({ row, rows, disabled, onMove }: {
  row: DiagramRow; rows: DiagramRow[]; disabled: boolean; onMove: (parent: number | null, before?: number) => void;
}) {
  const movement = row.move!;
  const [target, setTarget] = useState(String(movement.parent));
  const id = useId();
  useEffect(() => setTarget(String(movement.parent)), [movement.parent, row.fields[0]?.value]);
  const siblings = rows.filter(r => r.move?.parent === movement.parent && r.move.group === movement.group && r.move.targets.length > 0);
  const i = siblings.indexOf(row);
  return <div className="flex flex-col gap-1.5 border-t border-line pt-2">
    <div className="flex gap-1.5">
      <Button disabled={disabled || i <= 0} onClick={() => onMove(movement.parent, siblings[i - 1].from)}>Subir</Button>
      <Button disabled={disabled || i < 0 || i === siblings.length - 1}
        onClick={() => onMove(movement.parent, siblings[i + 2]?.from)}>Bajar</Button>
    </div>
    {movement.targets.some(t => t.from !== movement.parent) && <>
      <label htmlFor={id} className="text-[11px] text-muted">Mover a</label>
      <select id={id} className={input} value={target} disabled={disabled} onChange={e => setTarget(e.target.value)}>
        {movement.targets.map(t => <option key={String(t.from)} value={String(t.from)}>{t.label}</option>)}
      </select>
      <Button disabled={disabled || target === String(movement.parent)} onClick={() => onMove(target === 'null' ? null : Number(target))}>Mover</Button>
    </>}
  </div>;
}
