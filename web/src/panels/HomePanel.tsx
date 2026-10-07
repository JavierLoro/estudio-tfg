import { useEffect } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, FileCode2, FileText, Inbox, Play, Plus, XCircle } from 'lucide-react';
import { Button, Empty, Spinner } from '../components/ui';
import { kbd } from '../lib/kbd';
import { basename, formatDate, hostOf } from '../lib/paths';
import { countDiags, isPdfOutdated, useCompile } from '../state/compile';
import { useCaptureQueue } from '../state/captureQueue';
import { SIDEBAR_DEFAULT, useUI } from '../state/ui';
import { openFile, openPdf, openResource, resetLayout } from '../state/workspace';
import { saveAndCompile } from './LatexPanel';
import { formatDuration } from './PdfPanel';

function Card({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-bg">
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-line px-3 text-[12px] font-semibold">
        {icon}
        <span className="flex-1">{title}</span>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-auto py-1">{children}</div>
    </section>
  );
}

export function HomePanel() {
  const recents = useUI((s) => s.recents);
  const resources = useUI((s) => s.resources);
  const status = useUI((s) => s.status);
  const last = useCompile((s) => s.last);
  const compiling = useCompile((s) => s.compiling);
  const outdated = useCompile(isPdfOutdated);
  const queued = useCaptureQueue((s) => s.items.length);
  const inbox = (resources ?? []).filter((r) => r.status === 'inbox');
  const { errors, warnings } = countDiags(last?.diagnostics);

  useEffect(() => {
    void useUI.getState().refreshResources();
    void useCompile.getState().fetchLast();
  }, []);

  return (
    <div className="@container h-full overflow-auto bg-soft p-3">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 @2xl:grid-cols-2">
        <Card
          title="Memoria"
          icon={<FileCode2 size={14} className="text-muted" />}
          action={
            <Button variant="primary" onClick={() => saveAndCompile()} disabled={compiling}>
              {compiling ? <Spinner size={11} /> : <Play size={12} />} Compilar
            </Button>
          }
        >
          <div className="space-y-2 px-3 py-2 text-[12.5px]">
            {!last && !compiling && <p className="text-muted">Aún no hay compilaciones.</p>}
            {compiling && (
              <p className="flex items-center gap-2 text-muted">
                <Spinner size={12} /> Compilando…
              </p>
            )}
            {last && (
              <>
                <p className="flex items-center gap-2">
                  {last.ok ? <CheckCircle2 size={15} className="text-ok" /> : <XCircle size={15} className="text-danger" />}
                  <span className="font-medium">{last.ok ? 'Última compilación correcta' : 'La última compilación falló'}</span>
                </p>
                <p className="flex flex-wrap items-center gap-3 text-muted">
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {formatDate(last.startedAt)} · {formatDuration(last.durationMs)}
                  </span>
                  <span className="flex items-center gap-1 text-danger">
                    <AlertCircle size={12} /> {errors} errores
                  </span>
                  <span className="flex items-center gap-1 text-warn">
                    <AlertTriangle size={12} /> {warnings} avisos
                  </span>
                </p>
                {outdated && <p className="text-warn">El PDF está desactualizado respecto a los últimos cambios guardados.</p>}
              </>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button onClick={() => openFile('memoria', status?.memoriaMain ?? 'tfg.tex')}>Abrir {status?.memoriaMain ?? 'tfg.tex'}</Button>
              <Button onClick={() => openPdf()}>Ver PDF</Button>
            </div>
            {status?.worker === 'down' && (
              <p className="text-danger">El worker de LaTeX no responde: no se podrá compilar hasta que arranque.</p>
            )}
          </div>
        </Card>

        <Card
          title={`Recursos en bandeja${resources ? ` (${inbox.length})` : ''}`}
          icon={<Inbox size={14} className="text-muted" />}
          action={
            <Button onClick={() => useUI.getState().setCaptureOpen(true)} title={`Capturar (${kbd('Mod-Shift-C')})`}>
              <Plus size={12} /> Capturar
            </Button>
          }
        >
          {queued > 0 && (
            <p className="px-3 py-1 text-[12px] text-warn">{queued} captura(s) pendientes de enviar (sin conexión). Se reintentará automáticamente.</p>
          )}
          {!resources && (
            <div className="flex justify-center py-3 text-muted">
              <Spinner />
            </div>
          )}
          {resources && inbox.length === 0 && <Empty>Bandeja vacía. ¡Bien!</Empty>}
          <ul>
            {inbox.slice(0, 12).map((r) => (
              <li key={r.path}>
                <button type="button" className="w-full px-3 py-1 text-left hover:bg-hover" onClick={(e) => openResource(r.path, { side: e.altKey })}>
                  <div className="truncate text-[12.5px] font-medium">{r.title}</div>
                  <div className="truncate text-[11px] text-faint">
                    {formatDate(r.captured)}
                    {r.url ? ` · ${hostOf(r.url)}` : ''}
                    {r.attachment ? ' · adjunto' : ''}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {inbox.length > 12 && (
            <button type="button" className="px-3 py-1 text-[12px] text-accent hover:underline" onClick={() => useUI.getState().setSection('resources')}>
              Ver los {inbox.length} recursos…
            </button>
          )}
        </Card>

        <Card title="Abiertos recientemente" icon={<Clock size={14} className="text-muted" />}>
          {recents.length === 0 && <Empty>Todavía no has abierto nada.</Empty>}
          <ul>
            {recents.slice(0, 15).map((r) => (
              <li key={`${r.root}:${r.path}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover"
                  onClick={(e) => openFile(r.root, r.path, { side: e.altKey })}
                  title={r.path}
                >
                  {r.root === 'memoria' ? <FileCode2 size={13} className="shrink-0 text-muted" /> : <FileText size={13} className="shrink-0 text-muted" />}
                  <span className="truncate text-[12.5px]">{basename(r.path)}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{r.path}</span>
                  <span className="shrink-0 text-[11px] text-faint">{formatDate(r.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Atajos" icon={<FileText size={14} className="text-muted" />}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 py-2 text-[12px]">
            <dt className="font-mono text-muted">{kbd('Mod-K')}</dt>
            <dd>Abrir archivo o buscar</dd>
            <dt className="font-mono text-muted">{kbd('Mod-Shift-C')}</dt>
            <dd>Capturar recurso (URL, nota, adjunto)</dd>
            <dt className="font-mono text-muted">{kbd('Mod-S')}</dt>
            <dd>Guardar</dd>
            <dt className="font-mono text-muted">{kbd('Mod-Enter')}</dt>
            <dd>Guardar y compilar (LaTeX)</dd>
            <dt className="font-mono text-muted">{kbd('Mod-E')}</dt>
            <dd>Leer / editar nota</dd>
            <dt className="font-mono text-muted">{kbd('Mod-F')}</dt>
            <dd>Buscar en el editor</dd>
            <dt className="font-mono text-muted">{kbd('Alt-clic')}</dt>
            <dd>Abrir al lado</dd>
            <dt className="font-mono text-muted">{kbd('Mod-B')}</dt>
            <dd>Mostrar / ocultar el panel lateral (arrastra su borde para cambiar el ancho)</dd>
          </dl>
        </Card>
      </div>
      <div className="mx-auto mt-3 max-w-5xl px-1">
        <button
          type="button"
          className="text-[11.5px] text-muted hover:text-fg hover:underline"
          onClick={() => {
            resetLayout();
            useUI.getState().setSidebarWidth(SIDEBAR_DEFAULT);
          }}
        >
          Restablecer distribución de paneles
        </button>
      </div>
    </div>
  );
}
