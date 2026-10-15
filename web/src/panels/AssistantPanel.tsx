import { useEffect, useRef, useState } from 'react';
import { Bot, Plus, Send, Square, X } from 'lucide-react';
import { Button, Modal, Spinner } from '../components/ui';
import { ChatGPTAccount } from '../components/ChatGPTAccount';
import { assistantRequest, useAssistant, type AssistantThread, type AssistantProposal } from '../state/assistant';
import { errorMessage } from '../api';
import { useUI, confirmDialog } from '../state/ui';
import { useDocs, isDirty, loadDoc } from '../state/docs';
import { openFile } from '../state/workspace';
import { load, save } from '../lib/storage';

const dirtyDocs = () => Object.values(useDocs.getState().docs).filter(d => isDirty(d) || d.conflict || d.saving).map(d => d.key);
export function AssistantPanel() {
  const account = useAssistant(s => s.account), thread = useAssistant(s => s.thread), context = useAssistant(s => s.context), draft = useAssistant(s => s.draft);
  const instance = useUI(s => s.status?.instanceId);
  const previousInstance = useRef(instance);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]), [model, setModel] = useState('');
  const [threads, setThreads] = useState<{ id: string; title: string }[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [memoria, setMemoria] = useState(false), [library, setLibrary] = useState(false), [allNotes, setAllNotes] = useState(false), [folders, setFolders] = useState('');
  const active = account?.accounts.find(a => a.id === account.active), [review, setReview] = useState<{ proposal: AssistantProposal; undo: boolean } | null>(null), [selected, setSelected] = useState<string[]>([]);
  const list = async () => setThreads((await assistantRequest<{ threads: { id: string; title: string }[] }>('/threads')).threads);
  const report = (e: unknown) => setError(errorMessage(e));
  const accept = (value: AssistantThread) => value.account === useAssistant.getState().account?.active && value.instance === useUI.getState().status?.instanceId;
  useEffect(() => { setReview(null); setSelected([]); }, [active?.id, instance]);
  useEffect(() => { if (previousInstance.current !== instance) { previousInstance.current = instance; useAssistant.setState({ thread: null, context: [], draft: '' }); } }, [instance]);
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
    const result = await assistantRequest<AssistantThread>('/threads', { model, scope: { memoria, library, notes: allNotes ? [''] : folders.split('\n').map(s => s.trim()).filter(Boolean) } });
    if (!accept(result)) throw new Error('La cuenta o el proyecto han cambiado.');
    useAssistant.setState({ thread: result }); await list(); return result;
  };
  const send = async () => act(async () => {
    if (!draft.trim()) return;
    const current = thread || await create();
    const result = await assistantRequest<AssistantThread>('/threads/' + current.id + '/turns', { text: draft, context, dirty: dirtyDocs() });
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
  return <div role="region" aria-label="Panel del asistente" className="flex h-full flex-col bg-bg text-[12px]">
    <header className="flex shrink-0 items-center gap-2 border-b border-line p-2"><Bot size={16} /><h1 className="font-semibold">Asistente</h1>
      <Button disabled={busy || thread?.state === 'running'} onClick={() => useAssistant.setState({ thread: null, context: [] })}><Plus size={12} />Nueva conversación</Button>
    </header>
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
      <ChatGPTAccount announce />
      {!!threads.length && <div className="flex gap-2"><select aria-label="Conversaciones guardadas" className="min-w-0 flex-1 rounded border border-line bg-bg p-1" value={thread?.id ?? ''} disabled={busy || thread?.state === 'running'} onChange={e => void act(async () => { if (e.target.value) { const value = await assistantRequest<AssistantThread>('/threads/' + e.target.value); if (accept(value)) useAssistant.setState({ thread: value, context: [] }); } })}>
        <option value="">Elegir conversación…</option>{threads.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>{thread && <Button disabled={busy || thread.state === 'running'} onClick={() => void act(async () => { if (!await confirmDialog({ title: 'Borrar conversación', text: 'Se eliminará el historial local de esta conversación.', danger: true, okLabel: 'Borrar' })) return; await assistantRequest('/threads/' + thread.id, undefined, 'DELETE'); useAssistant.setState({ thread: null }); await list(); })}>Borrar</Button>}</div>}
      {!thread && <section className="space-y-2 rounded border border-line p-3" aria-label="Permisos de la conversación">
        <h2 className="font-semibold">Qué puede consultar</h2><p className="text-muted">Autoriza el envío a OpenAI de las fuentes que el agente consulte, incluidos PDF e imágenes. Solo actúa cuando envías un mensaje.</p>
        <label className="flex gap-2"><input type="checkbox" checked={memoria} onChange={e => setMemoria(e.target.checked)} />Memoria actual</label>
        <label className="flex gap-2"><input type="checkbox" checked={library} onChange={e => setLibrary(e.target.checked)} />Biblioteca y sus adjuntos</label>
        <label className="flex gap-2"><input type="checkbox" checked={allNotes} onChange={e => setAllNotes(e.target.checked)} />Todas las notas (la Biblioteca se autoriza aparte)</label>
        {!allNotes && <label className="block">Carpetas de notas permitidas, relativas al vault (una por línea)<textarea aria-label="Carpetas de notas permitidas" rows={2} value={folders} onChange={e => setFolders(e.target.value)} className="mt-1 block w-full rounded border border-line bg-bg p-2 font-mono" placeholder="Investigación" /></label>}
        <label className="flex items-center gap-2">Modelo<select aria-label="Modelo del asistente" className="max-w-full rounded border border-line bg-bg p-1" value={model} onChange={e => { setModel(e.target.value); if (active) save('et:chatgpt:model:' + active.id, e.target.value); }}>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      </section>}
      {thread && <p className="text-muted">Modelo: {thread.model} · Permisos: {[thread.scope.memoria && 'memoria', thread.scope.library && 'biblioteca', thread.scope.notes.length > 0 && 'notas'].filter(Boolean).join(', ') || 'sin fuentes'}.</p>}
      {thread?.archived && <p className="text-muted">El historial de conversación se ha borrado. Este registro conserva únicamente las copias necesarias para deshacer los cambios guardados.</p>}
      <div aria-label="Conversación" className="space-y-3">{thread?.messages.filter((message, i) => message.role !== 'assistant' || message.text || (thread.state === 'running' && i === thread.messages.length - 1)).map((message, i) => <article key={i} className={message.role === 'tool' ? 'text-[11px] text-muted' : 'rounded border border-line p-3'}>
        <strong>{message.role === 'user' ? 'Tú' : message.role === 'assistant' ? 'Asistente' : 'Actividad'}</strong><p className="mt-1 whitespace-pre-wrap break-words">{message.text || (thread.state === 'running' ? 'Pensando…' : '')}</p>
      </article>)}</div>
      {!!thread?.sources.length && <details><summary>Fuentes consultables ({thread.sources.length})</summary><ul>{thread.sources.map(source => <li key={source.id}><button type="button" className="text-accent underline" onClick={() => openFile(source.root, source.path, { side: true })}>{source.title}</button><span className="ml-2 font-mono text-[10px]">[fuente:{source.id}]</span></li>)}</ul></details>}
      {thread?.proposals.map(proposal => <section key={proposal.id} className="space-y-2 rounded border border-line p-3"><h2 className="font-semibold">Propuesta · {proposal.files.length} archivos · {proposal.state === 'done' ? 'aplicada' : proposal.state === 'undone' ? 'deshecha' : proposal.state === 'prepared' ? 'pendiente de revisión' : 'operación interrumpida'}</h2>
        {proposal.error && <p className="text-warn">{proposal.error}</p>}
        {['prepared', 'applying'].includes(proposal.state) && <Button disabled={busy || thread.state === 'running'} onClick={() => beginReview(proposal, false)}>{proposal.state === 'prepared' ? 'Revisar cambios' : 'Revisar y completar'}</Button>}
        {['done', 'applying', 'undoing'].includes(proposal.state) && <Button disabled={busy || thread.state === 'running'} onClick={() => beginReview(proposal, true)}>Revisar y deshacer</Button>}
      </section>)}
      {(error || thread?.error) && <p role="alert" className="rounded border border-danger/40 p-2 text-danger">{error || thread?.error}{thread?.errorCode && <span className="block font-mono text-[10px]">{thread.errorCode}</span>}</p>}
    </div>
    <footer className="shrink-0 space-y-2 border-t border-line p-3">
      {!!context.length && <ul aria-label="Contexto adjunto">{context.map((c, i) => <li key={c.root + c.path} className="flex items-center gap-2"><span className="truncate">{c.path}{c.text !== undefined ? ' · selección o borrador' : ''}</span><Button aria-label={`Quitar ${c.path}`} onClick={() => useAssistant.setState({ context: context.filter((_, n) => n !== i) })}><X size={11} /></Button></li>)}</ul>}
      <label className="block">Mensaje al asistente<textarea aria-label="Mensaje al asistente" rows={3} value={draft} onChange={e => useAssistant.setState({ draft: e.target.value })} className="mt-1 block w-full resize-y rounded border border-line bg-bg p-2" /></label>
      <div className="flex items-center gap-2"><Button variant="primary" disabled={busy || !active?.connected || !active.enabled || !draft.trim() || (!thread && !model) || thread?.state === 'running' || thread?.archived} onClick={() => void send()}><Send size={12} />Enviar</Button>
        {thread?.state === 'running' && <Button onClick={() => void act(async () => { await assistantRequest('/threads/' + thread.id + '/cancel', {}); })}><Square size={11} />Detener</Button>}{busy && <Spinner size={12} />}<a className="ml-auto text-accent underline" href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noreferrer">Gestionar uso</a></div>
    </footer>
    <Modal open={!!review} onClose={() => { if (!busy) setReview(null); }} title={review?.undo ? 'Revisar y deshacer cambios' : 'Revisar y guardar cambios'} width={960} footer={<><Button disabled={busy} onClick={() => setReview(null)}>Cancelar</Button><Button variant="primary" disabled={busy || (!review?.undo && !selected.length)} onClick={() => void submitProposal()}>{busy ? 'Guardando…' : review?.undo ? 'Deshacer conjunto' : 'Aplicar y guardar'}</Button></>}>
      <p className="mb-3">Revisa todos los archivos. El conjunto queda registrado para recuperarlo si se interrumpe. Guarda antes los borradores afectados.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {review?.proposal.files.map(file => <details key={file.source.id} className="mb-2 rounded border border-line p-2" open><summary><label onClick={e => e.stopPropagation()}><input type="checkbox" disabled={busy || review.undo || review.proposal.state !== 'prepared'} checked={selected.includes(file.source.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, file.source.id] : previous.filter(id => id !== file.source.id))} /> {file.source.path}</label></summary><div className="mt-2 grid gap-2 md:grid-cols-2"><div><strong>Anterior</strong><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-soft p-2 text-[11px]">{file.before}</pre></div><div><strong>Propuesta</strong><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-soft p-2 text-[11px]">{file.after}</pre></div></div></details>)}
    </Modal>
  </div>;
}
