// Lienzo editable del diagrama (v0.8): Visimer sobre nuestro Mermaid (aspecto de impresión) con
// paleta de bloques a la izquierda, barra flotante sobre el bloque seleccionado, propiedades a la
// derecha y barra de estado. Se carga en diferido (React.lazy) desde DiagramPanel. El texto del
// .mmd sigue siendo la fuente de verdad: cada edición vuelve a DiagramPanel como un cambio de texto.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MermaidWysiwyg, type MermaidCanvasView, type MermaidWysiwygEditor } from '@visimer/react';
import { ArrowRight, Layers, PanelLeftClose, PanelLeftOpen, PanelRight, PanelRightClose, Pencil, Plus, Shapes, Trash2 } from 'lucide-react';
import { canvasMermaid } from '../lib/diagram';
import {
  EDITABLE_KINDS,
  buildModel,
  connectOp,
  deleteLinkOp,
  diagramKind,
  directionOp,
  esVisimer,
  isBlockId,
  linkLabelOp,
  paletteFor,
  rawId,
  renameOp,
  shapeOp,
  shapeOptions,
  type DiagramKind,
  type Model,
  type PaletteItem,
  type VisimerOp,
} from '../lib/diagramEdit';
import { cx } from '../components/ui';
import { load, save as saveLocal } from '../lib/storage';
import { toast } from '../state/ui';
import { BLOCK_DRAG_TYPE, KIND_NAME, Palette, PropsPanel, StatusBar, type PropsHandlers } from './DiagramParts';

type EditorOp = Parameters<MermaidWysiwygEditor['dispatch']>[0];

interface Props {
  code: string;
  seed: string;
  /** El código tiene un error de sintaxis: el lienzo no se edita hasta corregirlo. */
  broken?: boolean;
  /** Hay cambios sin guardar (barra de estado). */
  dirty: boolean;
  onCodeChange: (code: string) => void;
  /** Deshacer / rehacer del documento (Mod-Z): el historial es el del editor de código. */
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onSaveCompile: () => void;
}

const PALETTE_KEY = 'et:diagram:palette';
const PROPS_KEY = 'et:diagram:props';
/** Ancho (px) del panel por debajo del cual las propiedades pasan a ser un cajón y la paleta queda en iconos. */
const NARROW_PROPS = 700;
const NARROW_PALETTE = 480;

// Visimer deselecciona al pulsar fuera de su lienzo (también en nuestras barras). Este escucha va
// antes que el suyo (se registra al cargar el módulo) y marca que la pulsación es de una barra.
let barPressed = false;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => void (barPressed = !!(e.target as Element | null)?.closest?.('[data-et-canvas-bar]')), true);
  document.addEventListener('pointerup', () => void setTimeout(() => (barPressed = false), 0), true);
}

/** Traduce al español los textos que Visimer crea en sus menús. */
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

/** Entidad de Visimer bajo un punto de la pantalla (para soltar un bloque sobre otro). */
function entityAtPoint(host: HTMLElement, x: number, y: number): { id: string; el: Element } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!host.contains(el)) continue;
    const hit = el.closest('[data-mw-entity]');
    const id = hit?.getAttribute('data-mw-entity');
    if (hit && id) return { id, el: hit };
  }
  return null;
}

const bigBtn = 'inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40';

