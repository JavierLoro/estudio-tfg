import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorMessage, type MigrationPreview } from '../api';
import { toast, useUI } from '../state/ui';
import { Banner, Button, EmptyState, Modal, Spinner } from './ui';

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
            {busy && <Spinner size={14} />}{' '}
            {selected.length ? `Actualizar ${selected.length} ficha(s)` : 'Preparar identidad de biblioteca'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-4 text-ui">
        <p>
          Se añade una identidad estable sin mover adjuntos ni cambiar tus notas. Conservamos los originales; deshacer se detiene si hay
          ediciones posteriores. La identidad del destino se conserva al preparar y trasladar la Biblioteca.
        </p>
        {error && (
          <Banner kind="danger" inline>
            {error}
          </Banner>
        )}
        {!preview && !error && <Spinner />}
        {preview?.warnings.map((warning, i) => (
          <Banner key={i} kind="warn" inline>
            {warning.path}: {warning.message}
          </Banner>
        ))}
        {preview && !preview.items.length && (
          <EmptyState className="text-ui!">No hay fichas antiguas que convertir. Puedes preparar la identidad para un traslado.</EmptyState>
        )}
        {preview?.items
          .filter((item) => !onlyPath || item.path === onlyPath)
          .map((item) => (
            <article key={item.path} className="rounded-lg border border-line bg-soft p-3">
              <label className="flex min-h-(--et-row) items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-[var(--et-accent)]"
                  checked={selected.includes(item.path)}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.checked ? [...selected, item.path] : selected.filter((p) => p !== item.path))}
                />
                <span className="font-bold">{item.title}</span>
              </label>
              <p className="mt-1 break-all text-muted">{item.path}</p>
              {item.warnings.map((warning) => (
                <p key={warning} className="mt-1 flex items-start gap-1 text-warn">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{warning}</span>
                </p>
              ))}
              <details className="mt-1">
                <summary className="flex min-h-(--et-row) cursor-pointer items-center text-accent">Ver contenido propuesto</summary>
                <pre className="max-h-52 overflow-auto pt-2 font-mono text-sm whitespace-pre-wrap">{item.after}</pre>
              </details>
            </article>
          ))}
        {!!preview?.operations.length && (
          <section className="space-y-2">
            <h3 className="font-bold">Operaciones y recuperación</h3>
            {preview.operations.map((op) => (
              <div key={op.id} className="space-y-2 rounded-lg border border-line p-3">
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
                {op.error && (
                  <Banner kind="warn" inline>
                    {op.error}
                  </Banner>
                )}
                {(op.state === 'prepared' || op.state === 'undoing') && (
                  <Button size="sm" className="mr-2" disabled={busy} onClick={() => void run(() => api.retryMigration(op.id))}>
                    Reintentar operación
                  </Button>
                )}
                {op.state !== 'undone' && (
                  <Button size="sm" disabled={busy} onClick={() => void run(() => api.undoMigration(op.id))}>
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
