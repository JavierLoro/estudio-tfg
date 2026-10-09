import { useState } from 'react';
import { assignCaptureDestination, discardCapture, editCapture, flushCaptureQueue, useCaptureQueue, type QueuedCapture } from '../state/captureQueue';
import { Button, Modal } from './ui';

export function CaptureQueueDialog() {
  const { items, open, busy, error } = useCaptureQueue();
  const [editing, setEditing] = useState<QueuedCapture | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const input = 'w-full rounded border border-line bg-bg p-2 text-[12px]';
  return <Modal open={open} onClose={() => { if (!busy) { useCaptureQueue.setState({ open: false }); setEditing(null); setDiscarding(null); } }}
    title="Capturas pendientes" labelledBy="et-capture-queue-title" width={680}
    footer={<><Button disabled={busy} onClick={() => void flushCaptureQueue()}>Recargar cola</Button><Button disabled={busy} onClick={() => { useCaptureQueue.setState({ open: false }); setEditing(null); setDiscarding(null); }}>Cerrar</Button></>}>
    <div className="space-y-3 p-4 text-[12px]">
      <p>Las capturas se conservan en este navegador hasta confirmar el envío. Los errores requieren revisión; cambiar de vault no cambia su destino.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {!items.length && <p>No hay capturas pendientes.</p>}
      {items.map((item) => <article key={item.id} className="space-y-2 rounded border border-line bg-soft p-3">
        <h3 className="font-semibold">{item.title || item.url || item.note?.slice(0, 80) || item.file?.name || 'Sin título'}</h3>
        <p className="break-all text-muted">Destino: {item.destination ?? 'Sin asignar (cola antigua)'}</p>
        {item.file && <p>Adjunto conservado: {item.file.name}</p>}
        {item.lastError && <p role="status" className="text-warn">{item.lastError}</p>}
        {editing?.id === item.id ? <div className="space-y-2">
          {(['url', 'title', 'tags'] as const).map((key) => <label key={key} className="block">{key === 'url' ? 'URL' : key === 'title' ? 'Título' : 'Etiquetas'}
            <input className={input} value={editing[key] ?? ''} disabled={busy} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} />
          </label>)}
          <label className="block">Nota<textarea className={input} rows={4} value={editing.note ?? ''} disabled={busy} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></label>
          <Button disabled={busy} variant="primary" onClick={async () => { if (await editCapture(item.id, { url: editing.url, title: editing.title, note: editing.note, tags: editing.tags })) setEditing(null); }}>Guardar edición pendiente</Button>
          <Button disabled={busy} onClick={() => setEditing(null)}>Cancelar edición</Button>
        </div> : <>
          <p className="whitespace-pre-wrap break-words">{item.note}</p>
          <div className="flex flex-wrap gap-2">
            {!item.libraryId && <Button disabled={busy} onClick={() => void assignCaptureDestination(item.id)}>Asignar al vault actual</Button>}
            <Button disabled={busy || !item.libraryId} onClick={() => void flushCaptureQueue(item.id)}>Reintentar</Button>
            <Button disabled={busy} onClick={() => setEditing(item)}>Editar</Button>
            <Button disabled={busy} onClick={() => setDiscarding(item.id)}>Descartar</Button>
          </div>
        </>}
        {discarding === item.id && <div className="space-y-2 rounded border border-line p-2">
          <p>¿Eliminar esta copia local? Si el servidor ya la recibió, el recurso guardado se conserva.</p>
          <Button disabled={busy} onClick={() => { void discardCapture(item.id); setDiscarding(null); }}>Confirmar descarte</Button>
          <Button disabled={busy} onClick={() => setDiscarding(null)}>Conservar</Button>
        </div>}
      </article>)}
    </div>
  </Modal>;
}
