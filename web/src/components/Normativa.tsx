import { lazy, Suspense, useEffect, useState } from 'react';
import { api, errorMessage, json, type SettingsResponse } from '../api';
import { assistantRequest, refreshAssistantAccount, useAssistant } from '../state/assistant';
import type { PropuestaNormativa } from '../../../shared/normativa';
import { Button, Modal, Spinner } from './ui';
import { ChatGPTAccount } from './ChatGPTAccount';
import { NuevaMemoria } from './NuevaMemoria';

const PdfViewer = lazy(() => import('./PdfViewer'));
type List = { account: string; project: string; items: PropuestaNormativa[] };
const states = { running: 'Analizando', prepared: 'Lista para revisar', cancelled: 'Detenida', error: 'Error', creating: 'Creando', created: 'Creada' };
const input = 'w-full min-w-0 rounded-md border border-line-strong bg-bg px-2 py-2 text-sm outline-none focus:border-accent';
const body = (r: PropuestaNormativa) => ({ account: r.account, project: r.project, baseRev: r.rev });

export function Normativa({ settings, onClose, onCreated }: {
  settings: SettingsResponse; onClose: () => void;
  onCreated: (result: Partial<SettingsResponse> & { warning?: string }) => Promise<void>;
}) {
  const account = useAssistant(s => s.account);
  const active = account?.accounts.find(a => a.id === account.active);
  const [view, setView] = useState<List | null>(null), [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [file, setFile] = useState<File | null>(null), [model, setModel] = useState(''), [consent, setConsent] = useState(false);
  const [selected, setSelected] = useState(''), [answers, setAnswers] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [connect, setConnect] = useState(false), [source, setSource] = useState<PropuestaNormativa | null>(null), [sourceText, setSourceText] = useState('');
  const [review, setReview] = useState<{ item: PropuestaNormativa; accepted: boolean } | null>(null);
  const current = view?.items.find(r => r.id === selected);
  const running = view?.items.some(r => ['running', 'creating'].includes(r.state));
  const refresh = async () => { const result = await assistantRequest<List>('/template-generations'); setView(result); return result; };
  useEffect(() => { void refreshAssistantAccount().catch(e => setError(errorMessage(e))); }, []);
  useEffect(() => {
    let live = true;
    setView(null); setSelected(''); setModels([]); setFile(null); setModel(''); setConsent(false); setReview(null); setSource(null); setError('');
    if (!active?.connected || !active.enabled) return;
    void Promise.all([assistantRequest<List>('/template-generations'), assistantRequest<{ models: { id: string; name: string }[] }>('/models')])
      .then(([list, available]) => {
        if (live && list.account === active.id) { setView(list); setModels(available.models); setSelected(list.items[0]?.id ?? ''); }
      }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [active?.id, active?.connected, active?.enabled, settings.values.memoriaDir, settings.values.notesDir]);
  useEffect(() => { setAnswers(current?.respuestas ?? {}); setAccepted(false); }, [current?.id]);
  useEffect(() => {
    if (!running || !view) return;
    let live = true;
    const timer = setInterval(() => void assistantRequest<List>('/template-generations').then(result => {
      if (live && result.account === view.account && result.project === view.project) setView(result);
    }).catch(e => { if (live) setError(errorMessage(e)); }), 750);
    return () => { live = false; clearInterval(timer); };
  }, [running, view?.account, view?.project]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const generate = async () => {
    if (!file || !view) return;
    if (file.size > 20 * 1024 * 1024) throw new Error('La normativa supera los 20 MB');
    const data = new FormData();
    data.append('metadata', JSON.stringify({ account: view.account, project: view.project, model, consent }));
    data.append('file', file);
    const r = await json<PropuestaNormativa>('/api/assistant/template-generations', { method: 'POST', body: data });
    await refresh(); setSelected(r.id); setFile(null); setConsent(false);
  };
  const showSource = async () => {
    if (!current) return;
    setSourceText('');
    if (current.source.type === 'text') setSourceText(await api.normativaText(current.id));
    setSource(current);
  };
  return <>
    <Modal open title="Crear plantilla desde normativa" width={820} onClose={onClose}
      footer={<Button size="md" onClick={onClose}>Cerrar</Button>}>
      <div className="space-y-5 p-5">
        {!active?.connected || !active.enabled
          ? <Button onClick={() => setConnect(true)}>{active?.connected ? 'Autorizar cuenta' : 'Conectar cuenta'}</Button>
          : <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">{active.label}</span>
              <Button onClick={() => setConnect(true)}>Cuenta de ChatGPT</Button>
            </div>
            <label className="block space-y-2 text-sm font-medium">Propuestas guardadas
              <select aria-label="Propuestas de normativa guardadas" className={input} value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setFile(null); setConsent(false); setAccepted(false); setError(''); }}>
                <option value="">Nuevo análisis</option>
                {view?.items.map(r => <option key={r.id} value={r.id}>{r.source.name} · {states[r.state]}</option>)}
              </select>
            </label>
            {!current ? <>
              <label className="block space-y-2 text-sm font-medium">Normativa
                <input aria-label="Documento de normativa" type="file" accept=".pdf,.txt,.md" className="block w-full text-sm"
                  disabled={busy || running} onChange={e => { setFile(e.target.files?.[0] ?? null); setConsent(false); }} />
              </label>
              <label className="block space-y-2 text-sm font-medium">Modelo
                <select aria-label="Modelo para normativa" className={input} value={model} disabled={busy} onChange={e => setModel(e.target.value)}>
                  <option value="">Elegir modelo…</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />
                Enviar esta normativa a ChatGPT para preparar una plantilla
              </label>
              <Button size="md" variant="primary" disabled={busy || running || !file || !model || !consent || !view} onClick={() => void act(generate)}>
                {busy && <Spinner />}Analizar con ChatGPT
              </Button>
            </> : <>
              <div className="flex flex-wrap items-center gap-3">
                <strong className="min-w-0 break-all text-sm">{current.source.name}</strong>
                <span role="status" className="text-sm">{states[current.state]}</span>
                <Button disabled={busy} onClick={() => void act(showSource)}>Ver normativa</Button>
                {current.state === 'running' && <Button disabled={busy} onClick={() => void act(async () => {
                  await assistantRequest('/template-generations/' + current.id + '/cancel', body(current)); await refresh();
                })}>Detener análisis</Button>}
              </div>
              {current.error && <p role="alert" className="text-sm text-danger">{current.error}</p>}
              {!!current.requisitos.length && <section aria-label="Requisitos de la normativa" className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="bg-soft"><tr><th className="p-2">Requisito</th><th className="p-2">Propuesta</th><th className="p-2">Normativa</th></tr></thead>
                  <tbody>{current.requisitos.map((r, i) => <tr key={i} className="border-t border-line align-top">
                    <td className="p-2 font-medium">{r.nombre}</td><td className="p-2">{r.valor}</td>
                    <td className="p-2">{r.pagina && <span className="font-medium">Pág. {r.pagina}. </span>}{r.cita}</td>
                  </tr>)}</tbody>
                </table>
              </section>}
              {!!current.dudas.length && <fieldset className="space-y-4 rounded-md border border-line p-3">
                <legend className="px-1 text-sm font-medium">Dudas por resolver</legend>
                {current.dudas.map(q => <div key={q.id} className="space-y-2">
                  <label htmlFor={'normativa-' + q.id} className="block text-sm font-medium">{q.pregunta}</label>
                  <blockquote className="border-l-2 border-line pl-3 text-sm">{q.pagina && 'Pág. ' + q.pagina + '. '}{q.cita}</blockquote>
                  {!!q.opciones.length && <div className="flex flex-wrap gap-2">{q.opciones.map(option => <Button key={option} disabled={busy || running}
                    onClick={() => setAnswers(v => ({ ...v, [q.id]: option }))}>{option}</Button>)}</div>}
                  <input id={'normativa-' + q.id} aria-label={q.pregunta} value={answers[q.id] ?? ''} className={input} maxLength={1000}
                    disabled={busy || running} onChange={e => setAnswers(v => ({ ...v, [q.id]: e.target.value }))} />
                </div>)}
              </fieldset>}
              {!!current.limitaciones.length && <section className="space-y-3 rounded-md border border-warn p-3" aria-label="Requisitos no compatibles">
                <h3 className="text-sm font-medium">Requisitos no compatibles</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">{current.limitaciones.map((value, i) => <li key={i}>{value}</li>)}</ul>
                <label className="flex gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />He revisado estas limitaciones</label>
              </section>}
              <div className="flex flex-wrap gap-3">
                {current.state !== 'created' && <Button size="md" variant="primary"
                  disabled={busy || current.state !== 'prepared' || !!current.dudas.length || (!!current.limitaciones.length && !accepted)}
                  onClick={() => setReview({ item: structuredClone(current), accepted })}>Revisar configuración</Button>}
                {!['running', 'creating', 'created'].includes(current.state) && <Button disabled={busy || running || current.calls >= 5 || current.dudas.some(q => !answers[q.id]?.trim())}
                  onClick={() => void act(async () => {
                    await assistantRequest('/template-generations/' + current.id + '/answers', { ...body(current), answers: Object.fromEntries(current.dudas.map(q => [q.id, answers[q.id]])) });
                    await refresh(); setAccepted(false);
                  })}>{current.dudas.length ? 'Analizar respuestas con ChatGPT' : 'Repetir análisis con ChatGPT'}</Button>}
                {!['running', 'creating'].includes(current.state) && <Button disabled={busy} onClick={() => void act(async () => {
                  await assistantRequest('/template-generations/' + current.id, body(current), 'DELETE'); await refresh(); setSelected('');
                })}>Eliminar propuesta</Button>}
              </div>
            </>}
          </>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
    {connect && <Modal open title="Cuenta de ChatGPT" width={640} onClose={() => setConnect(false)} footer={<Button onClick={() => setConnect(false)}>Cerrar</Button>}>
      <div className="p-4"><ChatGPTAccount /></div>
    </Modal>}
    {source && <Modal open title={source.source.name} width={960} onClose={() => setSource(null)}>
      <div className="h-[65vh] min-h-0">
        {source.source.type === 'pdf' ? <Suspense fallback={<Spinner />}><PdfViewer url={'/api/assistant/template-generations/' + source.id + '/source'} synctex={false} /></Suspense>
          : <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 text-sm">{sourceText}</pre>}
      </div>
    </Modal>}
    {review?.item.config && <NuevaMemoria settings={settings} titulo="Revisar plantilla de la normativa" configuracion={review.item.config}
      onClose={() => setReview(null)} onCreated={onCreated}
      crear={(dir, configuracion) => assistantRequest('/template-generations/' + review.item.id + '/create',
        { ...body(review.item), dir, configuracion, acceptLimitations: review.accepted })} />}
  </>;
}
