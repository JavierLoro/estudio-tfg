import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import type { IDockviewPanelProps } from 'dockview-react';
import { AlertCircle, Code2, FileOutput, ImageDown, Save, SquarePlus, Undo2, Workflow } from 'lucide-react';
import { CodeEditor, type LineDiagnostic } from '../components/CodeEditor';
import { DocBanners, SaveIndicator } from '../components/DocBanners';
import { Banner, Button, IconButton, Spinner, cx } from '../components/ui';
import type { EstadoDiagrama } from '../api';
import { kbd } from '../lib/kbd';
import type { RenderError, RenderOk } from '../lib/diagram';
import { EDITABLE_KINDS, diagramKind } from '../lib/diagramEdit';
import { diagramFormKind } from '../lib/diagramForm';
import { basename, docKey, formatDate } from '../lib/paths';
import { load, save as saveLocal } from '../lib/storage';
import { diagramName, exportDiagram, openInsertFigure, refreshDiagramasSoon, useDiagramaItem, useDiagramas } from '../state/diagramas';
import { editContent, ensureDoc, isDirty, requestReveal, saveDoc, setFormDraft, setPendingVisual, useDocs, type DiagramFormDraft } from '../state/docs';
import { toast } from '../state/ui';
import type { FileParams } from '../state/workspace';

// Lienzo editable (Visimer + Mermaid): en diferido, no entra en el bundle inicial.
const DiagramCanvas = lazy(() => import('./DiagramCanvas'));

