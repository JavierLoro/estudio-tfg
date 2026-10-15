import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import type { IDockviewPanelProps } from 'dockview-react';
import { AlertCircle, Code2, FileOutput, ImageDown, Save, SquarePlus, Undo2, Workflow } from 'lucide-react';
import { CodeEditor, type LineDiagnostic } from '../components/CodeEditor';
import { DocBanners, SaveIndicator } from '../components/DocBanners';
import { Banner, Button, IconButton, Spinner, StatusPill, cx, type Tone } from '../components/ui';
import type { EstadoDiagrama } from '../api';
import { kbd } from '../lib/kbd';
import type { RenderError, RenderOk } from '../lib/diagram';
import { EDITABLE_KINDS, diagramKind } from '../lib/diagramEdit';
import { basename, docKey, formatDate } from '../lib/paths';
import { load, save as saveLocal } from '../lib/storage';
import { diagramName, exportDiagram, openInsertFigure, refreshDiagramasSoon, useDiagramaItem, useDiagramas } from '../state/diagramas';
import { editContent, ensureDoc, isDirty, requestReveal, saveDoc, useDocs } from '../state/docs';
import { toast } from '../state/ui';
import type { FileParams } from '../state/workspace';

// Lienzo editable (Visimer + Mermaid): en diferido, no entra en el bundle inicial.
const DiagramCanvas = lazy(() => import('./DiagramCanvas'));

const CODE_KEY = 'et:diagram:code';

const ESTADO_LABEL: Record<EstadoDiagrama, string> = {
  'sin-exportar': 'Sin exportar',
  exportado: 'Exportada',
  desactualizado: 'Desactualizada',
};

const ESTADO_TONE: Record<EstadoDiagrama, Tone> = {
  'sin-exportar': 'neutral',
  exportado: 'ok',
  desactualizado: 'warn',
};

