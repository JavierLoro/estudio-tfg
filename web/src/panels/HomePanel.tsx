import { useEffect } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, FileCode2, FileText, Inbox, Play, Plus, XCircle } from 'lucide-react';
import { Banner, Button, Empty, Spinner } from '../components/ui';
import { openActions } from '../components/OpenActions';
import { isMac, kbd } from '../lib/kbd';
import { sideHint, shortcutFor } from '../lib/shortcuts';
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
      <header className="flex min-h-(--et-toolbar) shrink-0 items-center gap-2 border-b border-line px-3 py-1">
        <span className="flex text-muted" aria-hidden>{icon}</span>
        <h2 className="flex-1 text-ui font-bold">{title}</h2>
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
  const inbox = resources ?? [];
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
          icon={<FileCode2 size={16} />}
          action={
            <Button variant="primary" size="sm" onClick={() => saveAndCompile()} disabled={compiling}>
              {compiling ? <Spinner size={14} /> : <Play size={14} />} Compilar
            </Button>
          }
        >
          <div className="space-y-2 px-3 py-2 text-ui">
            {!last && !compiling && <p className="text-muted">Aún no hay compilaciones.</p>}
            {compiling && (
              <p className="flex items-center gap-2 text-muted">
                <Spinner size={14} /> Compilando…
              </p>
            )}
            {last && (
              <>
                <p className="flex items-center gap-2">
                  {last.ok ? <CheckCircle2 size={16} className="shrink-0 text-ok" aria-hidden /> : <XCircle size={16} className="shrink-0 text-danger" aria-hidden />}
                  <span className="font-medium">{last.ok ? 'Última compilación correcta' : 'La última compilación falló'}</span>
                </p>
                <p className="flex flex-wrap items-center gap-3 text-muted">
                  <span className="flex items-center gap-1">
                    <Clock size={14} aria-hidden /> {formatDate(last.startedAt)} · {formatDuration(last.durationMs)}
                  </span>
                  <span className="flex items-center gap-1 text-danger">
                    <AlertCircle size={14} aria-hidden /> {errors} errores
                  </span>
                  <span className="flex items-center gap-1 text-warn">
                    <AlertTriangle size={14} aria-hidden /> {warnings} avisos
                  </span>
                </p>
                {outdated && <Banner kind="warn" inline>El PDF está desactualizado respecto a los últimos cambios guardados.</Banner>}
              </>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button onClick={() => openFile('memoria', status?.memoriaMain ?? 'tfg.tex')}>Abrir {status?.memoriaMain ?? 'tfg.tex'}</Button>
              <Button onClick={() => openPdf()}>Ver PDF</Button>
            </div>
            {(status?.motor?.estado ?? status?.worker) === 'down' && (
              <Banner kind="danger" inline>{status?.motor?.tipo === 'local' ? 'TeX del sistema no está disponible: revisa las herramientas detectadas en Ajustes.' : 'El worker de LaTeX no responde: no se podrá compilar hasta que arranque.'}</Banner>
            )}
          </div>
        </Card>

        <Card
          title={`Biblioteca${resources ? ` (${inbox.length})` : ''}`}
          icon={<Inbox size={16} />}
          action={
            <Button size="sm" onClick={() => useUI.getState().setCaptureOpen(true)} title={`Añadir (${kbd(shortcutFor('capture'))})`}>
              <Plus size={14} /> Añadir
            </Button>
          }
        >
          {queued > 0 && (
            <Banner kind="warn">{queued} captura(s) pendientes de enviar (sin conexión). Se reintentará automáticamente.</Banner>
          )}
          {!resources && (
            <div className="flex justify-center py-3 text-muted">
              <Spinner />
            </div>
          )}
          {resources && inbox.length === 0 && <Empty>Tu Biblioteca está lista para empezar.</Empty>}
          <ul>
            {inbox.slice(0, 12).map((r) => (
              <li key={r.path}>
                <button type="button" className="et-focus-inset min-h-(--et-row) w-full px-3 py-1 text-left hover:bg-hover" {...openActions((side) => openResource(r.path, { side }))}>
                  <div className="truncate text-ui font-medium">{r.title}</div>
                  <div className="truncate text-sm text-muted">
                    {formatDate(r.captured)}
                    {r.url ? ` · ${hostOf(r.url)}` : ''}
                    {r.attachment ? ' · adjunto' : ''}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {inbox.length > 12 && (
            <button type="button" className="et-focus-inset min-h-(--et-row) px-3 py-1 text-ui text-accent hover:underline" onClick={() => useUI.getState().setSection('resources')}>
              Ver los {inbox.length} recursos…
            </button>
          )}
        </Card>

        <Card title="Abiertos recientemente" icon={<Clock size={16} />}>
          {recents.length === 0 && <Empty>Todavía no has abierto nada.</Empty>}
          <ul>
            {recents.slice(0, 15).map((r) => (
              <li key={`${r.root}:${r.path}`}>
                <button
                  type="button"
                  className="et-focus-inset flex min-h-(--et-row) w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover"
                  {...openActions((side) => openFile(r.root, r.path, { side }))}
                  title={r.path}
                >
                  {r.root === 'memoria' ? <FileCode2 size={16} className="shrink-0 text-muted" aria-hidden /> : <FileText size={16} className="shrink-0 text-muted" aria-hidden />}
                  <span className="truncate text-ui">{basename(r.path)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">{r.path}</span>
                  <span className="shrink-0 text-sm text-muted">{formatDate(r.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Atajos" icon={<FileText size={16} />}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 py-2 text-ui">
            <dt className="font-mono text-muted">{kbd('Mod-K')}</dt>
            <dd>Abrir archivo o buscar</dd>
            <dt className="font-mono text-muted">{kbd(shortcutFor('capture'))}</dt>
            <dd>Añadir a Biblioteca (web, archivos o ficha)</dd>
            <dt className="font-mono text-muted">{kbd('Mod-S')}</dt>
            <dd>Guardar</dd>
            <dt className="font-mono text-muted">{kbd('Mod-Enter')}</dt>
            <dd>Guardar y compilar (LaTeX)</dd>
            <dt className="font-mono text-muted">{kbd(shortcutFor('showInPdf'))}</dt>
            <dd>Ver la línea del código en el PDF</dd>
            <dt className="font-mono text-muted">{kbd('Mod-E')}</dt>
            <dd>Leer / editar nota</dd>
            <dt className="font-mono text-muted">{kbd('Mod-F')}</dt>
            <dd>Buscar en el editor</dd>
            <dt className="font-mono text-muted">{sideHint()}</dt>
            <dd>Abrir al lado (también {kbd(isMac ? 'Ctrl-Shift-clic' : 'Alt-clic')}, clic central o menú contextual)</dd>
            <dt className="font-mono text-muted">{kbd('Mod-B')}</dt>
            <dd>Mostrar / ocultar el panel lateral (arrastra su borde para cambiar el ancho)</dd>
          </dl>
        </Card>
      </div>
      <div className="mx-auto mt-3 max-w-5xl px-1">
        <Button
          variant="subtle"
          size="sm"
          className="font-normal! text-muted!"
          onClick={() => {
            resetLayout();
            useUI.getState().setSidebarWidth(SIDEBAR_DEFAULT);
          }}
        >
          Restablecer distribución de paneles
        </Button>
      </div>
    </div>
  );
}
