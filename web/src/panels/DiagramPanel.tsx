import { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { AlertCircle, FileOutput, ImageDown, Maximize2, Minimize2, Save, SquarePlus } from 'lucide-react';
import { CodeEditor, type LineDiagnostic } from '../components/CodeEditor';
import { DocBanners, SaveIndicator } from '../components/DocBanners';
import { Banner, Button, IconButton, MOD, Spinner, cx } from '../components/ui';
import type { EstadoDiagrama } from '../api';
import type { RenderError, RenderOk } from '../lib/diagram';
import { basename, docKey, formatDate } from '../lib/paths';
import { diagramName, exportDiagram, openInsertFigure, refreshDiagramasSoon, useDiagramaItem, useDiagramas } from '../state/diagramas';
import { ensureDoc, isDirty, requestReveal, saveDoc, useDocs } from '../state/docs';
import { toast } from '../state/ui';
import type { FileParams } from '../state/workspace';

const ESTADO_LABEL: Record<EstadoDiagrama, string> = {
  'sin-exportar': 'Sin exportar',
  exportado: 'Exportada',
  desactualizado: 'Desactualizada',
};

export function EstadoBadge({ estado, title }: { estado: EstadoDiagrama; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] whitespace-nowrap',
        estado === 'exportado' && 'border-ok/40 text-ok',
        estado === 'desactualizado' && 'border-warn/40 bg-warn-bg text-warn',
        estado === 'sin-exportar' && 'border-line text-muted',
      )}
    >
      {ESTADO_LABEL[estado]}
    </span>
  );
}

