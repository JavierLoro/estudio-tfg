// Lienzo editable del diagrama (v0.8): Visimer sobre nuestro Mermaid (aspecto de impresión).
// Se carga en diferido (React.lazy) desde DiagramPanel. El texto del .mmd sigue siendo la
// fuente de verdad: cada edición visual vuelve a DiagramPanel como un cambio de texto.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MermaidWysiwyg, type MermaidCanvasView, type MermaidWysiwygEditor } from '@visimer/react';
import { Cable, Layers, MousePointer2, Pencil, Trash2 } from 'lucide-react';
import { canvasMermaid } from '../lib/diagram';
import { EDITABLE_KINDS, diagramKind, esVisimer, paletteFor, type DiagramKind, type PaletteItem } from '../lib/diagramEdit';
import { Button, cx } from '../components/ui';

type EditorOp = Parameters<MermaidWysiwygEditor['dispatch']>[0];

interface Props {
  code: string;
  seed: string;
  /** El código tiene un error de sintaxis: el lienzo no se edita hasta corregirlo. */
  broken?: boolean;
  onCodeChange: (code: string) => void;
  /** Deshacer / rehacer del documento (⌘Z): el historial es el del editor de código. */
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onSaveCompile: () => void;
}

// Visimer deselecciona al pulsar fuera de su lienzo (también en nuestra barra). Este escucha va
// antes que el suyo (se registra al cargar el módulo) y marca que la pulsación es de la barra.
let barPressed = false;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => void (barPressed = !!(e.target as Element | null)?.closest?.('[data-et-canvas-bar]')), true);
  document.addEventListener('pointerup', () => void setTimeout(() => (barPressed = false), 0), true);
}

/** Traduce al español los textos que Visimer crea en su barra flotante y menús. */
function useSpanishChrome(host: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const fix = (root: ParentNode) => {
      for (const n of Array.from(root.querySelectorAll<HTMLElement>('[title]'))) {
        const t = n.getAttribute('title') ?? '';
        const es = esVisimer(t);
        if (es !== t) n.setAttribute('title', es);
      }
      for (const n of Array.from(root.querySelectorAll<HTMLElement>('.mw-popover-panel-title, .mw-popover-section-title, .mw-cell-label, .mw-plus-menu button'))) {
        const t = n.textContent ?? '';
        const es = esVisimer(t);
        if (es !== t) n.textContent = es;
      }
    };
    fix(el);
    const mo = new MutationObserver(() => fix(el));
    mo.observe(el, { subtree: true, childList: true });
    return () => mo.disconnect();
  }, [host]);
}

