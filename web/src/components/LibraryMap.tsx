import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Network, Plus, RefreshCw, Undo2 } from 'lucide-react';
import { api, ApiError, errorMessage, type LibraryMap as MapData, type LibraryMapNode, type LibraryMapResponse, type ResourceFile } from '../api';
import { load, remove, save } from '../lib/storage';
import { mapSource, memoryLink, nodeBranch } from '../lib/libraryMap';
import { withMermaid } from '../lib/mermaid';
import { ext } from '../lib/paths';
import { escapeVisualText } from '../lib/latexVisual';
import { onFileChange } from '../state/events';
import { copyFromNote } from '../state/diagramas';
import { confirmDialog, toast, useUI } from '../state/ui';
import { openResource } from '../state/workspace';
import { Banner, Button, Modal, Spinner, cx } from './ui';
import LibraryUseDialog from './LibraryUseDialog';
import { MemoryTextDialog } from './MemoryTextDialog';

interface Draft { baseRev: string; map: MapData }
const input = 'mt-1 w-full rounded border border-line-strong bg-bg px-2 py-1.5 text-[13px]';

export default function LibraryMap({ onBack }: { onBack: () => void }) {
  const libraryId = useUI(s => s.status?.libraryId), resources = useUI(s => s.resources);
  const key = `et:library-map-draft:${libraryId}`;
  const [view, setView] = useState<LibraryMapResponse | null>(null), [draft, setDraft] = useState<Draft | null>(() => load(key, null));
  const [conflict, setConflict] = useState<LibraryMapResponse | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<{ node: LibraryMapNode; baseRev: string } | null>(null);
  const [history, setHistory] = useState<MapData[]>([]), [to, setTo] = useState(''), [relation, setRelation] = useState('');
  const saving = useRef(false), pending = useRef(draft), seenRevision = useRef<string | null>(null), readSeq = useRef(0);
  pending.current = draft;
  const map = draft?.map ?? view?.map;
  const node = map?.nodes.find(n => n.id === selected);
  useEffect(() => { setTo(''); setRelation(''); }, [selected]);
  const reload = async () => {
    const mine = ++readSeq.current;
    try {
      const result = await api.libraryMap();
      if (mine !== readSeq.current) return;
      if (result.libraryId !== libraryId) throw new Error('La Biblioteca cambió; vuelve al mapa original.');
      if (pending.current && pending.current.baseRev !== result.rev) setConflict(result);
      if (seenRevision.current !== result.rev) setHistory([]);
      seenRevision.current = result.rev;
      setView(result); setError('');
    } catch (e) { if (mine === readSeq.current) setError(errorMessage(e)); }
  };
  useEffect(() => {
    void reload();
    return onFileChange(e => {
      if (!saving.current && e.root === 'notes' && e.path.endsWith('/.mapa.json')) void reload();
    });
    // El padre remonta el mapa cuando cambia la identidad de Biblioteca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId]);
  const store = async (next: MapData, baseRev = draft?.baseRev ?? view?.rev, remember = true) => {
    if (!libraryId || !baseRev) return false;
    const nextDraft = { baseRev, map: next };
    if (!save(key, nextDraft)) { setError('No se pudo conservar el cambio en este navegador. No se ha enviado; conserva el formulario.'); return false; }
    if (remember && map) setHistory(h => [...h.slice(-19), map]);
    pending.current = nextDraft;
    readSeq.current++;
    setDraft(nextDraft); setBusy(true); saving.current = true; setError('');
    try {
      const result = await api.saveLibraryMap(libraryId, baseRev, next);
      seenRevision.current = result.rev; pending.current = null;
      setView(result); setDraft(null); setConflict(null); remove(key);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 409 && (e.body as { current?: LibraryMapResponse })?.current) setConflict((e.body as { current: LibraryMapResponse }).current);
    } finally { setBusy(false); saving.current = false; }
    return true;
  };
  const editNode = (node: LibraryMapNode) => setEditing({ node, baseRev: draft?.baseRev ?? view?.rev ?? '' });
  const newNode = (parent: string | null) => editNode({ id: crypto.randomUUID(), parent, title: '', note: '' });
  const deleteNode = async () => {
    if (!map || !node) return;
    const branch = nodeBranch(map, node.id);
    if (!await confirmDialog({ title: 'Quitar del mapa', text: `Se quitarán «${node.title}» y ${branch.size - 1} nodo(s) internos, con sus conexiones. Las fichas, archivos y copias de la memoria se conservan.`, okLabel: 'Quitar del mapa' })) return;
    if (await store({ ...map, nodes: map.nodes.filter(n => !branch.has(n.id)), links: map.links.filter(l => !branch.has(l.from) && !branch.has(l.to)) })) setSelected(node.parent);
  };
  const tree = (parent: string | null): React.ReactNode => <ul className={cx(parent && 'ml-3 border-l border-line pl-2', 'space-y-1')}>
    {map?.nodes.filter(n => n.parent === parent).map(n => <li key={n.id}>
      <button className={cx('w-full break-words rounded px-2 py-2 text-left text-[12px] hover:bg-hover', selected === n.id && 'bg-active text-accent')} aria-pressed={selected === n.id} onClick={() => setSelected(n.id)}>{n.title}{n.resourceId && <span className="ml-1 text-[10px] text-muted">· recurso</span>}</button>
      {tree(n.id)}
    </li>)}
  </ul>;
  return <div className="h-full overflow-auto bg-soft p-4">
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><Button onClick={onBack}><ArrowLeft size={13} /> Biblioteca</Button><h1 className="mt-3 flex items-center gap-2 text-[22px] font-semibold"><Network size={23} /> Mapa de contenidos</h1><p className="mt-1 text-[12px] text-muted">Organiza temas dentro de otros y conecta tus fuentes. Selecciona un nodo para llevar su contenido a la memoria.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !!conflict || !history.length} onClick={async () => { if (await store(history.at(-1)!, undefined, false)) setHistory(h => h.slice(0, -1)); }}><Undo2 size={13} /> Deshacer</Button>
          <Button disabled={busy} onClick={() => void reload()}><RefreshCw size={13} /> Recargar mapa</Button>
          <Button onClick={() => useUI.getState().setCaptureOpen(true)}>Añadir recurso</Button>
          <Button variant="primary" disabled={!map || busy || !!conflict} onClick={() => newNode(null)}><Plus size={13} /> Nuevo nodo</Button>
        </div>
      </header>
      {error && <Banner kind="danger">{error}</Banner>}
      {draft && <Banner kind="warn">Hay cambios conservados en este navegador que aún no se han confirmado en disco. <Button disabled={busy || !!conflict} onClick={() => void store(draft.map, draft.baseRev, false)}>Reintentar guardado</Button></Banner>}
      {!map ? <p className="flex items-center gap-2">{error ? 'No se pudo cargar el mapa. Puedes volver a intentarlo con Recargar mapa.' : <><Spinner /> Cargando mapa…</>}</p> : !map.nodes.length ? <div className="rounded-lg border border-dashed border-line-strong bg-bg p-10 text-center"><Network size={34} className="mx-auto mb-3 text-muted" /><p>Crea un tema o vincula una ficha de Biblioteca para empezar.</p><Button className="mt-3" disabled={busy} onClick={() => newNode(null)}>Crear primer nodo</Button></div> : <div className="grid gap-4 xl:grid-cols-[210px_minmax(0,1fr)_300px]">
        <aside aria-label="Jerarquía del mapa" className="max-h-[65vh] overflow-auto rounded-lg border border-line bg-bg p-2">{tree(null)}</aside>
        <MapCanvas map={map} selected={selected} onSelect={setSelected} />
        <aside aria-label="Contenido del nodo" className="min-w-0 space-y-3 rounded-lg border border-line bg-bg p-4">
          {!node ? <p className="text-[13px] text-muted">Selecciona un nodo en el mapa o en la jerarquía.</p> : <>
            <h2 className="break-words text-[17px] font-semibold">{node.title}</h2>
            {node.note && <p className="whitespace-pre-wrap break-words text-[13px]">{node.note}</p>}
            <div className="flex flex-wrap gap-2"><Button disabled={busy || !!conflict} onClick={() => newNode(node.id)}>Añadir dentro</Button><Button disabled={busy || !!conflict} onClick={() => editNode(node)}>Editar nodo</Button><Button disabled={busy || !!conflict} onClick={() => void deleteNode()}>Quitar del mapa</Button></div>
            <NodeContents key={`${node.id}:${node.resourceId ?? ''}`} node={node} />
            <section className="border-t border-line pt-3 text-[12px]"><h3 className="mb-2 font-semibold">Conexiones</h3>
              {map.links.filter(l => l.from === node.id || l.to === node.id).map(l => <div key={l.id} className="mb-2 flex items-start gap-2"><button className="min-w-0 flex-1 break-words text-left text-accent" onClick={() => setSelected(l.from === node.id ? l.to : l.from)}>{l.from === node.id ? '→' : '←'} {l.label} · {map.nodes.find(n => n.id === (l.from === node.id ? l.to : l.from))?.title}</button><Button disabled={busy || !!conflict} aria-label={`Quitar conexión ${l.label}`} onClick={() => void store({ ...map, links: map.links.filter(other => other.id !== l.id) })}>Quitar</Button></div>)}
              <form className="space-y-2" onSubmit={async e => { e.preventDefault(); if (!to || !relation.trim()) return; if (await store({ ...map, links: [...map.links, { id: crypto.randomUUID(), from: node.id, to, label: relation }] })) { setTo(''); setRelation(''); } }}>
                <label className="block">Conectar con<select aria-label="Conectar con" className={input} value={to} disabled={busy || !!conflict} onChange={e => setTo(e.target.value)}><option value="">Elegir nodo…</option>{map.nodes.filter(n => n.id !== node.id).map(n => <option value={n.id} key={n.id}>{n.title}</option>)}</select></label>
                <label className="block">Relación<input className={input} value={relation} maxLength={200} disabled={busy || !!conflict} onChange={e => setRelation(e.target.value)} placeholder="Respalda, explica, se usa en…" /></label>
                <Button type="submit" disabled={busy || !!conflict || !to || !relation.trim()}>Conectar nodos</Button>
              </form>
            </section>
          </>}
        </aside>
      </div>}
      <p role="status" className="text-[11px] text-muted">{!view && !draft ? 'Mapa sin cargar' : busy ? 'Guardando mapa…' : draft ? 'Cambios pendientes de guardar' : 'Mapa guardado'}{map ? ` · ${map.nodes.length} ${map.nodes.length === 1 ? 'nodo' : 'nodos'} · ${map.links.length} ${map.links.length === 1 ? 'conexión' : 'conexiones'}` : ''}. Las flechas discontinuas indican que un nodo está dentro de otro.</p>
    </div>
    {editing && map && <NodeEditor node={editing.node} map={map} resources={resources} onClose={() => setEditing(null)} onSave={async n => {
      const next = { ...map, nodes: [...map.nodes.filter(existing => existing.id !== n.id), n] };
      if (await store(next, editing.baseRev)) { setSelected(n.id); setEditing(null); }
    }} busy={busy} />}
    {conflict && draft && <Modal open title="El mapa ha cambiado" width={900} onClose={() => {}} footer={<>
      <Button disabled={busy} onClick={() => { pending.current = null; seenRevision.current = conflict.rev; setView(conflict); setDraft(null); setConflict(null); setHistory([]); remove(key); }}>Conservar versión actual</Button>
      <Button variant="primary" disabled={busy} onClick={() => void store(draft.map, conflict.rev, false)}>Guardar mi versión revisada</Button>
    </>}><div className="space-y-3 p-4 text-[12px]"><p>Otro cliente cambió el mapa. Revisa ambas versiones antes de decidir. Guardar tu versión sustituye el mapa actual y conserva su copia en el historial; las fichas y adjuntos permanecen.</p><div className="grid gap-3 md:grid-cols-2"><div><h3>Versión actual</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-line p-2">{JSON.stringify(conflict.map, null, 2)}</pre></div><div><h3>Mis cambios</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-line p-2">{JSON.stringify(draft.map, null, 2)}</pre></div></div></div></Modal>}
  </div>;
}

