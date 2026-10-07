import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, Inbox, Plus, Search, ServerCrash } from 'lucide-react';
import { saveAll, useGlobalSaveState } from '../state/docs';
import { useCaptureQueue, flushCaptureQueue } from '../state/captureQueue';
import { useConnection } from '../state/events';
import { useUI } from '../state/ui';
import { kbd } from '../lib/kbd';
import { Button, Spinner, cx } from './ui';

export function Header() {
  const setQuickOpen = useUI((s) => s.setQuickOpen);
  const setCaptureOpen = useUI((s) => s.setCaptureOpen);
  const status = useUI((s) => s.status);
  const statusError = useUI((s) => s.statusError);
  const connected = useConnection((s) => s.connected);
  const queued = useCaptureQueue((s) => s.items.length);
  const [dirty, conflicts, saving] = useGlobalSaveState().split('|').map(Number);

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-soft px-3">
      <div className="flex items-center gap-1.5 pr-2 text-[13px] font-semibold">
        <span className="inline-flex h-5 items-center rounded bg-accent px-1 text-[10px] font-bold text-accent-fg">TFG</span>
        <span>Estudio</span>
      </div>

      <button
        type="button"
        onClick={() => setQuickOpen(true)}
        className="flex h-7 w-full max-w-[420px] min-w-0 items-center gap-2 rounded-md border border-line bg-bg px-2 text-[12px] text-faint hover:border-line-strong"
        aria-label={`Abrir o buscar (${kbd('Mod-K')})`}
      >
        <Search size={13} />
        <span className="flex-1 truncate text-left">Abrir archivo o buscar…</span>
        <kbd className="rounded border border-line px-1 font-mono text-[10.5px]">{kbd('Mod-K')}</kbd>
      </button>

      <div className="flex-1" />

      {/* Estado global de guardado */}
      <div className="flex items-center gap-1.5 text-[12px]" aria-live="polite">
        {saving > 0 ? (
          <span className="flex items-center gap-1.5 text-muted">
            <Spinner size={11} /> Guardando…
          </span>
        ) : conflicts > 0 ? (
          <span className="flex items-center gap-1 font-medium text-danger">
            <AlertTriangle size={13} /> {conflicts === 1 ? '1 conflicto' : `${conflicts} conflictos`}
          </span>
        ) : dirty > 0 ? (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-warn hover:bg-hover"
            onClick={() => void saveAll()}
            title={`Guardar todo`}
          >
            <span className="h-2 w-2 rounded-full bg-warn" /> {dirty === 1 ? '1 sin guardar' : `${dirty} sin guardar`}
          </button>
        ) : (
          <span className="flex items-center gap-1 text-muted">
            <CheckCircle2 size={13} className="text-ok" /> Todo guardado
          </span>
        )}
      </div>

      {queued > 0 && (
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-warn hover:bg-hover"
          onClick={() => void flushCaptureQueue()}
          title="Capturas guardadas localmente pendientes de enviar. Clic para reintentar."
        >
          <Inbox size={13} /> {queued} pendiente{queued > 1 ? 's' : ''}
        </button>
      )}

      {(!connected || statusError) && (
        <span className="flex items-center gap-1 text-[12px] text-danger" title={statusError ?? 'Sin conexión en tiempo real con el servidor'}>
          <CloudOff size={13} /> Sin conexión
        </span>
      )}
      {status?.worker === 'down' && (
        <span className="flex items-center gap-1 text-[12px] text-warn" title="El worker de LaTeX no responde">
          <ServerCrash size={13} /> LaTeX
        </span>
      )}

      <SyncConflicts list={status?.syncConflicts ?? []} />
      {status?.watcher === 'error' && (
        <span role="status" className="flex items-center gap-1 text-[12px] text-warn" title={status.watcherMessage}>
          <AlertTriangle size={13} /> Cambios en disco sin vigilar
        </span>
      )}

      <Button variant="primary" onClick={() => setCaptureOpen(true)} title={`Capturar (${kbd('Mod-Shift-C')})`} className="h-7!">
        <Plus size={13} /> Capturar
      </Button>
    </header>
  );
}

function SyncConflicts({ list }: { list: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  if (!list.length) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cx('flex h-6 items-center gap-1 rounded-full bg-warn-bg px-2 text-[11.5px] font-semibold text-warn')}
        title="Conflictos de Syncthing"
      >
        <AlertTriangle size={12} /> {list.length} conflicto{list.length > 1 ? 's' : ''} Syncthing
      </button>
      {open && (
        <div className="absolute top-8 right-0 z-[900] w-[380px] rounded-md border border-line bg-bg p-2 shadow-pop">
          <p className="mb-1.5 text-[12px] text-muted">
            Syncthing ha creado copias en conflicto. Revísalas y bórralas a mano cuando hayas fusionado los cambios:
          </p>
          <ul className="max-h-[260px] space-y-0.5 overflow-auto">
            {list.map((p) => (
              <li key={p} className="truncate font-mono text-[11px]" title={p}>
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