export default function DiagramCanvas({ code, seed, broken, dirty, onCodeChange, onUndo, onRedo, onSave, onSaveCompile }: Props) {
  const kind: DiagramKind = diagramKind(code);
  const editable = EDITABLE_KINDS.has(kind);
  const canEdit = editable && !broken;
  const mermaid = useMemo(() => canvasMermaid(seed), [seed]);
  const [editor, setEditor] = useState<MermaidWysiwygEditor | null>(null);
  const [view, setView] = useState<MermaidCanvasView | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [shapeMenu, setShapeMenu] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const [width, setWidth] = useState(900);
  const [paletteIcons, setPaletteIcons] = useState<boolean>(() => load<boolean>(PALETTE_KEY, false));
  const [propsOpen, setPropsOpen] = useState<boolean>(() => load<boolean>(PROPS_KEY, true));
  const [drawer, setDrawer] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const kept = useRef<string[]>([]);
  const pendingRef = useRef<string | null>(null);
  pendingRef.current = pending;
  useSpanishChrome(wrap);

  // Ancho del panel: por debajo de ciertos umbrales se pliegan las propiedades y la paleta.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = width < NARROW_PROPS;
  const iconsOnly = paletteIcons || width < NARROW_PALETTE;
  const showProps = narrow ? drawer : propsOpen;

  // El modelo (bloques y conexiones) se vuelve a leer del análisis de Visimer en cada cambio.
  useEffect(() => {
    if (!editor) return;
    return editor.on('change', () => setTick((t) => t + 1));
  }, [editor]);
  const model: Model = useMemo(
    () => (editor && editable ? buildModel(kind, editor.result) : { blocks: [], links: [], direction: null, hasDirection: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, editable, kind, code],
  );

  const onSelectionChange = (ids: string[]) => {
    if (!ids.length && barPressed) return; // pulsar en una barra no deselecciona
    // Recuperar la selección tras pulsar en una barra no debe cerrar el menú de formas.
    if (ids.length !== kept.current.length || ids.some((x, i) => x !== kept.current[i])) setShapeMenu(false);
    kept.current = ids;
    setSelection(ids);
    if (!ids.length) setPending(null);
  };
  // Tras pulsar en una barra se recupera la selección (y con ella la barra flotante del bloque).
  const restoreSelection = () => {
    if (editor && !editor.selection.length && kept.current.length) editor.setSelection(kept.current, 'canvas');
  };

  const selected = selection.length === 1 ? selection[0] : null;
  const selectedBlock = selected && isBlockId(selected) && canEdit && model.blocks.some((b) => b.id === selected) ? selected : null;
  const palette = paletteFor(kind);

  const run = useCallback(
    (op: VisimerOp | null) => {
      if (!editor || !op) return null;
      return editor.dispatch(op as EditorOp, 'canvas');
    },
    [editor],
  );

  /** Añade un bloque de la paleta. `anchor`: el bloque de referencia (seleccionado, o sobre el que se suelta). */
  const addBlock = (item: PaletteItem, anchor: string[], forceConnect = false) => {
    if (!editor || !view || !canEdit) return;
    const act = item.make({ selection: anchor, result: editor.result, code: editor.code });
    if (!act) {
      toast({ kind: 'info', text: `«${item.label}»: ${item.hint}.` });
      return;
    }
    if (act.kind === 'text') {
      editor.setCode(act.code, 'canvas');
      return;
    }
    if (act.kind === 'ops') {
      for (const op of act.ops) run(op);
      return;
    }
    const prev = anchor.find((a) => isBlockId(a) && !a.startsWith('participant:')) ?? null;
    const res = run(act.op);
    const created = res?.created?.[0];
    if (!created) return;
    for (const op of act.follow?.(rawId(created)) ?? []) run(op);
    if ((item.after || forceConnect) && prev) run(connectOp(kind, prev, created));
    if (isBlockId(created) && editor.entityExists(created)) editor.setSelection([created], 'canvas');
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

  const addAfter = () => {
    if (!selectedBlock) return;
    const id = { flowchart: 'paso', state: 'estado', class: 'clase', er: 'entidad', sequence: 'mensaje', otro: '' }[kind];
    const item = palette.find((p) => p.id === id);
    if (item) addBlock(item, [selectedBlock], kind === 'class' || kind === 'er');
  };

  const connectTo = (from: string, to: string) => {
    const op = connectOp(kind, from, to);
    if (!op) return;
    const res = run(op);
    const created = res?.created?.[0];
    if (!res) toast({ kind: 'error', text: 'No se pudo crear la conexión.' });
    else if (created && kind === 'sequence') editor?.setSelection([from], 'canvas');
  };

  // Clic en el bloque de destino cuando se pulsó «Conectar» en la barra flotante.
  const hooks = useMemo(
    () => ({
      onEntityClick: (entity: string) => {
        const from = pendingRef.current;
        if (!from) return;
        setPending(null);
        if (entity === from || !isBlockId(entity)) return;
        connectTo(from, entity);
        setTimeout(() => editor?.setSelection([from], 'canvas'), 0);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, kind],
  );

  const handlers: PropsHandlers = {
    onRename: (id, text) => {
      const t = text.trim();
      if (!t || !editor) return;
      run(renameOp(kind, id, t));
      // Clases y entidades cambian de id al renombrarlas: se mantiene la selección.
      if (!editor.entityExists(id)) {
        const next = `${id.slice(0, id.indexOf(':') + 1)}${t.replace(/[^\w-]/g, '')}`;
        if (editor.entityExists(next)) editor.setSelection([next], 'canvas');
      }
    },
    onShape: (id, shape) => void run(shapeOp(kind, id, shape)),
    onConnect: (a, b) => connectTo(a, b),
    onDeleteLink: (id) => void run(deleteLinkOp(kind, id)),
    onLinkLabel: (id, text) => void run(linkLabelOp(kind, id, text.trim())),
    onDirection: (d) => void run(directionOp(kind, d)),
    onDeleteBlock: (id) => editor?.deleteEntities([id], 'canvas'),
  };

  // ---- Arrastrar un bloque de la paleta al lienzo ----
  const dropMark = useRef<Element | null>(null);
  const markDrop = (el: Element | null) => {
    if (dropMark.current === el) return;
    dropMark.current?.classList.remove('et-drop-target');
    dropMark.current = el;
    el?.classList.add('et-drop-target');
  };
  const isBlockDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(BLOCK_DRAG_TYPE);
  const onDragOver = (e: React.DragEvent) => {
    if (!canEdit || !isBlockDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const hit = wrap.current && entityAtPoint(wrap.current, e.clientX, e.clientY);
    markDrop(hit && isBlockId(hit.id) ? hit.el : null);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!canEdit || !isBlockDrag(e)) return;
    e.preventDefault();
    const hit = wrap.current && entityAtPoint(wrap.current, e.clientX, e.clientY);
    markDrop(null);
    const item = palette.find((p) => p.id === e.dataTransfer.getData(BLOCK_DRAG_TYPE));
    if (item) addBlock(item, hit && isBlockId(hit.id) ? [hit.id] : []);
  };

  // ---- Barra flotante: sigue al bloque seleccionado (zoom, desplazamiento, redibujado) ----
  useEffect(() => {
    const el = bar.current;
    const host = wrap.current;
    if (!el || !host || !selectedBlock) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const nodes = host.querySelectorAll(`[data-mw-entity="${CSS.escape(selectedBlock)}"]`);
      let r: DOMRect | null = null;
      nodes.forEach((n) => {
        const b = n.getBoundingClientRect();
        if (!r || b.top < r.top) r = b;
      });
      const a = document.activeElement as HTMLElement | null;
      const editing = !!a && host.contains(a) && (a.isContentEditable || a.tagName === 'INPUT');
      const hr = host.getBoundingClientRect();
      const box = r as DOMRect | null;
      if (!box || editing || box.bottom < hr.top || box.top > hr.bottom || box.right < hr.left || box.left > hr.right) {
        el.style.visibility = 'hidden';
        return;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.min(Math.max(box.left + box.width / 2 - hr.left - w / 2, 4), Math.max(hr.width - w - 4, 4));
      let top = box.top - hr.top - h - 8;
      if (top < 4) top = box.bottom - hr.top + 8;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.visibility = 'visible';
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selectedBlock]);

  const togglePalette = () => {
    setPaletteIcons(!paletteIcons);
    saveLocal(PALETTE_KEY, !paletteIcons);
  };
  const toggleProps = () => {
    if (narrow) setDrawer(!drawer);
    else {
      setPropsOpen(!propsOpen);
      saveLocal(PROPS_KEY, !propsOpen);
    }
  };

  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
    if (e.key === 'Escape' && pending) {
      setPending(null);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
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

  const shapes = shapeOptions(kind);
  const current = selectedBlock ? model.blocks.find((b) => b.id === selectedBlock) : null;
  const tool = (label: string, icon: React.ReactNode, onClick: () => void, opts?: { active?: boolean; danger?: boolean; disabled?: boolean }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={opts?.active}
      disabled={opts?.disabled}
      onClick={onClick}
      className={cx('inline-flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-40', opts?.danger ? 'text-danger hover:bg-danger-bg' : 'text-muted hover:bg-hover hover:text-fg', opts?.active && 'bg-active text-accent')}
    >
      {icon}
    </button>
  );

  const propsPanel = (
    <div data-et-canvas-bar onPointerUp={restoreSelection} className={cx('flex w-[200px] shrink-0 flex-col gap-2 border-l border-line bg-bg p-2.5', narrow && 'absolute top-0 right-0 bottom-0 z-20 pt-9 shadow-pop')}>
      <PropsPanel kind={kind} kindName={KIND_NAME[kind]} model={model} selection={selection} canEdit={canEdit} h={handlers} />
    </div>
  );

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col" onKeyDownCapture={onKeyDownCapture}>
      {!editable && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-bg px-2 py-1 text-[12px] text-muted">
          <Layers size={13} />
          Este tipo de diagrama solo se puede editar con código.
        </div>
      )}
      {broken && editable && <div className="shrink-0 border-b border-line bg-bg px-2 py-1 text-[11.5px] text-danger">Corrige el error del código para seguir editando aquí.</div>}
      <div className="flex min-h-0 flex-1">
        {editable && (
          <div data-et-canvas-bar onPointerUp={restoreSelection} className={cx('flex shrink-0 flex-col gap-1.5 border-r border-line bg-bg p-2', iconsOnly ? 'w-11 items-center' : 'w-[148px]')}>
            <Palette items={palette} icons={iconsOnly} disabled={!canEdit} canUse={(it) => !editor || it.make({ selection, result: editor.result, code }) !== null} onUse={(it) => addBlock(it, selection)} />
            {width >= NARROW_PALETTE && (
              <button type="button" onClick={togglePalette} title={paletteIcons ? 'Mostrar los nombres de los bloques' : 'Mostrar solo los iconos'} aria-label={paletteIcons ? 'Mostrar los nombres de los bloques' : 'Mostrar solo los iconos'} className={cx(bigBtn, 'mt-auto')}>
                {paletteIcons ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
              </button>
            )}
          </div>
        )}
        <div
          ref={wrap}
          onDragOver={onDragOver}
          onDragLeave={() => markDrop(null)}
          onDrop={onDrop}
          className={cx('et-canvas relative min-h-0 min-w-0 flex-1 bg-[#f6f7f9]', !editable && 'et-canvas-readonly')}
        >
          <MermaidWysiwyg
            code={code}
            onCodeChange={onCodeChange}
            mermaid={mermaid}
            readOnly={!canEdit}
            panZoom
            accentColor="#2563eb"
            hooks={hooks}
            onSelectionChange={onSelectionChange}
            onReady={(ed, v) => {
              setEditor(ed);
              setView(v);
            }}
            className="h-full w-full"
          />
          {editable && (
            <button type="button" onClick={toggleProps} aria-pressed={showProps} title={showProps ? 'Ocultar las propiedades' : 'Mostrar las propiedades del bloque'} aria-label={showProps ? 'Ocultar las propiedades' : 'Mostrar las propiedades del bloque'} className={cx(bigBtn, 'absolute top-1.5 right-1.5 z-30 border border-line bg-bg shadow-sm')}>
              {showProps ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
            </button>
          )}
          {pending && (
            <div role="status" className="absolute top-1.5 left-1/2 z-10 -translate-x-1/2 rounded-md border border-accent bg-bg px-2 py-1 text-[12px] text-accent shadow-sm">
              Haz clic en el bloque de destino · Esc para cancelar
            </div>
          )}
          {selectedBlock && (
            <div
              ref={bar}
              data-et-canvas-bar
              onPointerUp={restoreSelection}
              role="toolbar"
              aria-label="Acciones del bloque"
              style={{ visibility: 'hidden' }}
              className="absolute z-10 flex gap-0.5 rounded-md border border-line-strong bg-bg p-[3px] shadow-pop"
            >
              {tool('Cambiar texto', <Pencil size={14} />, () => view?.editEntityLabel(selectedBlock))}
              <div className="relative">
                {tool('Cambiar forma', <Shapes size={14} />, () => {
                  // Si no cabe debajo de la barra, el menú se abre hacia arriba.
                  const b = bar.current?.getBoundingClientRect();
                  const h = wrap.current?.getBoundingClientRect();
                  setMenuUp(!!b && !!h && h.bottom - b.bottom < 290);
                  setShapeMenu(!shapeMenu);
                }, { active: shapeMenu, disabled: !shapes.length })}
                {shapeMenu && (
                  <ul role="menu" aria-label="Formas" className={cx('absolute left-0 z-30 w-40 rounded-md border border-line-strong bg-bg py-0.5 text-[12px] shadow-pop', menuUp ? 'bottom-full mb-1' : 'top-full mt-1')}>
                    {shapes.map((s) => (
                      <li key={s.id} role="none">
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={current?.shape === s.id}
                          className={cx('flex w-full items-center px-2 py-[3px] text-left hover:bg-hover', current?.shape === s.id && 'text-accent')}
                          onClick={() => {
                            run(shapeOp(kind, selectedBlock, s.id));
                            setShapeMenu(false);
                          }}
                        >
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {tool('Conectar con otro bloque', <ArrowRight size={14} />, () => setPending(pending ? null : selectedBlock), { active: !!pending })}
              {tool('Añadir bloque después', <Plus size={14} />, addAfter)}
              {tool('Borrar', <Trash2 size={14} />, () => editor?.deleteEntities([selectedBlock], 'canvas'), { danger: true })}
            </div>
          )}
          {editable && narrow && drawer && propsPanel}
        </div>
        {editable && !narrow && propsOpen && propsPanel}
      </div>
      <StatusBar kind={kind} model={model} saved={!dirty} editable={editable} />
    </div>
  );
}
