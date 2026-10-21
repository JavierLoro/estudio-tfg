import { useEffect, useState } from 'react';
import { CONTEXT_FIELDS, CONTEXT_LABELS, type ContextProfile, type ContextSelection } from '../../../shared/assistant';
import { api, errorMessage } from '../api';
import { assistantRequest, useAssistant } from '../state/assistant';
import { changeProjectContext, contextBody, noteIncluded, noteSelection, refreshProjectContext, useProjectContext } from '../state/projectContext';
import { useDocs, isDirty } from '../state/docs';
import { useDesktop } from '../state/desktop';
import { useUI } from '../state/ui';
import { Button, Banner } from './ui';
import { AssistantDiff } from './AssistantDiff';

const input = 'block w-full rounded border border-line bg-bg p-2 text-[13px]';
export const dirtyContextDocs = () => Object.values(useDocs.getState().docs).filter(d => isDirty(d) || d.conflict || d.saving).map(d => d.key);
export function useContextView() {
  const desktop = useDesktop(s => !!s.info), instance = useUI(s => s.status?.instanceId), account = useAssistant(s => s.account?.active);
  const value = useProjectContext(s => s.value);
  useEffect(() => {
    if (desktop) void refreshProjectContext().catch(e => useProjectContext.setState({ error: errorMessage(e) }));
  }, [desktop, instance, account]);
  return value;
}
export function ContextForAction({ onChange }: { onChange: (version: string | undefined) => void }) {
  const value = useProjectContext(s => s.value), [include, setInclude] = useState(false);
  useEffect(() => { onChange(include && value?.effective ? value.effective.version : undefined); }, [include, value?.effective?.version, onChange]);
  useEffect(() => { setInclude(false); }, [value?.project, value?.account]);
  return <div className="rounded border border-line p-2 text-[12px]">
    <label className="flex gap-2"><input type="checkbox" checked={include && !!value?.effective} disabled={!value?.effective} onChange={e => setInclude(e.target.checked)} />Usar contexto del TFG en esta acción</label>
    {value?.effective ? <details className="mt-1"><summary className="cursor-pointer">Contexto efectivo antes de enviar · {value.effective.version}</summary><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words p-2">{value.effective.text || 'Ficha y fragmentos vacíos.'}</pre><p>Solo se incluye al marcar la casilla. No concede acceso a los originales ni permiso de adjuntos o escritura.</p></details> : <p className="mt-1 text-muted">Desactivado o sin permiso de uso. Configúralo en Ajustes → Asistente.</p>}
  </div>;
}
export function NoteContextCheckbox({ path }: { path: string }) {
  const [pendingChecked, setPendingChecked] = useState<boolean | null>(null);
  const desktop = useDesktop(s => !!s.info), value = useContextView(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (!desktop || !value) return null;
  return <div className="text-[11px]"><label className="flex items-center gap-1"><input type="checkbox" disabled={busy} checked={pendingChecked ?? noteIncluded(value.selection, { root: 'notes', path })} onChange={async e => {
    const checked = e.target.checked; setPendingChecked(checked); setBusy(true); setError('');
    try { const all = value.selection.mode === 'all'; await changeProjectContext({ selection: noteSelection(value.selection, { root: 'notes', path }, checked) }, value); if (all && !checked) useUI.getState().toast({ kind: 'info', text: 'Contexto cambiado a Selección parcial; esta nota queda excluida.' }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); setPendingChecked(null); }
  }} />Incluir en el contexto del TFG</label>{value.selection.mode === 'off' && <span className="text-faint">Selección conservada; contexto desactivado.</span>}{error && <p role="alert" className="text-danger">{error}<Button onClick={() => void refreshProjectContext()}>Revisar versión actual</Button></p>}</div>;
}
export function ContextSettings() {
  const value = useContextView(), [draft, setDraft] = useState<{ profile: ContextProfile; selection: ContextSelection; rev: string; project: string; saved: string } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [title, setTitle] = useState('');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]), [model, setModel] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const makeDraft = (v: NonNullable<typeof value>) => ({ profile: v.profile, selection: v.selection, rev: v.rev, project: v.project, saved: JSON.stringify([v.profile, v.selection]) });
  useEffect(() => {
    if (!value || value.rev === draft?.rev) return;
    if (!draft || draft.project !== value.project || JSON.stringify([draft.profile, draft.selection]) === draft.saved) setDraft(makeDraft(value));
    else if (JSON.stringify([value.profile, value.selection]) === draft.saved) setDraft({ ...draft, rev: value.rev });
  }, [value, draft]);
  useEffect(() => { let live = true; void api.datos().then(d => { if (live) setTitle(d.datos.titulo ?? ''); }).catch(() => {}); return () => { live = false; }; }, [value?.project]);
  useEffect(() => {
    setModel(''); setModels([]); if (!value?.account) return;
    let live = true; void assistantRequest<{ models: { id: string; name: string }[] }>('/models').then(r => { if (live) setModels(r.models); }).catch(e => { if (live) setError(errorMessage(e)); }); return () => { live = false; };
  }, [value?.account, value?.project]);
  const running = value?.proposals.some(p => p.state === 'running');
  useEffect(() => { if (!running) return; const timer = setInterval(() => void refreshProjectContext().catch(e => setError(errorMessage(e))), 800); return () => clearInterval(timer); }, [running]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await refreshProjectContext(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  if (!value || !draft) return <section aria-label="Contexto del TFG"><h2>Contexto del TFG</h2><p>{useProjectContext.getState().error || 'Cargando contexto…'}</p></section>;
  const paths = (field: 'folders' | 'files' | 'excluded', root: 'notes' | 'memoria') => <label className="block" key={field + root}>{root === 'notes' ? 'Notas' : 'Memoria'} · {field === 'folders' ? 'Carpetas' : field === 'files' ? 'Archivos' : 'Exclusiones'} (una ruta relativa por línea)
    <textarea className={input} rows={2} value={draft.selection[field].filter(p => p.root === root).map(p => p.path).join('\n')} onChange={e => setDraft({ ...draft, selection: { ...draft.selection, [field]: [...draft.selection[field].filter(p => p.root !== root), ...e.target.value.split('\n').filter(Boolean).map(path => ({ root, path }))] } })} /></label>;
  return <section aria-label="Contexto del TFG" className="space-y-3 rounded-lg border border-line bg-bg p-3 text-[13px]">
    <h2 className="font-semibold">Contexto del TFG</h2>
    {title && <p className="text-muted">Título de Datos del trabajo: {title}. Se edita en Memoria → Datos del trabajo.</p>}
    <p>La ficha y selección pertenecen al proyecto; los permisos se conceden por cuenta y proyecto. Las notas conservan su Markdown y frontmatter. Solo se usan archivos guardados; no se hacen llamadas automáticas a IA.</p>
    {value.changed.files > 0 && <Banner kind={value.changed.warn ? 'warn' : 'info'}>{value.changed.files} archivo(s), aproximadamente {value.changed.words} palabras modificadas desde la revisión. Sus derivados quedan fuera del contexto efectivo hasta revisarlos.</Banner>}
    <p>{value.pending} fragmento(s) pendiente(s) · {value.fragments.filter(f => f.valid).length} revisado(s) vigente(s).</p>
    {value.warnings.map(w => <p key={w} className="text-warn">{w}</p>)}
    {CONTEXT_FIELDS.map(k => <label key={k} className="block">{CONTEXT_LABELS[k]}<textarea aria-label={CONTEXT_LABELS[k]} className={input} maxLength={4000} rows={2} value={draft.profile[k]} onChange={e => setDraft({ ...draft, profile: { ...draft.profile, [k]: e.target.value } })} /></label>)}
    <label className="block">Modo del contexto<select aria-label="Modo del contexto" className={input} value={draft.selection.mode} onChange={e => setDraft({ ...draft, selection: { ...draft.selection, mode: e.target.value as ContextSelection['mode'] } })}><option value="off">Desactivado</option><option value="all">Todo el proyecto</option><option value="partial">Selección parcial</option></select></label>
    {draft.selection.mode === 'all' && <p>Incluye los documentos compatibles de las raíces configuradas, también los que se creen después. Las exclusiones prevalecen.</p>}
    {draft.selection.mode === 'off' && <p>Conserva la selección y los fragmentos sin generar ni compartir contexto.</p>}
    <fieldset className="space-y-2"><legend>Ámbitos completos de la selección parcial</legend>{(['notes', 'memoria', 'library', 'diagrams'] as const).map((s, i) => <label key={s} className="mr-3 inline-flex gap-1"><input type="checkbox" checked={draft.selection.scopes.includes(s)} onChange={e => setDraft({ ...draft, selection: { ...draft.selection, scopes: e.target.checked ? [...draft.selection.scopes, s] : draft.selection.scopes.filter(v => v !== s) } })} />{['Notas', 'Memoria', 'Biblioteca/bibliografía', 'Diagramas'][i]}</label>)}</fieldset>
    <details><summary className="cursor-pointer">Carpetas, archivos concretos y exclusiones</summary><div className="mt-2 space-y-2">{(['folders', 'files', 'excluded'] as const).flatMap(f => (['notes', 'memoria'] as const).map(root => paths(f, root)))}</div></details>
    <Button disabled={busy} variant="primary" onClick={() => void act(async () => { const result = await changeProjectContext({ profile: draft.profile, selection: draft.selection }, { ...value, rev: draft.rev, project: draft.project }); setDraft(makeDraft(result)); })}>Guardar ficha y selección</Button>
    {draft.rev !== value.rev && <Banner kind="warn">Hay una versión nueva. Tu formulario se conserva. <Button onClick={() => setDraft(makeDraft(value))}>Cargar versión actual</Button></Banner>}
    <fieldset disabled={busy || !value.account} className="space-y-2"><legend>Permisos de esta cuenta para este proyecto</legend>{(['prepareContext', 'useContext', 'prepareDiagrams'] as const).map((k, i) => <label key={k} className="flex gap-2"><input type="checkbox" checked={value.grants[k]} onChange={e => void act(() => changeProjectContext({ grants: { ...value.grants, [k]: e.target.checked } }))} />{['Elaborar propuestas desde las fuentes seleccionadas', 'Usar el contexto revisado en acciones elegidas', 'Preparar diagramas nuevos con el asistente'][i]}</label>)}</fieldset>
    <p className="text-muted">Estos permisos no conceden lectura directa de originales, adjuntos ni modificación de textos al chat. Al conectar otra cuenta empiezan desactivados.</p>
    <select aria-label="Modelo para contexto" className={input} value={model} onChange={e => setModel(e.target.value)}><option value="">Elegir modelo de la cuenta…</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || running || !model || !value.grants.prepareContext || value.selection.mode === 'off'} onClick={() => void act(() => assistantRequest('/context/prepare', { ...contextBody(value), model, dirty: dirtyContextDocs() }))}>Actualizar contexto</Button>
      {running && <Button onClick={() => void act(() => assistantRequest('/context/cancel', {}))}>Detener actualización</Button>}
      <Button disabled={busy || !value.canUndo} onClick={() => void act(() => assistantRequest('/context/undo', contextBody(value)))}>Deshacer última actualización</Button>
      <Button disabled={busy} onClick={() => void act(() => refreshProjectContext())}>Consultar versión actual</Button></div>
    <p className="text-muted">Cada propuesta procesa hasta tres fragmentos de 20.000 caracteres. Revisa y acepta; vuelve a pulsar Actualizar para continuar con los pendientes.</p>
    {value.proposals.slice().reverse().map(p => <details key={p.id} open={p.state === 'prepared' || p.state === 'running'} className="rounded border border-line p-2"><summary>Actualización · {p.state === 'running' ? 'preparando…' : p.state === 'prepared' ? 'pendiente de revisión' : p.state === 'accepted' ? 'aceptada' : p.state === 'rejected' ? 'rechazada' : p.state === 'cancelled' ? 'detenida' : 'error'}</summary>
      {p.error && <p role="alert" className="text-warn">{p.error}</p>}
      {p.fragments.map(f => <div key={f.id} className="my-2"><p>{f.source.root} · {f.source.path} · revisión {f.source.rev} · caracteres {f.source.offset}–{f.source.offset + f.source.length}</p><AssistantDiff before={value.fragments.filter(old => old.source.root === f.source.root && old.source.path === f.source.path && old.source.offset === f.source.offset).map(f => f.text).join('\n')} after={edits[f.id] ?? f.text} undo={false} />{p.state === 'prepared' && <label>Corregir propuesta<textarea aria-label={`Corregir contexto ${f.source.path} ${f.source.offset}`} className={input} maxLength={1500} value={edits[f.id] ?? f.text} onChange={e => setEdits({ ...edits, [f.id]: e.target.value })} /></label>}</div>)}
      {p.state === 'prepared' && <div className="flex gap-2"><Button disabled={busy} variant="primary" onClick={() => void act(() => assistantRequest(`/context/proposals/${p.id}/accept`, { ...contextBody(value), fragments: p.fragments.map(f => ({ id: f.id, text: edits[f.id] ?? f.text })) }))}>Aceptar actualización</Button><Button disabled={busy} onClick={() => void act(() => assistantRequest(`/context/proposals/${p.id}/reject`, contextBody(value)))}>Rechazar actualización</Button><span>{p.remaining} fragmento(s) pendiente(s)</span></div>}
    </details>)}
    <ContextForAction onChange={() => {}} />
    {error && <p role="alert" className="text-danger">{error}</p>}
  </section>;
}
