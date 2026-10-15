import { useState } from 'react';
import { assignCaptureDestination, discardCapture, editCapture, flushCaptureQueue, useCaptureQueue, type QueuedCapture } from '../state/captureQueue';
import { Banner, Button, EmptyState, Field, Input, Modal, Select, Textarea } from './ui';
import { KIND_LABEL, kinds } from '../lib/library';
import type { ResourceKind } from '../api';

export function CaptureQueueDialog() {
  const { items, open, busy, error } = useCaptureQueue();
  const [editing, setEditing] = useState<QueuedCapture | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);
  return <Modal open={open} onClose={() => { if (!busy) { useCaptureQueue.setState({ open: false }); setEditing(null); setDiscarding(null); } }}
    title="Recursos pendientes" labelledBy="et-capture-queue-title" width={680}
    footer={<><Button disabled={busy} onClick={() => void flushCaptureQueue()}>Recargar cola</Button><Button disabled={busy} onClick={() => { useCaptureQueue.setState({ open: false }); setEditing(null); setDiscarding(null); }}>Cerrar</Button></>}>
    <div className="space-y-3 p-4 text-ui">
      <p>Las capturas se conservan en este navegador hasta confirmar el envío. Los errores requieren revisión; cambiar de vault no cambia su destino.</p>
      {error && <Banner kind="danger" inline>{error}</Banner>}
      {!items.length && <EmptyState className="text-ui!">No hay capturas pendientes.</EmptyState>}
      {items.map((item) => <article key={item.id} className="space-y-2 rounded-lg border border-line bg-soft p-3">
        <h3 className="font-bold">{item.title || item.url || item.note?.slice(0, 80) || item.file?.name || item.files?.[0]?.name || 'Sin título'}</h3>
        <p className="break-all text-muted">Destino: {item.destination ?? 'Sin asignar (cola antigua)'}</p>
        {[...(item.file ? [item.file] : []), ...(item.files ?? [])].map((file,i) => <p key={i}>Adjunto conservado: {file.name}</p>)}
        {item.lastError && <Banner kind="warn" inline>{item.lastError}</Banner>}
        {editing?.id === item.id ? <div className="space-y-2">
          {(['url', 'title', 'tags'] as const).map((key) => <Field key={key} label={key === 'url' ? 'URL' : key === 'title' ? 'Título' : 'Etiquetas'}>
            <Input value={editing[key] ?? ''} disabled={busy} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} />
          </Field>)}
          <Field label="Nota"><Textarea rows={4} value={editing.note ?? ''} disabled={busy} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></Field>
          {editing.libraryVersion===1 && <><Field label="Tipo"><Select value={editing.kind ?? ''} disabled={busy} onChange={(e)=>setEditing({...editing,kind:e.target.value?e.target.value as ResourceKind:undefined})}><option value="">Detectar automáticamente</option>{kinds.map((kind)=><option value={kind} key={kind}>{KIND_LABEL[kind]}</option>)}</Select></Field><Field label="Colecciones"><Input value={editing.collections ?? ''} disabled={busy} onChange={(e)=>setEditing({...editing,collections:e.target.value})}/></Field></>}
          <div className="flex flex-wrap gap-2"><Button disabled={busy} variant="primary" onClick={async () => { if (await editCapture(item.id, { url: editing.url, title: editing.title, note: editing.note, tags: editing.tags, kind: editing.kind, collections: editing.collections })) setEditing(null); }}>Guardar edición pendiente</Button>
          <Button disabled={busy} onClick={() => setEditing(null)}>Cancelar edición</Button></div>
        </div> : <>
          <p className="whitespace-pre-wrap break-words">{item.note}</p>
          <div className="flex flex-wrap gap-2">
            {!item.libraryId && <Button size="sm" disabled={busy} onClick={() => void assignCaptureDestination(item.id)}>Asignar al vault actual</Button>}
            <Button size="sm" disabled={busy || !item.libraryId} onClick={() => void flushCaptureQueue(item.id)}>Reintentar</Button>
            <Button size="sm" disabled={busy} onClick={() => setEditing(item)}>Editar</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setDiscarding(item.id)}>Descartar</Button>
          </div>
        </>}
        {discarding === item.id && <Banner kind="warn" inline actions={<>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => { void discardCapture(item.id); setDiscarding(null); }}>Confirmar descarte</Button>
          <Button size="sm" disabled={busy} onClick={() => setDiscarding(null)}>Conservar</Button>
        </>}>¿Eliminar esta copia local? Si el servidor ya la recibió, el recurso guardado se conserva.</Banner>}
      </article>)}
    </div>
  </Modal>;
}