/** Vista previa en vivo (aspecto de impresión) con el último dibujo correcto mientras hay errores. */
function usePreview(content: string | undefined, seed: string) {
  const [result, setResult] = useState<RenderOk | RenderError | null>(null);
  const [good, setGood] = useState<RenderOk | null>(null);
  const [rendering, setRendering] = useState(false);
  useEffect(() => {
    if (content === undefined) return;
    let alive = true;
    const t = setTimeout(async () => {
      setRendering(true);
      try {
        const { renderDiagram } = await import('../lib/diagram');
        const r = await renderDiagram(content, seed);
        if (!alive) return;
        setResult(r);
        if (r.ok) setGood(r);
      } catch (e) {
        if (alive) setResult({ ok: false, message: e instanceof Error ? e.message : String(e), line: null });
      } finally {
        if (alive) setRendering(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [content, seed]);
  return { result, good, rendering };
}

export function DiagramPanel({ params, api }: IDockviewPanelProps<FileParams>) {
  const { root, path } = params;
  const key = docKey(root, path);
  const name = diagramName(path);
  useEffect(() => {
    void ensureDoc(root, path);
  }, [root, path]);
  useEffect(() => {
    api.setTitle(basename(path));
  }, [api, path]);
  useEffect(() => {
    if (!useDiagramas.getState().items) refreshDiagramasSoon(0);
  }, []);

  const status = useDocs((s) => s.docs[key]?.status);
  const content = useDocs((s) => (s.docs[key]?.status === 'ready' ? s.docs[key].content : undefined));
  const dirty = useDocs((s) => isDirty(s.docs[key]));
  const item = useDiagramaItem(path);
  const { result, good, rendering } = usePreview(content, name ?? 'diagrama');
  const [busy, setBusy] = useState<null | 'export' | 'png'>(null);
  const [fit, setFit] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (host.current) host.current.innerHTML = good?.svg ?? '';
  }, [good]);

  const error = result && !result.ok ? result : null;
  const diags: LineDiagnostic[] = error ? [{ line: error.line, severity: 'error', message: error.message }] : [];
  // El estado del servidor mira el disco; con cambios sin guardar, una figura exportada ya no está al día.
  const estado: EstadoDiagrama | null = item ? (item.estado === 'exportado' && dirty ? 'desactualizado' : item.estado) : null;

  const doExport = async () => {
    setBusy('export');
    try {
      await exportDiagram(path);
    } finally {
      setBusy(null);
    }
  };

  const doPng = async () => {
    if (!good) return;
    setBusy('png');
    try {
      const { svgToPng, downloadBlob } = await import('../lib/diagram');
      downloadBlob(await svgToPng(good.svg, good.width, good.height, 2), `${basename(path).replace(/\.mmd$/i, '')}.png`);
    } catch (e) {
      toast({ kind: 'error', text: `No se pudo generar el PNG: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-2 text-[11.5px] text-muted">
        <span className="min-w-0 flex-1 truncate font-mono" title={path}>
          {path}
        </span>
        <SaveIndicator docKey={key} />
        {estado && (
          <EstadoBadge
            estado={estado}
            title={
              item?.exportadoEn
                ? `Exportada el ${formatDate(item.exportadoEn)} a ${item.pdf}${estado === 'desactualizado' ? ' · la fuente cambió desde entonces' : ''}`
                : 'Aún no se ha exportado'
            }
          />
        )}
        <IconButton label={`Guardar (${MOD}S)`} onClick={() => saveDoc(key)} disabled={status !== 'ready'}>
          <Save size={14} />
        </IconButton>
        <IconButton label="Descargar PNG (2×)" onClick={doPng} disabled={!good || !!busy}>
          {busy === 'png' ? <Spinner size={11} /> : <ImageDown size={14} />}
        </IconButton>
        <Button
          onClick={doExport}
          disabled={!name || !!busy || status !== 'ready' || !!error}
          title={name ? `Guardar y exportar a figuras/diagramas/${name}.pdf (y .svg)` : 'Solo se exportan los diagramas de la carpeta diagramas/'}
        >
          {busy === 'export' ? <Spinner size={11} /> : <FileOutput size={12} />}
          Exportar
        </Button>
        <Button
          variant="primary"
          onClick={() => name && openInsertFigure(path)}
          disabled={!name || !!busy || status !== 'ready' || !!error}
          title="Insertar la figura en un capítulo de la memoria"
        >
          <SquarePlus size={12} />
          Insertar en la memoria
        </Button>
      </div>
      <DocBanners docKey={key} lang="mermaid" />
      {!name && status === 'ready' && (
        <Banner kind="info">Este .mmd no está en la carpeta diagramas/: se puede editar, pero no exportar ni insertar.</Banner>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 border-r border-line">
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center text-muted">
              <Spinner />
            </div>
          )}
          <CodeEditor docKey={key} lang="mermaid" onSave={() => saveDoc(key)} onSaveCompile={doExport} diagnostics={diags} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-soft">
          <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-2 text-[11.5px] text-muted">
            <span className="flex-1">Vista previa (aspecto de impresión)</span>
            {rendering && <Spinner size={10} />}
            {good && (
              <span className="tabular-nums text-faint">
                {good.width} × {good.height} px
              </span>
            )}
            <IconButton label={fit ? 'Tamaño real' : 'Ajustar al panel'} onClick={() => setFit((v) => !v)}>
              {fit ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
            </IconButton>
          </div>
          {error && (
            <button
              type="button"
              role="alert"
              className="flex shrink-0 items-start gap-1.5 border-b border-danger/30 bg-danger-bg px-2 py-1.5 text-left text-[12px] text-danger"
              onClick={() => error.line && requestReveal(key, error.line)}
              title={error.line ? 'Ir a la línea' : undefined}
            >
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1 font-mono text-[11.5px] break-words whitespace-pre-wrap">
                {error.line ? `Línea ${error.line}: ` : ''}
                {error.message.split('\n').filter((l) => !/^-*\^$/.test(l.trim())).slice(0, 4).join('\n')}
              </span>
            </button>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div
              ref={host}
              aria-label="Vista previa del diagrama"
              className={cx(
                'et-diagram-preview mx-auto rounded-md border border-line bg-white p-3 shadow-sm',
                fit ? '[&>svg]:h-auto [&>svg]:max-w-full' : 'w-max',
                error && 'opacity-50',
              )}
              style={{ width: fit ? 'fit-content' : undefined, maxWidth: fit ? '100%' : undefined }}
            />
            {!good && !error && status === 'ready' && (
              <div className="flex justify-center py-6 text-muted">
                <Spinner />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
