import { useEffect, useState } from 'react';
import { api, errorMessage, type MigrationPreview } from '../api';
import { toast, useUI } from '../state/ui';
import { Button, Modal, Spinner } from './ui';

export function LibraryMigrationDialog({ open, onClose, onlyPath }: { open: boolean; onClose: () => void; onlyPath?: string }) {
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = async () => {
    try {
      const next = await api.migrationPreview();
      setPreview(next);
      setSelected(next.items.filter((item) => !onlyPath || item.path === onlyPath).map((item) => item.path));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    if (open) {
      setPreview(null);
      setError('');
      void load();
    }
  }, [open, onlyPath]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await useUI.getState().refreshResources();
      await useUI.getState().refreshStatus();
      await load();
      toast({ kind: 'ok', text: 'Biblioteca actualizada; los originales se conservan para deshacer' });
    } catch (e) {
      setError(errorMessage(e));
      await load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Actualizar formato de Biblioteca"
      width={760}
      footer={
        <>
          <Button disabled={busy} onClick={() => void load()}>
            Recargar vista previa
          </Button>
          <Button disabled={busy} onClick={onClose}>
            Cerrar
          </Button>
          <Button
            variant="primary"
            disabled={busy || !preview}
            onClick={() =>
              void run(() =>
                api.migrate(
                  crypto.randomUUID(),
                  preview!.items.filter((item) => selected.includes(item.path)),
                  preview!.libraryId,
                ),
              )
            }
          >
            {busy && <Spinner size={12} />}{' '}
            {selected.length ? `Actualizar ${selected.length} ficha(s)` : 'Preparar identidad de biblioteca'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-4 text-[12px]">
        <p>
          Se añade una identidad estable sin mover adjuntos ni cambiar tus notas. Conservamos los originales; deshacer se detiene si hay
          ediciones posteriores. La identidad del destino se conserva al preparar y trasladar la Biblioteca.
        </p>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {!preview && !error && <Spinner />}
        {preview?.warnings.map((warning, i) => (
          <p key={i} role="status" className="text-warn">
            {warning.path}: {warning.message}
          </p>
        ))}
        {preview && !preview.items.length && <p>No hay fichas antiguas que convertir. Puedes preparar la identidad para un traslado.</p>}
        {preview?.items
          .filter((item) => !onlyPath || item.path === onlyPath)
          .map((item) => (
            <article key={item.path} className="rounded border border-line bg-soft p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(item.path)}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.checked ? [...selected, item.path] : selected.filter((p) => p !== item.path))}
                />
                <span className="font-medium">{item.title}</span>
              </label>
              <p className="mt-1 break-all text-faint">{item.path}</p>
              {item.warnings.map((warning) => (
                <p key={warning} className="text-warn">
                  {warning}
                </p>
              ))}
              <details className="mt-1">
                <summary className="cursor-pointer text-accent">Ver contenido propuesto</summary>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap pt-2">{item.after}</pre>
              </details>
            </article>
          ))}
        {!!preview?.operations.length && (
          <section className="space-y-2">
            <h3 className="font-semibold">Operaciones y recuperación</h3>
            {preview.operations.map((op) => (
              <div key={op.id} className="rounded border border-line p-2">
                <p>
                  {op.createdAt.slice(0, 19).replace('T', ' ')} · {op.applied}/{op.total} fichas ·{' '}
                  {op.state === 'done'
                    ? 'Completada'
                    : op.state === 'undone'
                      ? 'Deshecha'
                      : op.state === 'undoing'
                        ? 'Deshacer pendiente'
                        : 'Interrumpida'}
                </p>
                {op.error && <p className="text-warn">{op.error}</p>}
                {(op.state === 'prepared' || op.state === 'undoing') && (
                  <Button disabled={busy} onClick={() => void run(() => api.retryMigration(op.id))}>
                    Reintentar operación
                  </Button>
                )}
                {op.state !== 'undone' && (
                  <Button disabled={busy} onClick={() => void run(() => api.undoMigration(op.id))}>
                    Deshacer conversión
                  </Button>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </Modal>
  );
}