function NodeEditor({ node, map, resources, busy, onClose, onSave }: { node: LibraryMapNode; map: MapData; resources: ReturnType<typeof useUI.getState>['resources']; busy: boolean; onClose: () => void; onSave: (node: LibraryMapNode) => Promise<void> }) {
  const [value, setValue] = useState(node);
  const [isNew] = useState(() => !map.nodes.some(n => n.id === node.id));
  const excluded = nodeBranch(map, node.id);
  return <Modal open title={isNew ? 'Nuevo nodo' : 'Editar nodo'} width={620} onClose={() => !busy && onClose()} footer={<>
    <Button disabled={busy} onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy || !value.title.trim()} onClick={() => void onSave(value)}>Guardar nodo</Button>
  </>}><div className="space-y-3 p-4 text-[13px]">
    <label className="block">Título del nodo<input autoFocus className={input} maxLength={200} value={value.title} disabled={busy} onChange={e => setValue({ ...value, title: e.target.value })} /></label>
    <label className="block">Dentro de<select aria-label="Dentro de" className={input} value={value.parent ?? ''} disabled={busy} onChange={e => setValue({ ...value, parent: e.target.value || null })}><option value="">Raíz del mapa</option>{map.nodes.filter(n => !excluded.has(n.id)).map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select></label>
    <label className="block">Recurso de Biblioteca<select aria-label="Recurso de Biblioteca" className={input} value={value.resourceId ?? ''} disabled={busy} onChange={e => { const resource = resources?.find(r => r.id === e.target.value); setValue({ ...value, resourceId: e.target.value || undefined, title: value.title || resource?.title || '' }); }}><option value="">Tema o idea (sin ficha vinculada)</option>{resources?.filter(r => r.id && !r.libraryError).map(r => <option key={r.path} value={r.id!}>{r.title}</option>)}</select></label>
    <p className="text-[12px] text-muted">Un recurso puede estar vinculado a varios nodos. Su ficha y sus archivos siguen siendo los originales.</p>
    <label className="block">Notas del nodo<textarea className={input} rows={4} maxLength={10000} value={value.note} disabled={busy} onChange={e => setValue({ ...value, note: e.target.value })} /></label>
  </div></Modal>;
}

