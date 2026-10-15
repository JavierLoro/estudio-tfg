import { STATUS_LABEL, useResourceEdit, reloadResourceConflict, reapplyResourceConflict } from '../state/resources';
import { Banner, Button, Modal } from './ui';

export function ResourceConflictDialog() {
  const { pending, busy, error } = useResourceEdit();
  return (
    <Modal open={!!pending} onClose={() => {}} title="El recurso ha cambiado" labelledBy="et-resource-conflict" width={620}
      footer={<>
        <Button disabled={busy} onClick={() => useResourceEdit.setState({ pending: null, error: null })}>Descartar mi cambio</Button>
        <Button disabled={busy} onClick={() => void reloadResourceConflict()}>Recargar versión actual</Button>
        <Button variant="primary" disabled={busy || !pending?.reviewed} onClick={() => void reapplyResourceConflict()}>Reaplicar mi cambio</Button>
      </>}>
      {pending && <div className="space-y-3 p-4 text-ui">
        <p>Otro cliente modificó {pending.path}. Tu cambio sigue pendiente.</p>
        <p className="font-bold">Mi cambio: {pending.changes.status ? STATUS_LABEL[pending.changes.status] ?? pending.changes.status : pending.changes.tags ? `etiquetas ${pending.changes.tags.join(', ')}` : 'Datos de la ficha y notas'}</p>
        <p>Recarga y revisa el contenido actual antes de reaplicar. Solo se modificarán los campos de tu cambio.</p>
        {pending.reviewed && <pre aria-label="Versión actual del recurso" className="max-h-80 overflow-auto rounded-md border border-line bg-soft p-2 font-mono text-sm whitespace-pre-wrap">{pending.content}</pre>}
        {error && <Banner kind="danger" inline>{error}</Banner>}
      </div>}
    </Modal>
  );
}
