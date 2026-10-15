import { lazy, Suspense, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, FileText, Play, XCircle } from 'lucide-react';
import { api } from '../api';
import { Banner, Button, Spinner, buttonClass } from '../components/ui';
import { countDiags, isPdfOutdated, useCompile } from '../state/compile';
import { kbd } from '../lib/kbd';
import { formatDate } from '../lib/paths';
import { DiagnosticList, saveAndCompile, usePlacedDiagnostics } from './LatexPanel';

// PDF.js solo se descarga al abrir el panel.
const PdfViewer = lazy(() => import('../components/PdfViewer'));

export function formatDuration(ms: number | undefined) {
  if (ms == null) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function PdfPanel() {
  const last = useCompile((s) => s.last);
  const compiling = useCompile((s) => s.compiling);
  const error = useCompile((s) => s.error);
  const outdated = useCompile(isPdfOutdated);
  const diags = usePlacedDiagnostics();
  const { errors, warnings } = countDiags(last?.diagnostics);
  const [showDiags, setShowDiags] = useState(false);

  useEffect(() => {
    if (!last) void useCompile.getState().fetchLast();
  }, [last]);

  return (
    <div className="flex h-full flex-col bg-sunken">
      <div className="flex h-(--et-toolbar) shrink-0 items-center gap-2 border-b border-line bg-bg px-2 text-sm text-muted">
        <Button variant="primary" size="sm" onClick={() => saveAndCompile()} disabled={compiling} title={`Compilar (${kbd('Mod-Enter')} en el editor)`}>
          {compiling ? <Spinner size={14} /> : <Play size={15} />}
          {compiling ? 'Compilando…' : 'Compilar'}
        </Button>
        {last && !compiling && (
          <span className="flex min-w-0 items-center gap-2 truncate">
            {last.ok ? <CheckCircle2 size={16} className="shrink-0 text-ok" /> : <XCircle size={16} className="shrink-0 text-danger" />}
            <span title={`Inicio: ${formatDate(last.startedAt)}`}>
              {last.ok ? 'Correcta' : 'Con errores'} · {formatDuration(last.durationMs)}
            </span>
            {(errors > 0 || warnings > 0) && (
              <Button
                variant="subtle"
                size="sm"
                className="gap-2 px-1.5"
                onClick={() => setShowDiags((v) => !v)}
                aria-expanded={showDiags}
                title={`Ver diagnósticos: ${errors} errores, ${warnings} avisos`}
              >
                <span className="flex items-center gap-0.5 text-danger">
                  <AlertCircle size={15} aria-label="Errores" /> {errors}
                </span>
                <span className="flex items-center gap-0.5 text-warn">
                  <AlertTriangle size={15} aria-label="Avisos" /> {warnings}
                </span>
              </Button>
            )}
          </span>
        )}
        <span className="flex-1" />
        {last && (
          <a className={buttonClass('subtle', 'sm')} href={api.logUrl(last.buildId)} target="_blank" rel="noreferrer" title="Ver log de LaTeX">
            <FileText size={15} /> Log
          </a>
        )}
        {last?.pdfUrl && (
          <a className={buttonClass('subtle', 'sm')} href={last.pdfUrl} target="_blank" rel="noreferrer" title="Abrir el PDF en una pestaña" aria-label="Abrir el PDF en una pestaña">
            <ExternalLink size={15} />
          </a>
        )}
      </div>
      {error && <Banner kind="danger">No se pudo compilar: {error}</Banner>}
      {outdated && !compiling && (
        <Banner
          kind="warn"
          actions={
            <Button size="sm" onClick={() => saveAndCompile()} disabled={compiling}>
              Compilar ahora
            </Button>
          }
        >
          PDF desactualizado: hay cambios guardados en la memoria posteriores a la última compilación.
        </Banner>
      )}
      {last && !last.ok && last.pdfUrl && <Banner kind="info">La última compilación falló; se muestra el último PDF correcto.</Banner>}
      {showDiags && diags.length > 0 && (
        <div className="max-h-[40%] shrink-0 overflow-auto border-b border-line bg-soft">
          <DiagnosticList items={diags} />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {last?.pdfUrl ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted">
                <Spinner size={18} />
              </div>
            }
          >
            <PdfViewer url={last.pdfUrl} />
          </Suspense>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ui text-muted">
            {compiling ? (
              <>
                <Spinner size={18} /> Compilando la memoria…
              </>
            ) : (
              <>
                <FileText size={28} className="text-muted" />
                {last ? 'La compilación no generó PDF.' : 'Aún no hay ninguna compilación.'}
                <Button variant="primary" onClick={() => saveAndCompile()}>
                  <Play size={15} /> Compilar
                </Button>
              </>
            )}
          </div>
        )}
        {compiling && last?.pdfUrl && (
          <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1 text-sm text-muted shadow-pop">
            <Spinner size={14} /> Compilando…
          </div>
        )}
      </div>
    </div>
  );
}