export function EstadoBadge({ estado, title }: { estado: EstadoDiagrama; title?: string }) {
  return (
    <StatusPill tone={ESTADO_TONE[estado]} title={title} className="shrink-0">
      {ESTADO_LABEL[estado]}
    </StatusPill>
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
  // El código está oculto por defecto; si el tipo de diagrama no se puede editar visualmente, se muestra siempre.
  const [codeOn, setCodeOn] = useState<boolean>(() => load<boolean>(CODE_KEY, false));
  const kind = diagramKind(content ?? '');
  const showCode = codeOn || (content !== undefined && !EDITABLE_KINDS.has(kind));
  const toggleCode = () => {
    setCodeOn(!showCode);
    saveLocal(CODE_KEY, !showCode);
  };
  // El historial (Mod-Z) es el del editor de código, que sigue montado (oculto) aunque no se vea.
  const cm = useRef<EditorView | null>(null);
  const onView = useCallback((v: EditorView | null) => {
    cm.current = v;
  }, []);
  const onCanvasCode = useCallback((next: string) => void editContent(key, next), [key]);
  const doUndo = useCallback(() => void (cm.current && undo(cm.current)), []);
  const doRedo = useCallback(() => void (cm.current && redo(cm.current)), []);
  const doSave = useCallback(() => void saveDoc(key), [key]);

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

  // Mod-Z / Mod-Shift-Z en todo el panel (p. ej. con el foco en la barra), no solo en el lienzo;
  // el editor de código y los campos de texto llevan su propio deshacer.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    const t = e.target as HTMLElement;
    if (t.closest('.cm-editor') || t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
  };

  return (
    <div className="flex h-full flex-col bg-bg" onKeyDown={onPanelKeyDown}>
      <div className="flex min-h-(--et-toolbar) shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2.5 py-1 text-ui">
        <Workflow size={16} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 truncate font-medium" title={path}>
          {basename(path).replace(/\.mmd$/i, '')}
        </span>
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
        {rendering && <Spinner size={14} />}
        <SaveIndicator docKey={key} />
        <span className="min-w-0 flex-1" />
        <Button
          variant={showCode ? 'primary' : 'secondary'}
          size="sm"
          onClick={toggleCode}
          disabled={content !== undefined && !EDITABLE_KINDS.has(kind)}
          title={showCode ? 'Ocultar el código del diagrama' : 'Mostrar el código del diagrama (Mermaid)'}
          aria-pressed={showCode}
        >
          <Code2 size={14} />
          Código
        </Button>
        <IconButton label={`Deshacer (${kbd('Mod-Z')})`} onClick={doUndo} disabled={status !== 'ready'}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label={`Guardar (${kbd('Mod-S')})`} onClick={() => saveDoc(key)} disabled={status !== 'ready'}>
          <Save size={16} />
        </IconButton>
        <IconButton label="Descargar PNG (2×)" onClick={doPng} disabled={!good || !!busy}>
          {busy === 'png' ? <Spinner size={14} /> : <ImageDown size={16} />}
        </IconButton>
        <Button
          size="sm"
          onClick={doExport}
          disabled={!name || !!busy || status !== 'ready' || !!error}
          title={name ? `Guardar y exportar a figuras/diagramas/${name}.pdf (y .svg)` : 'Solo se exportan los diagramas de la carpeta diagramas/'}
        >
          {busy === 'export' ? <Spinner size={14} /> : <FileOutput size={14} />}
          Exportar
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => name && openInsertFigure(path)}
          disabled={!name || !!busy || status !== 'ready' || !!error}
          title="Insertar la figura en un capítulo de la memoria"
        >
          <SquarePlus size={14} />
          Insertar en la memoria
        </Button>
      </div>
      <DocBanners docKey={key} lang="mermaid" />
      {!name && status === 'ready' && (
        <Banner kind="info">Este .mmd no está en la carpeta diagramas/: se puede editar, pero no exportar ni insertar.</Banner>
      )}
      <div className="flex min-h-0 flex-1">
        {/* El editor de código no se desmonta al ocultarlo: conserva su historial de deshacer. */}
        <div className={cx('relative min-w-0 flex-1 border-r border-line', !showCode && 'hidden')}>
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center text-muted">
              <Spinner />
            </div>
          )}
          <CodeEditor docKey={key} lang="mermaid" onSave={() => saveDoc(key)} onSaveCompile={doExport} diagnostics={diags} onView={onView} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {error && (
            <button
              type="button"
              role="alert"
              className="et-focus-inset flex min-h-(--et-row) shrink-0 items-start gap-1.5 border-b border-danger/40 bg-danger-bg px-3 py-2 text-left text-ui text-danger"
              onClick={() => {
                if (!showCode) {
                  setCodeOn(true);
                  saveLocal(CODE_KEY, true);
                }
                if (error.line) setTimeout(() => requestReveal(key, error.line as number), 50);
              }}
              title={showCode ? (error.line ? 'Ir a la línea' : undefined) : 'Mostrar el código y ir a la línea'}
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 font-mono text-sm break-words whitespace-pre-wrap">
                {error.line ? `Línea ${error.line}: ` : ''}
                {error.message.split('\n').filter((l) => !/^-*\^$/.test(l.trim())).slice(0, 4).join('\n')}
              </span>
            </button>
          )}
          <div className={cx('min-h-0 flex-1', error && 'opacity-60')}>
            {content !== undefined && (
              <Suspense
                fallback={
                  <div className="flex justify-center py-6 text-muted">
                    <Spinner />
                  </div>
                }
              >
                <DiagramCanvas
                  code={content}
                  seed={name ?? 'diagrama'}
                  broken={!!error}
                  dirty={dirty}
                  onCodeChange={onCanvasCode}
                  onUndo={doUndo}
                  onRedo={doRedo}
                  onSave={doSave}
                  onSaveCompile={doExport}
                />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
