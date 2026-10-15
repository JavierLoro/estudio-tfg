import { useEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { ResourceKind } from '../api';
import { submitCaptureBatch, useCaptureQueue, type CaptureOutcome } from '../state/captureQueue';
import { useUI } from '../state/ui';
import { openResource } from '../state/workspace';
import { KIND_LABEL, kinds } from '../lib/library';
import { Banner, Button, Field, IconButton, Input, Modal, Select, Spinner, Textarea, cx } from './ui';

export function CaptureModal() {
  const open = useUI((s) => s.captureOpen),
    setOpen = useUI((s) => s.setCaptureOpen);
  const pending = useCaptureQueue((s) => s.items);
  const [url, setUrl] = useState(''),
    [title, setTitle] = useState(''),
    [note, setNote] = useState('');
  const [tags, setTags] = useState(''),
    [collections, setCollections] = useState(''),
    [kind, setKind] = useState('');
  const [files, setFiles] = useState<File[]>([]),
    [group, setGroup] = useState(false),
    [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<{ label: string; result: CaptureOutcome }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setError('');
      setReport([]);
    }
  }, [open]);
  const canSave = !!(url.trim() || title.trim() || note.trim() || files.length) && !busy;
  const take = (next: File[]) => {
    setFiles((previous) => [...previous, ...next]);
    setError(next.some((file) => file.size > 50 * 1024 * 1024) ? 'Cada archivo debe ser menor de 50 MB.' : '');
  };
  const submit = async () => {
    if (!canSave) return;
    if (files.some((file) => file.size > 50 * 1024 * 1024)) {
      setError('Cada archivo debe ser menor de 50 MB.');
      return;
    }
    setBusy(true);
    setError('');
    const common = { url, title, note, tags, collections, kind: kind ? (kind as ResourceKind) : undefined, libraryVersion: 1 as const };
    const inputs =
      files.length > 1 && !group
        ? files.map((file) => ({ ...common, title: title.trim() ? `${title} — ${file.name}` : undefined, files: [file] }))
        : [{ ...common, files }];
    const labels =
      files.length > 1 && !group ? files.map((file) => file.name) : [title.trim() || url.trim() || files[0]?.name || 'Ficha manual'];
    setProgress({ done: 0, total: inputs.length });
    const response = await submitCaptureBatch(inputs, (done, total) => setProgress({ done, total }));
    setBusy(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    setReport(response.outcomes.map((result, i) => ({ label: labels[i], result })));
    setFiles([]);
    setTitle('');
    setUrl('');
    setNote('');
    setTags('');
    setCollections('');
    setKind('');
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) setOpen(false);
      }}
      title="Añadir a Biblioteca"
      width={660}
      footer={
        <>
          <span className="mr-auto text-sm text-muted">La clasificación es opcional.</span>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            {report.length ? 'Listo' : 'Cancelar'}
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={() => void submit()}>
            {busy && <Spinner size={14} />} Añadir
          </Button>
        </>
      }
    >
      <div
        className={cx('space-y-3 p-4', drag && 'bg-active')}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDrag(true);
          }
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) take(Array.from(e.dataTransfer.files));
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length && !busy) {
            e.preventDefault();
            take(Array.from(e.clipboardData.files));
          }
        }}
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            !e.nativeEvent.isComposing &&
            (e.target as HTMLElement).tagName === 'INPUT' &&
            !['checkbox', 'file'].includes((e.target as HTMLInputElement).type)
          ) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <p className="text-ui text-muted">
          Pega una URL, añade archivos o crea una ficha con un título. Puedes completar sus datos después.
        </p>
        <Field label="URL">
          <Input disabled={busy} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Título">
          <Input disabled={busy} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Opcional para webs y archivos" />
        </Field>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex min-h-20 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-soft px-3 text-ui text-muted transition-colors enabled:hover:border-accent enabled:hover:text-fg disabled:opacity-50"
        >
          <Upload size={18} aria-hidden /> Arrastra archivos, pégalos o haz clic para elegirlos
        </button>
        <input
          type="file"
          multiple
          tabIndex={-1}
          ref={fileRef}
          aria-label="Seleccionar archivos para Biblioteca"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            take(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        {!!files.length && (
          <ul className="max-h-36 overflow-auto space-y-1 text-ui">
            {files.map((file, i) => (
              <li key={i} className="flex min-h-(--et-row) items-center gap-2 rounded-md bg-soft py-0.5 pr-0.5 pl-3">
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="text-muted">{(file.size / 1024).toFixed(0)} KB</span>
                <IconButton
                  disabled={busy}
                  label={`Quitar ${file.name}`}
                  onClick={() => setFiles(files.filter((_, index) => index !== i))}
                >
                  <X size={16} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {files.length > 1 && (
          <label className="flex items-start gap-2 text-ui">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--et-accent)]" disabled={busy} checked={group} onChange={(e) => setGroup(e.target.checked)} /> Agrupar estos archivos en
            una sola ficha (por defecto, un recurso por archivo)
          </label>
        )}
        <Field label="Notas">
          <Textarea
            disabled={busy}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ideas, por qué es útil, qué quieres recordar…"
          />
        </Field>
        <details>
          <summary className="flex min-h-(--et-row) cursor-pointer items-center text-ui font-bold text-accent">Tipo y organización opcionales</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Tipo">
              <Select disabled={busy} value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">Detectar automáticamente</option>
                {kinds.map((value) => (
                  <option value={value} key={value}>
                    {KIND_LABEL[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Colecciones">
              <Input disabled={busy} value={collections} onChange={(e) => setCollections(e.target.value)} placeholder="Separadas por coma" />
            </Field>
            <Field label="Etiquetas">
              <Input disabled={busy} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Separadas por coma" />
            </Field>
          </div>
        </details>
        {busy && (
          <p role="status" className="flex items-center gap-2 text-ui text-fg">
            <Spinner size={14} /> Guardando {progress.done} de {progress.total}… El lote se conserva antes de enviarlo.
          </p>
        )}
        {error && (
          <Banner kind="danger" inline>
            {error}
          </Banner>
        )}
        {!!report.length && (
          <section aria-label="Resultado del alta" className="space-y-2 rounded-lg border border-line bg-soft p-3 text-ui">
            {report.map(({ label, result }, i) => (
              <div key={i} className="space-y-1.5">
                <p className="font-bold">
                  {label}: {result.kind === 'ok' ? 'Guardado' : 'Conservado en Pendientes'}
                </p>
                {result.kind === 'ok' ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        setOpen(false);
                        openResource(result.path);
                      }}
                    >
                      Abrir ficha
                    </Button>
                    {result.warning && (
                      <Banner kind="warn" inline>
                        {result.warning}
                      </Banner>
                    )}
                  </>
                ) : (
                  <p className="text-warn">
                    {pending.find((item) => item.id === ('operationId' in result ? result.operationId : undefined))?.lastError}
                  </p>
                )}
              </div>
            ))}
            {report.some(({ result }) => result.kind !== 'ok') && (
              <Button
                size="sm"
                onClick={() => {
                  setOpen(false);
                  useCaptureQueue.setState({ open: true });
                }}
              >
                Revisar pendientes y reintentar
              </Button>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