export default function DiagramCanvas({ code, seed, broken, onCodeChange, onUndo, onRedo, onSave, onSaveCompile }: Props) {
  const kind: DiagramKind = diagramKind(code);
  const editable = EDITABLE_KINDS.has(kind);
  const canEdit = editable && !broken;
  const mermaid = useMemo(() => canvasMermaid(seed), [seed]);
  const [editor, setEditor] = useState<MermaidWysiwygEditor | null>(null);
  const [view, setView] = useState<MermaidCanvasView | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<'select' | 'connect'>('select');
  const wrap = useRef<HTMLDivElement>(null);
  const kept = useRef<string[]>([]);
  useSpanishChrome(wrap);
  const onSelectionChange = (ids: string[]) => {
    if (!ids.length && barPressed) return; // pulsar en la barra no deselecciona
    kept.current = ids;
    setSelection(ids);
  };
  // Tras pulsar en la barra se recupera la selección (y con ella la barra flotante del bloque).
  const restoreSelection = () => {
    if (editor && !editor.selection.length && kept.current.length) editor.setSelection(kept.current, 'canvas');
  };

  useEffect(() => view?.on('toolChange', setTool), [view]);
  // Si el diagrama deja de poder editarse, vuelve a la herramienta de selección.
  useEffect(() => {
    if (!editable) setTool('select');
  }, [editable]);

  const palette = paletteFor(kind);
  const selected = selection.length === 1 ? selection[0] : null;
  const selectedIsBlock = !!selected && /^(node|state|class|entity|participant):/.test(selected) && !!editor?.entityExists(selected);

  const useItem = (item: PaletteItem) => {
    if (!editor || !view) return;
    const act = item.make({ selection, result: editor.result, code: editor.code });
    if (!act) return;
    if (act.kind === 'text') {
      editor.setCode(act.code, 'canvas');
      return;
    }
    const prev = selected && /^(node|state):/.test(selected) ? selected : null;
    const res = editor.dispatch(act.op as EditorOp, 'canvas');
    const created = res?.created?.[0];
    if (!created) return;
    if (item.after && prev) {
      const a = prev.slice(prev.indexOf(':') + 1);
      const b = created.slice(created.indexOf(':') + 1);
      editor.dispatch(prev.startsWith('state:') ? { type: 'st.connect', source: a, target: b } : { type: 'connect', source: a, target: b }, 'canvas');
    }
    if (act.edit) {
      // Cuando se vuelva a dibujar, abre el texto del bloque nuevo para escribir.
      const off = view.on('render', () => {
        off();
        if (editor.entityExists(created)) {
          editor.setSelection([created], 'canvas');
          view.editEntityLabel(created);
        }
      });
    }
  };

  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const t = e.target as HTMLElement;
    const typing = t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
    const k = e.key.toLowerCase();
    if (k === 'z' && !typing) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) onRedo();
      else onUndo();
    } else if (k === 's') {
      e.preventDefault();
      e.stopPropagation();
      onSave();
    } else if (k === 'enter') {
      e.preventDefault();
      e.stopPropagation();
      onSaveCompile();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDownCapture={onKeyDownCapture}>
      {editable ? (
        <div data-et-canvas-bar onPointerUp={restoreSelection} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-bg px-2 py-1">
          <span className="mr-1 text-[11.5px] text-muted">Bloques:</span>
          {palette.map((it) => {
            const needs = editor ? it.make({ selection, result: editor.result, code }) === null : true;
            return (
              <Button key={it.id} title={it.hint} disabled={needs || !canEdit} onClick={() => useItem(it)}>
                {it.label}
              </Button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-line" />
          <Button
            variant={tool === 'connect' ? 'primary' : 'default'}
            title="Conectar dos bloques: pulsa el primero y arrastra hasta el segundo"
            disabled={!canEdit}
            onClick={() => view?.setTool(tool === 'connect' ? 'select' : 'connect')}
          >
            {tool === 'connect' ? <MousePointer2 size={12} /> : <Cable size={12} />}
            {tool === 'connect' ? 'Dejar de conectar' : 'Conectar'}
          </Button>
          {broken && <span className="text-[11.5px] text-danger">Corrige el error del código para seguir editando aquí.</span>}
          {tool === 'connect' && canEdit && <span className="text-[11.5px] text-accent">Arrastra desde un bloque hasta otro para unirlos con una flecha.</span>}
          {canEdit && selectedIsBlock && (
            <>
              <Button title="Cambiar el texto del bloque seleccionado" onClick={() => selected && view?.editEntityLabel(selected)}>
                <Pencil size={12} />
                Cambiar texto
              </Button>
              <Button variant="danger" title="Borrar el bloque seleccionado y sus flechas" onClick={() => selected && editor?.deleteEntities([selected], 'canvas')}>
                <Trash2 size={12} />
                Borrar
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-bg px-2 py-1 text-[12px] text-muted">
          <Layers size={13} />
          Este tipo de diagrama solo se puede editar con código.
        </div>
      )}
      <div ref={wrap} className={cx('et-canvas relative min-h-0 flex-1 bg-white', !editable && 'et-canvas-readonly')}>
        <MermaidWysiwyg
          code={code}
          onCodeChange={onCodeChange}
          mermaid={mermaid}
          readOnly={!canEdit}
          panZoom
          tool={tool}
          accentColor="#2563eb"
          onSelectionChange={onSelectionChange}
          onReady={(ed, v) => {
            setEditor(ed);
            setView(v);
          }}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
