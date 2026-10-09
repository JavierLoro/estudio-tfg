import { useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, X } from 'lucide-react';
import { submitCapture } from '../state/captureQueue';
import { toast, useUI } from '../state/ui';
import { openResource } from '../state/workspace';
import { kbd } from '../lib/kbd';
import { shortcutFor } from '../lib/shortcuts';
import { Button, Modal, Spinner, cx } from './ui';

const MAX_FILE = 50 * 1024 * 1024;

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function CaptureModal() {
  const open = useUI((s) => s.captureOpen);
  const setOpen = useUI((s) => s.setCaptureOpen);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);

  }, [open]);

  const reset = () => {
    setUrl('');
    setNote('');
    setTitle('');
    setTags('');
    setFile(null);
    setError(null);
  };

  const canSave = !!(url.trim() || note.trim() || file) && !busy;

  const submit = async () => {
    if (!canSave) {
      if (!busy) setError('Indica al menos una URL, una nota o un adjunto.');
      return;
    }
    if (file && file.size > MAX_FILE) {
      setError('El adjunto supera el máximo de 50 MB.');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await submitCapture({ url, note, title, tags, file });
    setBusy(false);
    if (r.kind === 'ok') {
      toast({ kind: 'ok', text: `Guardado en ${r.path}`, action: { label: 'Abrir', run: () => openResource(r.path) } });
      reset();
      setOpen(false);
    } else if (r.kind === 'queued') {
      toast({ kind: 'warn', text: 'Captura conservada en este navegador. Abre Pendientes para revisar el envío.' });
      reset();
      setOpen(false);
    } else {
      setError(r.message);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const isTextarea = (e.target as HTMLElement).tagName === 'TEXTAREA';
    // Enter guarda; en la nota, Shift-Enter hace salto de línea.
    if (isTextarea && e.shiftKey) return;
    e.preventDefault();
    void submit();
  };

  const takeFile = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setError(f.size > MAX_FILE ? 'El adjunto supera el máximo de 50 MB.' : null);
  };

  const input = 'h-8 w-full rounded-md border border-line-strong bg-bg px-2 text-[13px] outline-none focus:border-accent';

  return (
    <Modal
      open={open}
      onClose={() => !busy && setOpen(false)}
      title="Capturar recurso"
      labelledBy="et-capture-title"
      width={540}
      footer={
        <>
          <span className="mr-auto text-[11px] text-faint">{kbd('Enter')} guarda · {kbd('Shift-Enter')} salto de línea en la nota · {kbd(shortcutFor('capture'))} abre</span>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSave}>
            {busy && <Spinner size={11} />} Guardar
          </Button>
        </>
      }
    >
      <div
        className={cx('space-y-2.5 p-3', drag && 'bg-active')}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDrag(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          takeFile(e.dataTransfer.files?.[0]);
        }}
        onPaste={(e) => {
          const f = e.clipboardData.files?.[0];
          if (f) {
            e.preventDefault();
            takeFile(f);
          }
        }}
      >
        <div>
          <label htmlFor="cap-url" className="mb-0.5 block text-[11.5px] font-medium text-muted">
            URL
          </label>
          <input id="cap-url" ref={urlRef} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={input} />
        </div>
        <div>
          <label htmlFor="cap-note" className="mb-0.5 block text-[11.5px] font-medium text-muted">
            Nota
          </label>
          <textarea
            id="cap-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Por qué es útil, qué capítulo, cita…"
            className={cx(input, 'h-auto resize-y py-1.5 leading-snug')}
          />
        </div>
        <div>
          <span className="mb-0.5 block text-[11.5px] font-medium text-muted">Adjunto</span>
          {file ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-soft px-2 text-[12.5px]">
              <Paperclip size={13} className="text-muted" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-[11px] text-faint">{formatSize(file.size)}</span>
              <button type="button" aria-label="Quitar adjunto" className="text-faint hover:text-danger" onClick={() => setFile(null)}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cx(
                'flex h-14 w-full items-center justify-center gap-2 rounded-md border border-dashed text-[12px] text-muted hover:border-accent hover:text-fg',
                drag ? 'border-accent text-accent' : 'border-line-strong',
              )}
            >
              <Upload size={14} /> Arrastra un archivo aquí, pégalo o haz clic para elegirlo
            </button>
          )}
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => takeFile(e.target.files?.[0])} />
        </div>
        <div className="grid grid-cols-[1fr_160px] gap-2">
          <div>
            <label htmlFor="cap-title" className="mb-0.5 block text-[11.5px] font-medium text-muted">
              Título <span className="font-normal text-faint">(opcional)</span>
            </label>
            <input id="cap-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Se toma de la página si lo dejas vacío" className={input} />
          </div>
          <div>
            <label htmlFor="cap-tags" className="mb-0.5 block text-[11.5px] font-medium text-muted">
              Etiquetas <span className="font-normal text-faint">(coma)</span>
            </label>
            <input id="cap-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cap2, estado-arte" className={input} />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
