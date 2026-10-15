import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, Inbox, Plus, Search, ServerCrash } from 'lucide-react';
import { saveAll, useGlobalSaveState } from '../state/docs';
import { useCaptureQueue } from '../state/captureQueue';
import { useConnection } from '../state/events';
import { useUI } from '../state/ui';
import { kbd } from '../lib/kbd';
import { shortcutFor } from '../lib/shortcuts';
import { Button, Spinner } from './ui';
import { IndicatorMark } from './DocBanners';

export function Header() {
  const setQuickOpen = useUI((s) => s.setQuickOpen);
  const setCaptureOpen = useUI((s) => s.setCaptureOpen);
  const status = useUI((s) => s.status);
  const statusError = useUI((s) => s.statusError);
  const connected = useConnection((s) => s.connected);
  const queueError = useCaptureQueue((s) => s.error);
  const queued = useCaptureQueue((s) => s.items.length);
  const [dirty, conflicts, saving] = useGlobalSaveState().split('|').map(Number);

  return (
    <header className="flex h-(--et-toolbar) shrink-0 items-center gap-2 border-b border-line bg-soft px-3">
      <div className="flex items-center gap-1.5 pr-2 text-ui font-bold">
        <span className="inline-flex items-center rounded bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-fg">TFG</span>
        <span>Estudio</span>
      </div>

      <button
        type="button"
        onClick={() => setQuickOpen(true)}
        className="flex h-(--et-control-sm) w-full max-w-[420px] min-w-0 items-center gap-2 rounded-md border border-line-strong bg-bg px-2.5 text-ui text-muted hover:bg-hover"
        aria-label={`Abrir o buscar (${kbd('Mod-K')})`}
      >
        <Search size={16} />
        <span className="flex-1 truncate text-left">Abrir archivo o buscar…</span>
        <kbd className="rounded border border-line px-1 font-mono text-xs">{kbd('Mod-K')}</kbd>
      </button>

      <div className="flex-1" />

      {/* Estado global de guardado */}
      <div className="flex items-center gap-1.5 text-ui" aria-live="polite">
        {saving > 0 ? (
          <span className="flex items-center gap-1.5 text-muted">
            <Spinner size={14} /> Guardando…
          </span>
        ) : conflicts > 0 ? (
          <span className="flex items-center gap-1 font-medium text-danger">
            <AlertTriangle size={16} /> {conflicts === 1 ? '1 conflicto' : `${conflicts} conflictos`}
          </span>
        ) : dirty > 0 ? (
          <Button variant="subtle" size="sm" className="text-warn!" onClick={() => void saveAll()} title="Guardar todo">
            <IndicatorMark ind="sin guardar" label={false} /> {dirty === 1 ? '1 sin guardar' : `${dirty} sin guardar`}
          </Button>
        ) : (
          <span className="flex items-center gap-1 text-muted">
            <CheckCircle2 size={16} className="text-ok" /> Todo guardado
          </span>
        )}
      </div>

      {(queued > 0 || queueError) && (
        <Button
          variant="subtle"
          size="sm"
          className="text-warn!"
          onClick={() => useCaptureQueue.setState({ open: true })}
          title="Capturas conservadas en este navegador. Clic para revisar, editar o reintentar."
        >
          <Inbox size={16} /> {queued > 0 ? `${queued} pendiente${queued > 1 ? 's' : ''}` : 'Revisar cola'}
        </Button>
      )}

      {(!connected || statusError) && (
        <span className="flex items-center gap-1 text-ui text-danger" title={statusError ?? 'Sin conexión en tiempo real con el servidor'}>
          <CloudOff size={16} /> Sin conexión
        </span>
      )}
      {(status?.motor?.estado ?? status?.worker) === 'down' && (
        <span className="flex items-center gap-1 text-ui text-warn" title={status?.motor?.tipo === 'local' ? 'TeX del sistema no está disponible; revisa Ajustes' : 'El worker de LaTeX no responde'}>
          <ServerCrash size={16} /> LaTeX
        </span>
      )}

      <SyncConflicts list={status?.syncConflicts ?? []} />
      {status?.watcher === 'error' && (
        <span role="status" className="flex items-center gap-1 text-ui text-warn" title={status.watcherMessage}>
          <AlertTriangle size={16} /> Cambios en disco sin vigilar
        </span>
      )}

      <Button variant="primary" size="sm" onClick={() => setCaptureOpen(true)} title={`Añadir (${kbd(shortcutFor('capture'))})`}>
        <Plus size={16} /> Añadir
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
        className="flex h-(--et-control-sm) items-center gap-1 rounded-full border border-warn/40 bg-warn-bg px-2.5 text-sm font-bold text-warn hover:brightness-95"
        title="Conflictos de Syncthing"
      >
        <AlertTriangle size={15} /> {list.length} conflicto{list.length > 1 ? 's' : ''} Syncthing
      </button>
      {open && (
        <div className="absolute top-full right-0 z-[900] mt-1 w-[380px] max-w-[90vw] rounded-md border border-line bg-bg p-3 shadow-pop">
          <p className="mb-1.5 text-ui text-muted">
            Syncthing ha creado copias en conflicto. Revísalas y bórralas a mano cuando hayas fusionado los cambios:
          </p>
          <ul className="max-h-[260px] space-y-0.5 overflow-auto">
            {list.map((p) => (
              <li key={p} className="truncate font-mono text-sm" title={p}>
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
