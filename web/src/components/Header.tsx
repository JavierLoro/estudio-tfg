import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, Inbox, Plus, ServerCrash, Upload } from 'lucide-react';
import { saveAll, useGlobalSaveState } from '../state/docs';
import { useCaptureQueue } from '../state/captureQueue';
import { useConnection } from '../state/events';
import { useUI } from '../state/ui';
import { kbd } from '../lib/kbd';
import { shortcutFor } from '../lib/shortcuts';
import { Button, Modal, Spinner, cx } from './ui';
import { Rail } from './Rail';
import { openSettings } from '../state/workspace';
import { useDesktop } from '../state/desktop';
import { openFileImport } from './FileImportDialog';

export function Header() {
  const importInput = useRef<HTMLInputElement>(null);
  const setCaptureOpen = useUI((s) => s.setCaptureOpen);
  const status = useUI((s) => s.status);
  const statusError = useUI((s) => s.statusError);
  const connected = useConnection((s) => s.connected);
  const queueError = useCaptureQueue((s) => s.error);
  const queued = useCaptureQueue((s) => s.items.length);
  const [dirty, conflicts, saving] = useGlobalSaveState().split('|').map(Number);
  const [motorOpen, setMotorOpen] = useState(false);
  const desktop = useDesktop(s => !!s.info);
  const motorDown = (status?.motor?.estado ?? status?.worker) === 'down';
  const motorMessage = status?.motor?.mensaje ?? (status?.motor?.tipo === 'local'
    ? 'TeX local no está disponible. Revisa las herramientas detectadas en Ajustes.'
    : 'El servidor no pudo conectar con el servicio de compilación de Docker.');

  return (
    <header className="et-header shrink-0 border-b border-line bg-bg">
      <div className="et-main-nav flex min-w-0 items-center gap-5 px-4">
        <Rail />
        <div className="flex shrink-0 items-center gap-3">
          {/* Estado global de guardado */}
          <div className="flex items-center gap-1.5 text-[12px]" aria-live="polite">
            {saving > 0 ? (
              <span className="flex items-center gap-1.5 text-muted" title="Guardando…">
                <Spinner size={11} /> <span className="sr-only xl:not-sr-only">Guardando…</span>
              </span>
            ) : conflicts > 0 ? (
              <span className="flex items-center gap-1 whitespace-nowrap font-medium text-danger" title={`${conflicts} conflicto${conflicts > 1 ? 's' : ''}`}>
                <AlertTriangle size={13} /> {conflicts === 1 ? '1 conflicto' : `${conflicts} conflictos`}
              </span>
            ) : dirty > 0 ? (
              <button
                type="button"
                className="flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-warn hover:bg-hover"
                onClick={() => void saveAll()}
                title={`Guardar todo`}
              >
                <span className="h-2 w-2 rounded-full bg-warn" /> {dirty === 1 ? '1 sin guardar' : `${dirty} sin guardar`}
              </button>
            ) : (
              <span className="flex items-center gap-1 text-muted" title="Todo guardado">
                <CheckCircle2 size={13} className="text-ok" /> <span className="sr-only xl:not-sr-only">Todo guardado</span>
              </span>
            )}
          </div>

          {(queued > 0 || queueError) && (
            <button
              type="button"
              className="flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] text-warn hover:bg-hover"
              onClick={() => useCaptureQueue.setState({ open: true })}
              title="Capturas conservadas en este navegador. Clic para revisar, editar o reintentar."
            >
              <Inbox size={13} /> {queued > 0 ? `${queued} pendiente${queued > 1 ? 's' : ''}` : 'Revisar cola'}
            </button>
          )}

          {(!connected || statusError) && (
            <span className="flex items-center gap-1 text-[12px] text-danger" title={statusError ?? 'Sin conexión en tiempo real con el servidor'}>
              <CloudOff size={13} /> <span className="sr-only xl:not-sr-only">Sin conexión</span>
            </span>
          )}
          {motorDown && (
            <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-warn hover:bg-hover" title={`${motorMessage} Pulsa para ver los detalles.`} aria-label="Motor PDF no disponible: ver motivo" aria-haspopup="dialog" onClick={() => setMotorOpen(true)}>
              <ServerCrash size={13} /> <span className="sr-only xl:not-sr-only">Motor PDF no disponible</span>
            </button>
          )}

          <Button aria-label="Importar archivos" onClick={() => importInput.current?.click()} title="Importar archivos y elegir destino" className="h-7!">
            <Upload size={13} /> <span className="hidden sm:inline">Importar archivos</span>
          </Button>
          <input ref={importInput} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Archivos para importar" onChange={e => { openFileImport(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          <SyncConflicts list={status?.syncConflicts ?? []} />
          {status?.watcher === 'error' && (
            <span role="status" className="flex items-center gap-1 text-[12px] text-warn" title={status.watcherMessage}>
              <AlertTriangle size={13} /> <span className="sr-only xl:not-sr-only">Cambios en disco sin vigilar</span>
            </span>
          )}

          <Button variant="primary" onClick={() => setCaptureOpen(true)} title={`Añadir a Biblioteca (${kbd(shortcutFor('capture'))})`} className="h-7!">
            <Plus size={13} /> Añadir
          </Button>
        </div>
      </div>
      <Modal open={motorOpen} onClose={() => setMotorOpen(false)} title={motorDown ? 'Motor PDF no disponible' : 'Motor PDF disponible'} footer={<>
        <Button onClick={() => setMotorOpen(false)}>Cerrar</Button>
        <Button variant="primary" onClick={() => { setMotorOpen(false); openSettings(); }}>Abrir Ajustes</Button>
      </>}>
        <div className="space-y-3 p-4 text-[13px]">
          <p>Motor seleccionado: <strong>{status?.motor?.seleccion === 'auto' ? 'Automático' : status?.motor?.tipo === 'local' ? 'TeX local' : 'Docker'}</strong>.</p>
          <p className={motorDown ? 'text-warn' : 'text-ok'}>{motorDown ? motorMessage : 'El motor vuelve a estar disponible para compilar.'}</p>
          {motorDown && <p className="text-muted">{status?.motor?.tipo === 'local'
            ? 'Abre Ajustes y pulsa «Detectar herramientas» para revisar qué falta y los motores disponibles.'
            : 'Comprueba que Docker y el servicio de compilación estén en marcha, o elige otro motor en Ajustes.'}</p>}
          {!desktop && <p className="text-muted">La compilación se realiza en el equipo donde se ejecuta el servidor de Estudio TFG, no en este navegador.</p>}
        </div>
      </Modal>
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
