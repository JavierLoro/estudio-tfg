import { useEffect, useState } from 'react';
import { assistantRequest } from '../state/assistant';
import { contextBody, refreshProjectContext, type DiagramGeneration } from '../state/projectContext';
import { ContextForAction, useContextView } from './ProjectContext';
import { errorMessage } from '../api';
import { Button, Banner } from './ui';

export default function DiagramAssistant({ name, type, onSource }: { name: string; type: string; onSource: (source: string | null) => void }) {
  const value = useContextView(), [description, setDescription] = useState(''), [contextVersion, setContextVersion] = useState<string | undefined>();
  const [model, setModel] = useState(''), [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<DiagramGeneration[]>([]), [selected, setSelected] = useState(''), [code, setCode] = useState('');
  const [svg, setSvg] = useState(''), [error, setError] = useState(''), [renderError, setRenderError] = useState(''), [busy, setBusy] = useState(false);
  const current = items.find(d => d.id === selected), running = items.some(d => d.state === 'running');
  const list = async () => { const result = await assistantRequest<{ items: DiagramGeneration[] }>('/diagram-generations'); setItems(result.items); return result.items; };
  useEffect(() => { let live = true; setItems([]); setSelected(''); setCode(''); setModels([]); setModel(''); if (!value?.account) return;
    void Promise.all([assistantRequest<{ models: { id: string; name: string }[] }>('/models'), assistantRequest<{ items: DiagramGeneration[] }>('/diagram-generations')]).then(([m, d]) => { if (live) { setModels(m.models); setItems(d.items); } }).catch(e => { if (live) setError(errorMessage(e)); }); return () => { live = false; };
  }, [value?.account, value?.project]);
  useEffect(() => { if (current?.state === 'prepared') setCode(current.code); }, [current?.id, current?.state]);
  useEffect(() => { if (!running) return; let live = true; const timer = setInterval(() => void assistantRequest<{ items: DiagramGeneration[] }>('/diagram-generations').then(r => { if (live) setItems(r.items); }).catch(e => { if (live) setError(errorMessage(e)); }), 700); return () => { live = false; clearInterval(timer); }; }, [running]);
  useEffect(() => { let live = true; onSource(null); setSvg(''); setRenderError(''); if (!code.trim()) return;
    const timer = setTimeout(() => void import('../lib/diagram').then(m => m.renderDiagram(code, 'propuesta')).then(r => { if (!live) return; if (r.ok) { setSvg(r.svg); onSource(code); } else setRenderError('No se puede dibujar la propuesta. Corrige el código o solicita otra. ' + r.message); }).catch(() => { if (live) setRenderError('No se pudo previsualizar el diagrama.'); }), 250);
    return () => { live = false; clearTimeout(timer); };
  }, [code, onSource]);
  const generate = async () => {
    if (!value) return; setBusy(true); setError(''); onSource(null);
    try {
      const fresh = await refreshProjectContext(); if (!fresh || fresh.project !== value.project || fresh.account !== value.account) throw new Error('La cuenta o proyecto cambió.');
      const r = await assistantRequest<{ id: string }>('/diagram-generations', { ...contextBody(fresh), name, type, description, model, ...(contextVersion ? { contextVersion } : {}) });
      await list(); setSelected(r.id); setCode('');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <section aria-label="Generar diagrama con asistente" className="space-y-3 text-[13px]">
    <p>Generar prepara una propuesta. No crea ningún archivo. Revisa el dibujo y pulsa Crear diagrama; exportar e insertar son acciones posteriores.</p>
    {!value?.grants.prepareDiagrams && <Banner kind="warn">Autoriza preparar diagramas nuevos en Ajustes → Asistente → Contexto del TFG.</Banner>}
    <label className="block">Descripción<textarea aria-label="Descripción del diagrama" className="mt-1 block w-full rounded border border-line bg-bg p-2" maxLength={4000} rows={3} value={description} onChange={e => setDescription(e.target.value)} /></label>
    <label className="block">Modelo<select aria-label="Modelo para diagrama" value={model} onChange={e => setModel(e.target.value)} className="ml-2 max-w-full rounded border border-line bg-bg p-1"><option value="">Elegir modelo…</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    <ContextForAction onChange={setContextVersion} />
    <div className="flex gap-2"><Button disabled={busy || running || !model || !name || !description.trim() || !value?.grants.prepareDiagrams} onClick={() => void generate()}>Generar propuesta</Button>{running && <Button onClick={() => void assistantRequest('/diagram-generations/cancel', {}).catch(e => setError(errorMessage(e)))}>Detener generación</Button>}</div>
    {!!items.length && <label className="block">Propuestas guardadas<select aria-label="Propuestas de diagramas guardadas" className="ml-2 max-w-full rounded border border-line bg-bg p-1" value={selected} onChange={e => { setSelected(e.target.value); setCode(''); onSource(null); }}><option value="">Elegir propuesta…</option>{items.slice().reverse().map(d => <option key={d.id} value={d.id}>{d.name} · {d.state === 'prepared' ? 'preparada' : d.state === 'running' ? 'generando…' : d.state === 'cancelled' ? 'detenida' : 'error'}</option>)}</select></label>}
    {current?.error && <p role="alert" className="text-warn">{current.error}</p>}
    {current?.state === 'prepared' && <><p>{current.explanation}</p><p className="text-muted">Supuestos: {current.assumptions}</p>{current.context && <details><summary>Contexto utilizado · {current.context.version}</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{current.context.text}</pre></details>}
      <label className="block">Código de la propuesta<textarea aria-label="Código de la propuesta" className="mt-1 block w-full rounded border border-line bg-bg p-2 font-mono" maxLength={30000} rows={7} value={code} onChange={e => { onSource(null); setCode(e.target.value); }} /></label>
      {svg && <div aria-label="Vista previa de la propuesta" className="max-h-80 overflow-auto rounded bg-white p-3" dangerouslySetInnerHTML={{ __html: svg }} />}{renderError && <p role="alert" className="text-danger">{renderError}</p>}</>}
    {error && <p role="alert" className="text-danger">{error}</p>}
  </section>;
}
