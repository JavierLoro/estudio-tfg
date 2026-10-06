import { lazy, Suspense, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, FileText, Play, XCircle } from 'lucide-react';
import { api } from '../api';
import { Banner, Button, MOD, Spinner } from '../components/ui';
import { countDiags, isPdfOutdated, useCompile } from '../state/compile';
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
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-bg px-2 text-[11.5px] text-muted">
        <Button variant="primary" onClick={() => saveAndCompile()} disabled={compiling} title={`Compilar (${MOD}↵ en el editor)`}>
          {compiling ? <Spinner size={11} /> : <Play size={12} />}
          {compiling ? 'Compilando…' : 'Compilar'}
        </Button>
        {last && !compiling && (
          <span className="flex min-w-0 items-center gap-2 truncate">
            {last.ok ? <CheckCircle2 size={13} className="text-ok" /> : <XCircle size={13} className="text-danger" />}
            <span title={`Inicio: ${formatDate(last.startedAt)}`}>
              {last.ok ? 'Correcta' : 'Con errores'} · {formatDuration(last.durationMs)}
            </span>
            {(errors > 0 || warnings > 0) && (
              <button
                type="button"
                className="flex items-center gap-2 rounded px-1 hover:bg-hover"
                onClick={() => setShowDiags((v) => !v)}
                aria-expanded={showDiags}
                title="Ver diagnósticos"
              >
                <span className="flex items-center gap-0.5 text-danger">
                  <AlertCircle size={12} /> {errors}
                </span>
                <span className="flex items-center gap-0.5 text-warn">
                  <AlertTriangle size={12} /> {warnings}
                </span>
              </button>
            )}
          </span>
        )}
        <span className="flex-1" />
        {last && (
          <a className="flex items-center gap-1 hover:text-fg" href={api.logUrl(last.buildId)} target="_blank" rel="noreferrer" title="Ver log de LaTeX">
            <FileText size={12} /> Log
          </a>
        )}
        {last?.pdfUrl && (
          <a className="flex items-center gap-1 hover:text-fg" href={last.pdfUrl} target="_blank" rel="noreferrer" title="Abrir el PDF en una pestaña">
            <ExternalLink size={12} />
          </a>
        )}
      </div>
      {error && <Banner kind="danger">No se pudo compilar: {error}</Banner>}
      {outdated && !compiling && (
        <Banner
          kind="warn"
          actions={
            <Button onClick={() => saveAndCompile()} disabled={compiling}>
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
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-muted">
            {compiling ? (
              <>
                <Spinner size={18} /> Compilando la memoria…
              </>
            ) : (
              <>
                <FileText size={28} className="text-faint" />
                {last ? 'La compilación no generó PDF.' : 'Aún no hay ninguna compilación.'}
                <Button variant="primary" onClick={() => saveAndCompile()}>
                  <Play size={12} /> Compilar
                </Button>
              </>
            )}
          </div>
        )}
        {compiling && last?.pdfUrl && (
          <div className="pointer-events-none absolute right-3 top-10 z-20 flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1 text-[11.5px] text-muted shadow-pop">
            <Spinner size={11} /> Compilando…
          </div>
        )}
      </div>
    </div>
  );
}
