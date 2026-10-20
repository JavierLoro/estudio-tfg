import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Copy, Send, Square, UserRound, X } from 'lucide-react';
import { Button, Modal, Spinner } from '../components/ui';
import { addAssistantContext, assistantRequest, scopeSummary, useAssistant, useAssistantPermissions, type AssistantThread, type AssistantProposal } from '../state/assistant';
import { errorMessage } from '../api';
import { useUI, confirmDialog } from '../state/ui';
import { useDocs, isDirty, loadDoc } from '../state/docs';
import { openFile } from '../state/workspace';
import { load, save } from '../lib/storage';
import { attachedScope, contextAllowed } from '../lib/assistant';
import { AssistantActions } from '../components/AssistantActions';
import { AssistantDiff } from '../components/AssistantDiff';

const AssistantMessage = lazy(() => import('../components/AssistantMessage'));

const dirtyDocs = () => Object.values(useDocs.getState().docs).filter(d => isDirty(d) || d.conflict || d.saving).map(d => d.key);
export function AssistantPanel({ onOpenAccount }: { onOpenAccount: () => void }) {
  const account = useAssistant(s => s.account), thread = useAssistant(s => s.thread), context = useAssistant(s => s.context), draft = useAssistant(s => s.draft);
  const instance = useUI(s => s.status?.instanceId);
  const previousInstance = useRef(instance);
  const override = useAssistant(s => s.scopeOverride), resources = useUI(s => s.status?.resourcesSubdir ?? 'Recursos');
  const composer = useRef<HTMLTextAreaElement>(null);
  const [authorize, setAuthorize] = useState(false), [authorizeChanges, setAuthorizeChanges] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]), [model, setModel] = useState('');
  const [threads, setThreads] = useState<{ id: string; title: string }[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const { permissions: { memoria, library, allNotes, folders, diagrams, attachments, prepareChanges, documents } } = useAssistantPermissions();
  const scope = { memoria, library, notes: allNotes ? [''] : folders.split('\n').map(s => s.trim()).filter(Boolean), diagrams, attachments, prepareChanges, documents };
  const effectiveScope = thread?.scope ?? override ?? scope;
  const missing = context.filter(doc => !contextAllowed(effectiveScope, doc, resources));
  const active = account?.accounts.find(a => a.id === account.active), [review, setReview] = useState<{ proposal: AssistantProposal; undo: boolean } | null>(null), [selected, setSelected] = useState<string[]>([]);
  const list = async () => setThreads((await assistantRequest<{ threads: { id: string; title: string }[] }>('/threads')).threads);
  const report = (e: unknown) => setError(errorMessage(e));
  const accept = (value: AssistantThread) => {
    const current = useAssistant.getState().thread;
    return value.account === useAssistant.getState().account?.active && value.instance === useUI.getState().status?.instanceId && !(current?.id === value.id && current.revoked && !value.revoked);
  };
  useEffect(() => { setReview(null); setSelected([]); setAuthorize(false); setAuthorizeChanges(false); }, [active?.id, instance]);
  useEffect(() => { if (previousInstance.current !== instance) { previousInstance.current = instance; useAssistant.setState({ thread: null, context: [], draft: '', scopeOverride: null }); } }, [instance]);
  useEffect(() => {
    setModels([]); setThreads([]); setError('');
    if (!active?.connected || !active.enabled) return;
    let live = true;
    void Promise.all([assistantRequest<{ models: { id: string; name: string }[] }>('/models'), assistantRequest<{ threads: { id: string; title: string }[] }>('/threads')])
      .then(([m, t]) => { if (!live) return; setModels(m.models); const saved = load<string>('et:chatgpt:model:' + active.id, ''); setModel(m.models.find(v => v.id === saved)?.id ?? m.models[0]?.id ?? ''); setThreads(t.threads); }).catch(e => { if (live) report(e); });
    return () => { live = false; };
  }, [active?.id, active?.connected, active?.enabled, instance]);
  useEffect(() => {
    if (thread?.state !== 'running') return;
    let live = true;
    const timer = setInterval(() => void assistantRequest<AssistantThread>('/threads/' + thread.id).then(value => { if (live && accept(value) && useAssistant.getState().thread?.id === value.id) useAssistant.setState({ thread: value }); }).catch(e => { if (live) report(e); }), 500);
    return () => { live = false; clearInterval(timer); };
  }, [thread?.id, thread?.state]);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { report(e); } finally { setBusy(false); } };
  const create = async () => {
    const result = await assistantRequest<AssistantThread>('/threads', { model, scope: override ?? scope });
    if (!accept(result)) throw new Error('La cuenta o el proyecto han cambiado.');
    useAssistant.setState({ thread: result, scopeOverride: null }); await list(); return result;
  };
  const send = async () => act(async () => {
    if (!draft.trim()) return;
    if (missing.length) { setAuthorizeChanges(false); setAuthorize(true); return; }
    const current = thread || await create();
    const result = await assistantRequest<AssistantThread>('/threads/' + current.id + '/turns', { text: draft, context: context.map(({ root, path, text }) => ({ root, path, ...(text !== undefined ? { text } : {}) })), dirty: dirtyDocs() });
    if (accept(result)) useAssistant.setState({ thread: result, draft: '', context: [] }); await list();
  });
  const submitProposal = async () => {
    if (!thread || !review) return;
    await act(async () => {
      if (review.proposal.files.some(f => dirtyDocs().includes(`${f.source.root}:${f.source.path}`))) throw new Error('Guarda los borradores afectados antes de aplicar o deshacer.');
      let result: AssistantThread;
      try { result = await assistantRequest<AssistantThread>(`/threads/${thread.id}/proposals/${review.proposal.id}/${review.undo ? 'undo' : 'apply'}`, { selected, dirty: dirtyDocs() }); }
      catch (error) {
        const updated = await assistantRequest<AssistantThread>('/threads/' + thread.id);
        if (accept(updated)) { useAssistant.setState({ thread: updated }); setReview(null); }
        throw error;
      }
      if (!accept(result)) return;
      useAssistant.setState({ thread: result });
      for (const file of result.proposals.find(p => p.id === review.proposal.id)?.files ?? []) {
        if (useDocs.getState().docs[`${file.source.root}:${file.source.path}`]) await loadDoc(file.source.root, file.source.path);
      }
      setReview(null);
    });
  };
  const beginReview = (proposal: AssistantProposal, undo: boolean) => { setSelected(proposal.files.map(f => f.source.id)); setReview({ proposal, undo }); };
  const unavailable = busy || thread?.state === 'running' || !!thread?.revoked || !!thread?.permissionsOutdated || !!thread?.archived;
  const progress = thread?.state === 'running' ? (thread.messages.at(-1)?.role === 'tool' ? 'Consultando fuentes y preparando la respuesta…' : 'El asistente está respondiendo…') : thread?.state === 'error' ? 'La consulta no se pudo completar.' : thread?.messages.some(m => m.role === 'assistant' && m.text) ? 'Respuesta completada.' : '';
  return <div role="region" aria-label="Panel del asistente" className="flex h-full flex-col bg-bg text-[14px]">
    <div className="flex shrink-0 items-center justify-between border-b border-line px-2 py-1 text-muted"><span>{thread ? 'Conversación' : 'Nueva conversación'}</span>
      <Button disabled={busy || thread?.state === 'running'} onClick={() => { setError(''); useAssistant.setState({ thread: null, context: [], scopeOverride: null }); }}>Nueva conversación</Button>
    </div>
    <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
      {(!active?.connected || !active.enabled || account?.error) && <div className="space-y-2">
        <p className="text-warn">{account?.error || (active?.connected ? 'Autoriza el uso de tu plan de ChatGPT para usar el asistente.' : 'Conecta tu cuenta de ChatGPT para usar el asistente.')}</p>
        <Button onClick={onOpenAccount} aria-haspopup="dialog"><UserRound size={14} />{!active?.connected ? 'Conectar cuenta' : !active.enabled ? 'Autorizar cuenta' : 'Revisar cuenta'}</Button>
      </div>}
      {!!threads.length && <details><summary className="cursor-pointer text-muted">Conversaciones guardadas ({threads.length})</summary><div className="mt-2 flex gap-2"><select aria-label="Conversaciones guardadas" className="min-w-0 flex-1 rounded border border-line bg-bg p-1" value={thread?.id ?? ''} disabled={busy || thread?.state === 'running'} onChange={e => void act(async () => { if (e.target.value) { const value = await assistantRequest<AssistantThread>('/threads/' + e.target.value); if (accept(value)) useAssistant.setState({ thread: value, context: [], scopeOverride: null }); } })}>
        <option value="">Elegir conversación…</option>{threads.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>{thread && <Button disabled={busy || thread.state === 'running'} onClick={() => void act(async () => { if (!await confirmDialog({ title: 'Borrar conversación', text: 'Se eliminará el historial local de esta conversación.', danger: true, okLabel: 'Borrar' })) return; await assistantRequest('/threads/' + thread.id, undefined, 'DELETE'); useAssistant.setState({ thread: null, scopeOverride: null }); await list(); })}>Borrar</Button>}</div></details>}
      {!thread && <p className="text-[13px] text-muted">Fuentes: {scopeSummary(effectiveScope)} · {effectiveScope.prepareChanges ? 'puede preparar cambios' : 'solo consulta'}. Puedes elegir los permisos en Ajustes → Asistente.</p>}
      {!thread && override && <p className="text-muted">Autorización puntual para los adjuntos. No cambia los permisos generales de Ajustes.</p>}
      {thread && <p className="text-[13px] text-muted">Permisos de este chat: {scopeSummary(thread.scope)} · {thread.scope.prepareChanges ? 'puede preparar cambios' : 'solo consulta'}.</p>}
      <AssistantActions disabled={unavailable} onChoose={(doc, prompt) => { addAssistantContext(doc); useAssistant.setState({ draft: draft.trim() ? draft + '\n\n' + prompt : prompt }); composer.current?.focus(); }} />
      <p role="status" aria-live="polite" aria-atomic="true" className="text-muted">{progress}</p>
      {thread?.revoked && <p role="status" className="text-warn">Acceso retirado. Inicia una conversación nueva para consultar o preparar cambios. El historial permanece localmente; puedes revisar y deshacer cambios ya guardados.</p>}
      {thread?.permissionsOutdated && !thread.revoked && <p role="status" className="text-warn">Esta conversación usa los permisos anteriores. Inicia una nueva para elegir los actuales. Puedes consultar el historial y deshacer cambios ya guardados.</p>}
      {thread?.archived && <p className="text-muted">El historial de conversación se ha borrado. Este registro conserva únicamente las copias necesarias para deshacer los cambios guardados.</p>}
      {!!thread?.messages.some(message => message.role === 'tool') && <details className="text-[13px] text-muted"><summary className="cursor-pointer">Actividad ({thread.messages.filter(message => message.role === 'tool').length})</summary><ul className="mt-1 space-y-1">{thread.messages.filter(message => message.role === 'tool').map((message, i) => <li key={i}>{message.text.replace(/^Consulta: /, 'Documento consultado: ').replace(/^Propuesta: (\d+) archivos · .+$/, 'Propuesta preparada: $1 archivo(s)')}</li>)}</ul></details>}
      <div aria-label="Conversación" className="space-y-2">{thread?.messages.filter((message, i) => message.role !== 'tool' && (message.role !== 'assistant' || message.text || (thread.state === 'running' && i === thread.messages.length - 1))).map((message, i) => <article key={i} className="rounded border border-line p-2">
        <strong>{message.role === 'user' ? 'Tú' : 'Asistente'}</strong>
        {message.role === 'assistant' && message.text ? <><Suspense fallback={<p className="whitespace-pre-wrap break-words">{message.text}</p>}><AssistantMessage text={message.text} sources={thread.sources} /></Suspense><Button aria-label="Copiar respuesta" className="mt-2" onClick={() => void act(async () => { if (!navigator.clipboard) throw new Error('No se pudo acceder al portapapeles. Selecciona y copia el texto.'); await navigator.clipboard.writeText(message.text); useUI.getState().toast({ kind: 'ok', text: 'Respuesta copiada' }); })}><Copy size={13} />Copiar</Button></> : <p className="mt-1 whitespace-pre-wrap break-words">{message.text || (thread.state === 'running' ? 'Pensando…' : '')}</p>}
      </article>)}</div>
      {!!thread?.sources.length && <details><summary>Fuentes de esta conversación ({thread.sources.length})</summary><ul>{thread.sources.map(source => <li key={source.id}><button type="button" className="text-accent underline" title={source.path} onClick={() => openFile(source.root, source.path, { side: true })}>{source.title}</button></li>)}</ul></details>}
      {thread?.proposals.map(proposal => <section key={proposal.id} className="space-y-2 rounded border border-line p-3"><h2 className="font-semibold">Propuesta · {proposal.files.length} archivos · {proposal.state === 'done' ? 'aplicada' : proposal.state === 'undone' ? 'deshecha' : proposal.state === 'prepared' ? 'pendiente de revisión' : 'operación interrumpida'}</h2>
        {proposal.error && <p className="text-warn">{proposal.error}</p>}
        {['prepared', 'applying'].includes(proposal.state) && <Button disabled={busy || thread.state === 'running' || thread.revoked || thread.permissionsOutdated || !thread.scope.prepareChanges} onClick={() => beginReview(proposal, false)}>{proposal.state === 'prepared' ? 'Revisar cambios' : 'Revisar y completar'}</Button>}
        {['done', 'applying', 'undoing'].includes(proposal.state) && <Button disabled={busy || thread.state === 'running'} onClick={() => beginReview(proposal, true)}>Revisar y deshacer</Button>}
      </section>)}
      {(error || thread?.error) && <div role="alert" className="rounded border border-danger/40 p-2 text-danger"><p>{error || thread?.error}</p>{thread?.errorCode && <details className="text-[13px]"><summary>Detalles técnicos</summary><code>{thread.errorCode}</code></details>}</div>}
    </div>
    <footer className="shrink-0 space-y-2 border-t border-line p-2 pb-6">
      {!!context.length && <ul aria-label="Contexto adjunto" className="max-h-24 overflow-y-auto">{context.map((c, i) => <li key={c.root + c.path} className="flex items-center gap-2"><span className="truncate" title={c.path}>{c.path}{c.selection ? ' · selección' : c.text !== undefined ? ' · documento o borrador' : ''}</span><Button aria-label={`Quitar ${c.path}`} onClick={() => useAssistant.setState({ context: context.filter((_, n) => n !== i) })}><X size={13} /></Button></li>)}</ul>}
      {!!missing.length && <div role="status" className="space-y-1 rounded border border-warn/40 p-2"><p>Falta permiso para {missing.map(c => c.path).join(', ')}.</p><Button disabled={busy || thread?.state === 'running' || !active?.connected || !active.enabled} onClick={() => { setAuthorizeChanges(false); setAuthorize(true); }}>Autorizar documentos adjuntos</Button></div>}
      <label className="block">Mensaje al asistente<textarea ref={composer} aria-label="Mensaje al asistente" placeholder="Escribe tu pregunta o elige una acción…" rows={2} value={draft} onChange={e => useAssistant.setState({ draft: e.target.value })} className="mt-1 block max-h-32 min-h-12 w-full resize-y rounded border border-line bg-bg p-2" /></label>
      <div className="flex items-center gap-2"><Button variant="primary" disabled={unavailable || !!missing.length || !active?.connected || !active.enabled || !draft.trim() || (!thread && !model)} onClick={() => void send()}><Send size={14} />Enviar</Button>
        <select aria-label="Modelo del asistente" title={thread ? 'Inicia otra conversación para cambiar de modelo' : 'Modelo para la nueva conversación'} className="min-w-0 flex-1 rounded border border-line bg-bg p-1 disabled:opacity-60" value={thread?.model ?? model} disabled={!!thread || busy || !models.length} onChange={e => { setModel(e.target.value); if (active) save('et:chatgpt:model:' + active.id, e.target.value); }}>
          {!models.length && <option value="">Sin modelos disponibles</option>}
          {thread && !models.some(m => m.id === thread.model) && <option value={thread.model}>{thread.model}</option>}
          {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {thread?.state === 'running' && <Button onClick={() => void act(async () => { await assistantRequest('/threads/' + thread.id + '/cancel', {}); })}><Square size={11} />Detener</Button>}{busy && <Spinner size={12} />}</div>
    </footer>
    <Modal open={authorize} onClose={() => setAuthorize(false)} title="Autorizar documentos adjuntos" footer={<><Button onClick={() => setAuthorize(false)}>Cancelar</Button><Button variant="primary" disabled={!active?.connected || !active.enabled || !context.length || context.length > 30} onClick={() => {
      setError(''); useAssistant.setState({ thread: null, scopeOverride: attachedScope(context, authorizeChanges) }); setAuthorize(false);
    }}>Permitir solo estos documentos</Button></>}>
      <div className="space-y-3 p-3 text-[14px]"><p>Consultar estos documentos enviará su contenido a OpenAI al pulsar Enviar. Autorizar no envía el mensaje.</p>
        <ul className="list-disc pl-5">{context.map(c => <li key={c.root + c.path} className="break-all">{c.root === 'memoria' ? 'Memoria' : 'Notas'} · {c.path}{c.selection && ' · se adjunta la selección, pero el permiso permite consultar el archivo completo'}</li>)}</ul>
        <p>Solo estos archivos, sin acceso a sus carpetas.{context.some(c => /\.(pdf|png|jpe?g|webp)$/i.test(c.path)) && ' Incluye el permiso de PDF e imágenes para estos archivos.'}</p>
        <label className="flex gap-2"><input type="checkbox" checked={authorizeChanges} onChange={e => setAuthorizeChanges(e.target.checked)} />Permitir propuestas sobre los textos compatibles de esta lista (siempre con revisión)</label>
        {thread && <p>Se preparará una conversación nueva. Este chat mantiene sus permisos e historial. Tu mensaje y los documentos adjuntos se conservan.</p>}
        {context.length > 30 && <p role="alert">Puedes autorizar hasta 30 documentos. Retira algunos adjuntos.</p>}
      </div>
    </Modal>
    <Modal open={!!review} onClose={() => { if (!busy) setReview(null); }} title={review?.undo ? 'Revisar y deshacer cambios' : 'Revisar y guardar cambios'} width={960} footer={<><Button disabled={busy} onClick={() => setReview(null)}>Cancelar</Button><Button variant="primary" disabled={busy || (!review?.undo && (thread?.revoked || thread?.permissionsOutdated || !selected.length || !thread?.scope.prepareChanges))} onClick={() => void submitProposal()}>{busy ? 'Guardando…' : review?.undo ? 'Deshacer conjunto' : 'Aplicar y guardar'}</Button></>}>
      <p className="mb-3">Revisa todos los archivos. El conjunto queda registrado para recuperarlo si se interrumpe. Guarda antes los borradores afectados.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {review?.proposal.files.map(file => <details key={file.source.id} className="mb-2 rounded border border-line p-2" open><summary><label onClick={e => e.stopPropagation()}><input type="checkbox" disabled={busy || review.undo || review.proposal.state !== 'prepared'} checked={selected.includes(file.source.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, file.source.id] : previous.filter(id => id !== file.source.id))} /> {file.source.path}</label></summary><AssistantDiff before={file.before} after={file.after} undo={review.undo} /></details>)}
    </Modal>
  </div>;
}