function MapCanvas({ map, selected, onSelect }: { map: MapData; selected: string | null; onSelect: (id: string) => void }) {
  const id = `library-map-${useId().replace(/[^\w-]/g, '')}`, host = useRef<HTMLDivElement>(null), sandbox = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState(''), [error, setError] = useState(''), [zoom, setZoom] = useState(100), [naturalWidth, setNaturalWidth] = useState(400);
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)'), changed = () => setThemeVersion(v => v + 1);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    let alive = true;
    setError(''); setSvg('');
    const styles = getComputedStyle(document.documentElement), color = (name: string) => styles.getPropertyValue(`--et-${name}`).trim();
    void document.fonts.ready.then(() => withMermaid({ theme: 'base', look: 'classic', fontFamily: 'Source Sans 3', flowchart: { htmlLabels: false },
      themeVariables: { primaryColor: color('bg-soft'), primaryTextColor: color('fg'), primaryBorderColor: color('border-strong'), lineColor: color('muted'), edgeLabelBackground: color('bg') } },
    m => m.render(id, mapSource(map), sandbox.current ?? undefined))).then(r => {
      if (!alive) return;
      const width = Number(/viewBox="([^"]+)"/.exec(r.svg)?.[1].split(/\s+/)[2]);
      setNaturalWidth(Number.isFinite(width) && width > 0 ? width : 400); setSvg(r.svg);
    }).catch(e => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [id, map, themeVersion]);
  useEffect(() => {
    for (const el of host.current?.querySelectorAll<SVGGElement>('g.node') ?? []) {
      const match = /(?:^|-)flowchart-n(\d+)-/.exec(el.id), node = match && map.nodes[Number(match[1])];
      if (!node) continue;
      el.dataset.libraryNode = node.id; el.dataset.selected = String(node.id === selected);
      el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.setAttribute('aria-label', node.title); el.setAttribute('aria-pressed', String(node.id === selected));
    }
  }, [svg, selected, map.nodes]);
  const select = (target: EventTarget | null) => {
    const node = (target as Element)?.closest<SVGGElement>('[data-library-node]');
    if (node?.dataset.libraryNode) onSelect(node.dataset.libraryNode);
  };
  return <section aria-label="Mapa de nodos" className="relative min-w-0 rounded-lg border border-line bg-bg">
    <div className="flex items-center justify-end gap-2 border-b border-line p-2 text-[12px]"><Button aria-label="Reducir mapa" onClick={() => setZoom(z => Math.max(50, z - 25))}>−</Button><span>{zoom} %</span><Button aria-label="Ampliar mapa" onClick={() => setZoom(z => Math.min(200, z + 25))}>+</Button></div>
    <div ref={sandbox} aria-hidden="true" className="pointer-events-none invisible absolute inset-4" />
    <div className="max-h-[65vh] min-h-80 overflow-auto p-3">
      {error ? <Banner kind="warn">No se pudo dibujar el mapa. Puedes seguir usando la jerarquía. {error}</Banner> : !svg ? <p className="flex items-center gap-2"><Spinner /> Dibujando mapa…</p> : <div ref={host} style={{ width: naturalWidth * zoom / 100 }} className="mx-auto [&_svg]:w-full! [&_svg]:max-w-none! [&_[data-library-node]]:cursor-pointer [&_[data-selected=true]_rect]:stroke-accent! [&_[data-selected=true]_rect]:stroke-3!" onClick={e => select(e.target)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(e.target); } }} dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  </section>;
}

