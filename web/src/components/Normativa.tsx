import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FileCheck2, FileUp, LoaderCircle, X } from 'lucide-react';
import { api, errorMessage, json, type SettingsResponse } from '../api';
import { assistantRequest, refreshAssistantAccount, useAssistant } from '../state/assistant';
import type { PropuestaNormativa } from '../../../shared/normativa';
import { Button, IconButton, Modal, Spinner, cx } from './ui';
import { ChatGPTAccount } from './ChatGPTAccount';
import { DirPicker } from './DirPicker';
import { parentAbs } from '../lib/abspath';

const PdfViewer = lazy(() => import('./PdfViewer'));
type List = { account: string; project: string; items: PropuestaNormativa[] };
const states = { running: 'Analizando', prepared: 'Plantilla preparada', cancelled: 'Detenida', error: 'Error', creating: 'Creando', created: 'Creada' };
const input = 'w-full min-w-0 rounded-md border border-line-strong bg-bg px-2 py-2 text-sm outline-none focus:border-accent';
const body = (r: PropuestaNormativa) => ({ account: r.account, project: r.project, baseRev: r.rev });

export function Normativa({ settings, onClose, onCreated }: {
  settings: SettingsResponse; onClose: () => void;
  onCreated: (result: Partial<SettingsResponse> & { warning?: string }) => Promise<void>;
}) {
  const account = useAssistant(s => s.account);
  const active = account?.accounts.find(a => a.id === account.active);
  const [view, setView] = useState<List | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const identity = useRef({ account: active?.id, memoria: settings.values.memoriaDir, notes: settings.values.notesDir });
  const connected = !!active?.connected && active.enabled;
  const [references, setReferences] = useState<{id:string;nombre:string;rev:string}[]>([]), [referenceId, setReferenceId] = useState('');
  useEffect(() => { void json<{items:typeof references}>('/api/templates/personal').then(r => setReferences(r.items)).catch(e => setError(errorMessage(e))); }, []);
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState(''), [correction, setCorrection] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [dragging, setDragging] = useState(false), [uploading, setUploading] = useState(false), [elapsed, setElapsed] = useState(0);
  const [connect, setConnect] = useState(false), [source, setSource] = useState<PropuestaNormativa | null>(null), [sourceText, setSourceText] = useState('');
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState(false);
  const [saving, setSaving] = useState<PropuestaNormativa | null>(null);
  const current = view?.items.find(r => r.id === selected);
  const running = view?.items.some(r => ['running', 'creating'].includes(r.state));
  const analyzing = current?.state === 'running';
  const refresh = async () => { const result = await assistantRequest<List>('/template-generations'); setView(result); return result; };
  useEffect(() => { void refreshAssistantAccount().catch(e => setError(errorMessage(e))); }, []);
  useEffect(() => {
    let live = true;
    const previous = identity.current;
    if ((previous.account && previous.account !== active?.id) || previous.memoria !== settings.values.memoriaDir || previous.notes !== settings.values.notesDir) setFile(null);
    identity.current = { account: active?.id, memoria: settings.values.memoriaDir, notes: settings.values.notesDir };
    setView(null); setSelected(''); setSaving(null); setSource(null); setError('');
    if (!active?.connected || !active.enabled) return;
    void assistantRequest<List>('/template-generations')
      .then(list => {
        if (live && list.account === active.id) { setView(list); if (!file) setSelected(list.items[0]?.id ?? ''); }
      }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [active?.id, active?.connected, active?.enabled, settings.values.memoriaDir, settings.values.notesDir]);
  useEffect(() => { setCorrection(''); }, [current?.id]);
  useEffect(() => {
    if (!analyzing) { setElapsed(0); return; }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - current.updatedAt) / 1000)));
    update(); const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [analyzing, current?.id]);
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
    data.append('metadata', JSON.stringify({ account: view.account, project: view.project, consent: true, referenciaId: referenceId || undefined, referenciaRev: references.find(r => r.id === referenceId)?.rev }));
    data.append('file', file);
    setUploading(true);
    let r: PropuestaNormativa;
    try { r = await json<PropuestaNormativa>('/api/assistant/template-generations', { method: 'POST', body: data }); }
    finally { setUploading(false); }
    await refresh(); setSelected(r.id); setFile(null);
  };
  const chooseFile = (files: File[]) => {
    setDragging(false); setError('');
    if (fileInput.current) fileInput.current.value = '';
    const selectedFile = files[0];
    if (files.length !== 1) { setError('Adjunta una sola normativa'); return; }
    if (!/\.(pdf|txt|md)$/i.test(selectedFile.name)) { setError('Adjunta un PDF o un archivo de texto .txt o .md'); return; }
    if (!selectedFile.size || selectedFile.size > 20 * 1024 * 1024) { setError('Adjunta una normativa de hasta 20 MB'); return; }
    setFile(selectedFile);
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button onClick={() => setConnect(true)}>{connected ? 'Cuenta de ChatGPT' : active?.connected ? 'Autorizar cuenta' : 'Conectar ChatGPT'}</Button>
        </div>
        {!!view?.items.length && <label className="block space-y-2 text-sm font-medium">Análisis anteriores
          <select aria-label="Análisis anteriores" className={input} value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setFile(null); setError(''); }}>
            <option value="">Nueva normativa</option>
            {view.items.map(r => <option key={r.id} value={r.id}>{r.source.name} · {states[r.state]}</option>)}
          </select>
        </label>}
        {!current ? <>
          {references.length > 0 && <label className="block space-y-2 text-sm"><span>Plantilla de referencia</span><select aria-label="Plantilla de referencia" className={input} value={referenceId} disabled={busy || running} onChange={e => setReferenceId(e.target.value)}><option value="">Plantilla base</option>{references.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></label>}
          <div role="region" aria-label="Adjuntar normativa" aria-busy={uploading}
            className={cx('flex min-h-36 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-5 transition-colors motion-reduce:transition-none', dragging ? 'border-accent bg-active' : 'border-line bg-soft')}
            onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); if (!busy && !running) { e.dataTransfer.dropEffect = 'copy'; setDragging(true); } } }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); if (!busy && !running) chooseFile(Array.from(e.dataTransfer.files)); }}>
            {file ? <FileCheck2 size={26} className="text-accent" aria-hidden /> : <FileUp size={26} className="text-muted" aria-hidden />}
            <input ref={fileInput} aria-label="Documento de normativa" type="file" accept=".pdf,.txt,.md" className="sr-only" tabIndex={-1}
              disabled={busy || running} onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) chooseFile(files); }} />
            <Button size="md" variant="primary" disabled={busy || running} onClick={() => fileInput.current?.click()}>
              {file ? 'Cambiar normativa…' : 'Adjuntar normativa…'}
            </Button>
            <p className="break-all text-center text-sm" role="status">{dragging ? 'Suelta aquí la normativa' : file?.name ?? 'Arrastra aquí tu PDF o texto'}</p>
          </div>
          <Button size="md" variant="primary" disabled={busy || running || !file || !connected || !view} onClick={() => void act(generate)}>
            {uploading && <LoaderCircle size={15} className="motion-safe:animate-spin" aria-hidden />}{uploading ? 'Subiendo normativa…' : 'Generar plantilla con ChatGPT'}
          </Button>
        </> : <>
          <div className="flex flex-wrap items-center gap-3">
            <strong className="min-w-0 break-all text-sm">{current.source.name}</strong>
            {!analyzing && <span role="status" className="text-sm">{states[current.state]}</span>}
            <Button disabled={busy} onClick={() => void act(showSource)}>Ver normativa</Button>
            {current.state === 'running' && <Button disabled={busy} onClick={() => void act(async () => {
              await assistantRequest('/template-generations/' + current.id + '/cancel', body(current)); await refresh();
            })}>Detener análisis</Button>}
          </div>
          {analyzing && <div role="status" aria-label="Análisis de normativa en curso" className="flex items-center gap-3 rounded-lg border border-line bg-soft p-4">
            <LoaderCircle size={24} className="shrink-0 text-accent motion-safe:animate-spin" aria-hidden />
            <span className="text-sm font-medium">Analizando normativa…</span>
            <span role="timer" aria-label="Tiempo de análisis" className="ml-auto text-sm tabular-nums text-muted">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
          </div>}
          {current.error && <p role="alert" className="text-sm text-danger">{current.error}</p>}
          {!!current.requisitos.length && <details><summary className="cursor-pointer text-sm font-medium">Ajustes aplicados</summary><section aria-label="Requisitos de la normativa" className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-soft"><tr><th className="p-2">Requisito</th><th className="p-2">Propuesta</th><th className="p-2">Normativa</th></tr></thead>
              <tbody>{current.requisitos.map((r, i) => <tr key={i} className="border-t border-line align-top">
                <td className="p-2 font-medium">{r.nombre}</td><td className="p-2">{r.valor}</td>
                <td className="p-2">{r.pagina && <span className="font-medium">Pág. {r.pagina}. </span>}{r.cita}</td>
              </tr>)}</tbody>
            </table>
          </section></details>}
          {!!current.avisos.filter(a => !a.descartado).length && <section aria-label="Supuestos a revisar" className="space-y-2">
            <h3 className="text-sm font-medium">Supuestos a revisar</h3>
            {current.avisos.filter(a => !a.descartado).map((notice, i) => <div key={notice.id} className="flex items-start gap-3 rounded-md border border-line bg-soft p-3">
              <p id={'aviso-' + notice.id} className="flex-1 text-sm">{notice.texto}</p>
              <IconButton label={'Descartar aviso ' + (i + 1)} aria-describedby={'aviso-' + notice.id} disabled={busy || running}
                onClick={() => void act(async () => {
                  await assistantRequest('/template-generations/' + current.id + '/dismiss', { ...body(current), noticeId: notice.id }); await refresh();
                })}><X size={14} /></IconButton>
            </div>)}
          </section>}
          {current.config && current.state !== 'created' && <div className="space-y-2">
            <label htmlFor="correccion-normativa" className="block text-sm font-medium">Qué quieres corregir</label>
            <textarea id="correccion-normativa" className={input} rows={3} maxLength={2000} value={correction}
              disabled={busy || running} onChange={e => setCorrection(e.target.value)} />
            <Button disabled={busy || running || !correction.trim() || current.calls >= 5} onClick={() => void act(async () => {
              await assistantRequest('/template-generations/' + current.id + '/correct', { ...body(current), text: correction });
              await refresh(); setCorrection('');
            })}>Aplicar corrección</Button>
          </div>}
          <div className="flex flex-wrap gap-3">
            {current.state === 'prepared' && <Button disabled={busy || running} onClick={() => void act(async () => {
              setComparing(true);
              try { if (!current.preview?.ok) await assistantRequest('/template-generations/' + current.id + '/preview', body(current)); await refresh(); setComparison(true); }
              finally { setComparing(false); }
            })}>{comparing ? 'Compilando comparación…' : 'Comparar PDF'}</Button>}
            {comparing && <Button onClick={() => void assistantRequest('/template-generations/' + current.id + '/cancel', body(current)).then(refresh).catch(e => setError(errorMessage(e)))}>Detener comparación</Button>}
            {current.state !== 'created' && <Button size="md" variant="primary" disabled={busy || current.state !== 'prepared' || !current.config || !current.appliedRev}
              onClick={() => setSaving(structuredClone(current))}>Guardar y abrir…</Button>}
            {['error', 'cancelled'].includes(current.state) && current.aceptada && <Button disabled={busy || running} onClick={() => void act(async () => { await assistantRequest('/template-generations/' + current.id + '/discard', body(current)); await refresh(); })}>Recuperar plantilla aceptada</Button>}
            {['error', 'cancelled'].includes(current.state) && <Button disabled={busy || running || current.calls >= 5} onClick={() => void act(async () => {
              await assistantRequest('/template-generations/' + current.id + '/correct', { ...body(current), text: 'Vuelve a generar la plantilla aplicando la normativa y resolviendo los supuestos sin hacer preguntas.' }); await refresh();
            })}>Volver a generar</Button>}
            {!['running', 'creating'].includes(current.state) && <Button disabled={busy} onClick={() => void act(async () => {
              await assistantRequest('/template-generations/' + current.id, body(current), 'DELETE'); await refresh(); setSelected('');
            })}>Eliminar plantilla</Button>}
          </div>
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
    {comparison && current?.preview && <Modal open title="Comparar estilo" width={1400} onClose={() => setComparison(false)} footer={<>
      <Button disabled={busy} onClick={() => void act(async () => { await assistantRequest('/template-generations/' + current.id + '/discard', body(current)); await refresh(); setComparison(false); })}>Descartar propuesta</Button>
      <Button variant="primary" disabled={busy || !current.preview?.ok} onClick={() => void act(async () => { await assistantRequest('/template-generations/' + current.id + '/apply', body(current)); await refresh(); setComparison(false); })}>Aplicar propuesta</Button>
    </>}><div className="p-3 space-y-3">
      {current.preview.diagnostics.map((d,i) => <p key={i} role={d.severity === 'error' ? 'alert' : 'status'} className="text-sm">{d.message}</p>)}
      {current.preview.ok && <div className="grid h-[68vh] min-h-0 grid-cols-2 gap-3">{(['actual', 'propuesta'] as const).map(side => <section className="flex min-h-0 flex-col" key={side} aria-label={side === 'actual' ? 'Actual' : 'Propuesta'}><h3 className="mb-2 text-sm font-medium">{side === 'actual' ? 'Actual' : 'Propuesta'}</h3><div className="min-h-0 flex-1"><Suspense fallback={<Spinner />}><PdfViewer url={'/api/assistant/template-generations/' + current.id + '/preview/' + side + '?v=' + current.preview!.id} synctex={false} /></Suspense></div></section>)}</div>}
    </div></Modal>}
    {saving && <DirPicker open title="Guardar la plantilla" onClose={() => !busy && setSaving(null)} mode="create"
      allowedRoots={settings.allowedRoots} pathSep={settings.pathSep} initialPath={parentAbs(settings.values.memoriaDir, settings.pathSep) || undefined}
      defaultName="mi-plantilla" selectLabel="Guardar y abrir" busy={busy} onSelect={dir => act(async () => {
        const result = await assistantRequest<Partial<SettingsResponse> & { warning?: string }>('/template-generations/' + saving.id + '/create', { ...body(saving), dir });
        await onCreated(result);
      })} />}
  </>;
}
