import { STATUS_LABEL, useResourceEdit, reloadResourceConflict, reapplyResourceConflict } from '../state/resources';
import { Button, Modal } from './ui';

export function ResourceConflictDialog() {
  const { pending, busy, error } = useResourceEdit();
  return (
    <Modal open={!!pending} onClose={() => {}} title="El recurso ha cambiado" labelledBy="et-resource-conflict" width={620}
      footer={<>
        <Button disabled={busy} onClick={() => useResourceEdit.setState({ pending: null, error: null })}>Descartar mi cambio</Button>
        <Button disabled={busy} onClick={() => void reloadResourceConflict()}>Recargar versión actual</Button>
        <Button variant="primary" disabled={busy || !pending?.reviewed} onClick={() => void reapplyResourceConflict()}>Reaplicar mi cambio</Button>
      </>}>
      {pending && <div className="space-y-3 p-4 text-[12px]">
        <p>Otro cliente modificó {pending.path}. Tu cambio sigue pendiente.</p>
        <p className="font-medium">Mi cambio: {pending.changes.status ? STATUS_LABEL[pending.changes.status] ?? pending.changes.status : `etiquetas ${pending.changes.tags?.join(', ')}`}</p>
        <p>Recarga y revisa el contenido actual antes de reaplicar. Solo se modificarán los campos de tu cambio.</p>
        {pending.reviewed && <pre aria-label="Versión actual del recurso" className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-line bg-soft p-2">{pending.content}</pre>}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>}
    </Modal>
  );
}