function NodeContents({ node }: { node: LibraryMapNode }) {
  const resources = useUI(s => s.resources), libraryId = useUI(s => s.status?.libraryId);
  const [file, setFile] = useState<ResourceFile | null>(null), [error, setError] = useState('');
  const [using, setUsing] = useState<{ kind: 'figure' | 'reference'; attachmentPath?: string } | null>(null);
  const [text, setText] = useState<{ title: string; snippet: string } | null>(null);
  const matches = (resources ?? []).filter(r => r.id === node.resourceId), resource = matches.length === 1 ? matches[0] : undefined;
  useEffect(() => {
    let alive = true;
    setFile(null); setError('');
    if (resource && !resource.libraryError) void api.resourceFile(resource.path).then(r => { if (alive) setFile(r); }).catch(e => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [resource?.path, resource?.rev, libraryId]);
  return <section className="space-y-3 border-t border-line pt-3 text-[12px]">
    <h3 className="font-semibold">Llevar a la memoria</h3>
    {node.note.trim() && <Button onClick={() => setText({ title: 'Insertar texto del nodo', snippet: escapeVisualText(node.note) })}>Insertar notas del nodo</Button>}
    {error && <Banner kind="danger">{error}</Banner>}
    {node.resourceId && (!resource || resource.libraryError) && <Banner kind="warn">La ficha no está disponible o su identidad es ambigua. El vínculo se conserva para recuperarlo.</Banner>}
    {resource && <><p className="font-medium">{resource.title}</p>{resource.thumbnailPath && <img src={api.rawUrl('notes', resource.thumbnailPath)} alt={resource.title} className="max-h-36 w-full rounded bg-soft object-contain" />}<Button onClick={() => openResource(resource.path)}>Abrir ficha original</Button></>}
    {file && <>
      {file.item.bibliography && <Button onClick={() => setUsing({ kind: 'reference' })}>Insertar cita</Button>}
      {file.item.note?.trim() && <details><summary className="cursor-pointer font-medium">Notas de la ficha</summary><p className="my-2 whitespace-pre-wrap break-words">{file.item.note}</p><Button onClick={() => setText({ title: 'Insertar notas de la ficha', snippet: escapeVisualText(file.item.note!) })}>Insertar notas de la ficha</Button></details>}
      {file.attachments.filter(a => a.path).map(a => <div key={a.path} className="space-y-1 rounded border border-line p-2"><p className="break-words">{a.name}</p><a href={api.rawUrl('notes', a.path!)} target="_blank" rel="noreferrer" className="mr-2 text-accent">Abrir archivo</a>
        {['png', 'jpg', 'jpeg', 'pdf'].includes(ext(a.path!)) && <Button onClick={() => setUsing({ kind: 'figure', attachmentPath: a.path! })}>Insertar figura</Button>}
        {['mmd', 'excalidraw'].includes(ext(a.path!)) && <Button onClick={async () => { try { const source = await api.readFile('notes', a.path!); copyFromNote(source.content, a.path!); } catch (e) { toast({ kind: 'error', text: errorMessage(e) }); } }}>Crear diagrama en Memoria</Button>}
        {['svg', 'webp', 'gif', 'eps'].includes(ext(a.path!)) && <p className="text-muted">Convierte a PNG, JPG o PDF para insertarlo como figura.</p>}
      </div>)}
      {(file.item.urls ?? []).map(url => <div key={url} className="space-y-1"><p className="break-all text-muted">{url}</p><Button onClick={() => { try { setText({ title: 'Insertar enlace', snippet: memoryLink(url, file.item.title) }); } catch (e) { setError(errorMessage(e)); } }}>Insertar enlace</Button></div>)}
    </>}
    {!node.note.trim() && !node.resourceId && <p className="text-muted">Añade notas o vincula una ficha para incorporar su contenido.</p>}
    {using && file && <LibraryUseDialog file={file} {...using} onClose={() => setUsing(null)} />}
    {text && <MemoryTextDialog {...text} onClose={() => setText(null)} />}
  </section>;
}