const CODE_KEY = 'et:diagram:code';
const CODE_RATIO_KEY = 'et:diagram:code-ratio';

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
  // Los tipos sin lienzo editable ni formulario muestran siempre el código.
  const [codeOn, setCodeOn] = useState<boolean>(() => load<boolean>(CODE_KEY, false));
  const [codeRatio, setCodeRatio] = useState(() => {
    const saved = load<unknown>(CODE_RATIO_KEY, 50);
    return typeof saved === 'number' && Number.isFinite(saved) ? Math.max(20, Math.min(80, saved)) : 50;
  });
  const codeDrag = useRef<{ x: number; width: number; ratio: number } | null>(null);
  const resizeCode = (ratio: number) => {
    const next = Math.max(20, Math.min(80, Math.round(ratio)));
    setCodeRatio(next);
    saveLocal(CODE_RATIO_KEY, next);
  };
  const formDraft = useDocs(s => s.docs[key]?.formDraft ?? null);
  const formPending = !!formDraft;
  const kind = diagramKind(content ?? '');
  const editable = EDITABLE_KINDS.has(kind) || !!diagramFormKind(content ?? '');
  const showCode = codeOn || (content !== undefined && !editable);
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
  const onFormDraft = useCallback((draft: DiagramFormDraft | null) => setFormDraft(key, draft), [key]);
  const onValidationChange = useCallback((next: string | null) => setPendingVisual(key, next), [key]);
  const readyToSave = () => {
    if (!formPending) return true;
    toast({ kind: 'info', text: 'Aplica o descarta los campos pendientes del formulario antes de guardar o exportar.' });
    return false;
  };
  const doUndo = () => { if (!formPending && cm.current) undo(cm.current); };
  const doRedo = () => { if (!formPending && cm.current) redo(cm.current); };
  const doSave = () => { if (readyToSave()) void saveDoc(key); };

  const error = result && !result.ok ? result : null;
  const diags: LineDiagnostic[] = error ? [{ line: error.line, severity: 'error', message: error.message }] : [];
  // El estado del servidor mira el disco; con cambios sin guardar, una figura exportada ya no está al día.
  const estado: EstadoDiagrama | null = item ? (item.estado === 'exportado' && dirty ? 'desactualizado' : item.estado) : null;

  const doExport = async () => {
    if (!readyToSave()) return;
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
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2.5 py-1 text-[12px]">
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
        {rendering && <Spinner size={10} />}
        <SaveIndicator docKey={key} />
        <span className="min-w-0 flex-1" />
        <Button
          variant={showCode ? 'primary' : 'default'}
          onClick={toggleCode}
          disabled={content !== undefined && !editable}
          title={showCode ? 'Ocultar el código del diagrama' : 'Mostrar el código del diagrama (Mermaid)'}
          aria-pressed={showCode}
        >
          <Code2 size={12} />
          Código
        </Button>
        <IconButton label={`Deshacer (${kbd('Mod-Z')})`} onClick={doUndo} disabled={status !== 'ready' || formPending}>
          <Undo2 size={14} />
        </IconButton>
        <IconButton label={`Guardar (${kbd('Mod-S')})`} onClick={doSave} disabled={status !== 'ready'}>
          <Save size={14} />
        </IconButton>
        <IconButton label="Descargar PNG (2×)" onClick={doPng} disabled={!good || !!busy || formPending}>
          {busy === 'png' ? <Spinner size={11} /> : <ImageDown size={14} />}
        </IconButton>
        <Button
          onClick={doExport}
          disabled={!name || !!busy || status !== 'ready' || !!error || formPending}
          title={name ? `Guardar y exportar a figuras/diagramas/${name}.pdf (y .svg)` : 'Solo se exportan los diagramas de la carpeta diagramas/'}
        >
          {busy === 'export' ? <Spinner size={11} /> : <FileOutput size={12} />}
          Exportar
        </Button>
        <Button
          variant="primary"
          onClick={() => name && openInsertFigure(path)}
          disabled={!name || !!busy || status !== 'ready' || !!error || formPending}
          title="Insertar la figura en un capítulo de la memoria"
        >
          <SquarePlus size={12} />
          Insertar en la memoria
        </Button>
      </div>
      <DocBanners docKey={key} lang="mermaid" />
      {formPending && <Banner kind="info" actions={!diagramFormKind(content ?? '')
        ? <Button onClick={() => setFormDraft(key, null)}>Descartar campos</Button> : undefined}>
        Aplica o descarta los campos del formulario para editar código, guardar o exportar.
      </Banner>}
      {!name && status === 'ready' && (
        <Banner kind="info">Este .mmd no está en la carpeta diagramas/: se puede editar, pero no exportar ni insertar.</Banner>
      )}
      <div className="grid min-h-0 min-w-0 flex-1" style={{ gridTemplateColumns: showCode ? `minmax(0, ${codeRatio}fr) 6px minmax(0, ${100 - codeRatio}fr)` : 'minmax(0, 1fr)' }}>
        {/* El editor de código no se desmonta al ocultarlo: conserva su historial de deshacer. */}
        <div inert={formPending} className={cx('relative min-h-0 min-w-0', !showCode && 'hidden', formPending && 'opacity-60')} style={{ gridColumn: 1, gridRow: 1 }}>
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center text-muted">
              <Spinner />
            </div>
          )}
          <CodeEditor docKey={key} lang="mermaid" onSave={doSave} onSaveCompile={doExport} diagnostics={diags} onView={onView} />
        </div>
        {showCode && <div role="separator" aria-label="Ancho del código del diagrama" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={codeRatio} aria-valuetext={`${codeRatio} % código, ${100 - codeRatio} % editor visual`} tabIndex={0}
          title="Arrastra para ajustar código y editor · doble clic: mitad y mitad"
          className="z-20 col-start-2 row-start-1 cursor-col-resize touch-none bg-line hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          onDoubleClick={() => resizeCode(50)}
          onKeyDown={e => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            resizeCode(e.key === 'Home' ? 20 : e.key === 'End' ? 80 : codeRatio + (e.key === 'ArrowRight' ? 5 : -5));
          }}
          onPointerDown={e => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.focus();
            codeDrag.current = { x: e.clientX, width: Math.max(1, e.currentTarget.parentElement!.clientWidth - 6), ratio: codeRatio };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => { if (codeDrag.current) resizeCode(codeDrag.current.ratio + (e.clientX - codeDrag.current.x) / codeDrag.current.width * 100); }}
          onPointerUp={e => { codeDrag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}
          onLostPointerCapture={() => { codeDrag.current = null; }}
        />}
        <div className="flex min-h-0 min-w-0 flex-col" style={{ gridColumn: showCode ? 3 : 1, gridRow: 1 }}>
          {error && (
            <button
              type="button"
              role="alert"
              className="flex shrink-0 items-start gap-1.5 border-b border-danger/30 bg-danger-bg px-2 py-1.5 text-left text-[12px] text-danger"
              onClick={() => {
                if (!showCode) {
                  setCodeOn(true);
                  saveLocal(CODE_KEY, true);
                }
                if (error.line) setTimeout(() => requestReveal(key, error.line as number), 50);
              }}
              title={showCode ? (error.line ? 'Ir a la línea' : undefined) : 'Mostrar el código y ir a la línea'}
            >
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1 font-mono text-[11.5px] break-words whitespace-pre-wrap">
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
                  docKey={key}
                  code={content}
                  seed={name ?? 'diagrama'}
                  broken={!!error}
                  dirty={dirty}
                  onCodeChange={onCanvasCode}
                  formDraft={formDraft}
                  onDraftChange={onFormDraft}
                  onValidationChange={onValidationChange}
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
