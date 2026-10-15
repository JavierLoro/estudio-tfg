// Piezas del panel Diagrama (v0.8): paleta de bloques, propiedades del bloque seleccionado y
// barra de estado. Solo pintan y avisan: las ediciones las hace DiagramCanvas sobre el .mmd.

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowRightLeft, BoxSelect, ChevronDown, Database, ListPlus, Plus, Search, StickyNote, Table2, User, X } from 'lucide-react';
import { Button, IconButton, Select, cx, inputClass } from '../components/ui';
import { isBlockId, shapeOptions, type Block, type DiagramKind, type Glyph, type Link, type Model, type PaletteItem } from '../lib/diagramEdit';

/** Dibujo pequeño de cada bloque de la paleta (como en la maqueta). */
export function ShapeGlyph({ glyph }: { glyph: Glyph }) {
  const common = { width: 18, height: 14, viewBox: '0 0 18 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (glyph) {
    case 'stadium':
      return <svg {...common}><rect x="1" y="3" width="16" height="8" rx="4" /></svg>;
    case 'rect':
      return <svg {...common}><rect x="1" y="3" width="16" height="8" rx="1.5" /></svg>;
    case 'state':
      return <svg {...common}><rect x="1" y="2.5" width="16" height="9" rx="4" /></svg>;
    case 'diamond':
    case 'choice':
      return <svg {...common}><polygon points="9,1 16,7 9,13 2,7" /></svg>;
    case 'lean':
      return <svg {...common}><polygon points="5,3 17,3 13,11 1,11" /></svg>;
    case 'start':
      return <svg {...common}><circle cx="9" cy="7" r="4" fill="currentColor" /></svg>;
    case 'end':
      return <svg {...common}><circle cx="9" cy="7" r="5.5" /><circle cx="9" cy="7" r="2.8" fill="currentColor" /></svg>;
    case 'participant':
      return <svg {...common}><rect x="3" y="1" width="12" height="5" rx="1" /><path d="M9 6v7" strokeDasharray="1.5 1.5" /></svg>;
    case 'class':
      return <svg {...common}><rect x="2" y="1" width="14" height="12" rx="1" /><path d="M2 5h14M2 9h14" /></svg>;
    case 'cylinder':
      return <Database size={14} strokeWidth={1.5} aria-hidden />;
    case 'group':
      return <BoxSelect size={14} strokeWidth={1.5} aria-hidden />;
    case 'actor':
      return <User size={14} strokeWidth={1.5} aria-hidden />;
    case 'message':
      return <ArrowRight size={14} strokeWidth={1.5} aria-hidden />;
    case 'note':
      return <StickyNote size={14} strokeWidth={1.5} aria-hidden />;
    case 'member':
    case 'attribute':
      return <ListPlus size={14} strokeWidth={1.5} aria-hidden />;
    case 'entity':
      return <Table2 size={14} strokeWidth={1.5} aria-hidden />;
    case 'relation':
      return <ArrowRightLeft size={14} strokeWidth={1.5} aria-hidden />;
  }
}

const dragKey = 'application/x-et-bloque';
export const BLOCK_DRAG_TYPE = dragKey;

/** Paleta vertical de bloques: se arrastran al lienzo o se añaden con un clic. */
export function Palette({
  items,
  icons,
  disabled,
  canUse,
  onUse,
}: {
  items: PaletteItem[];
  /** Solo los dibujos (panel estrecho o plegada a mano). */
  icons: boolean;
  disabled: boolean;
  /** ¿Se puede usar ahora con lo seleccionado? (los bloques que necesitan uno seleccionado se atenúan) */
  canUse: (it: PaletteItem) => boolean;
  onUse: (it: PaletteItem) => void;
}) {
  return (
    <div role="toolbar" aria-label="Bloques" aria-orientation="vertical" className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
      {!icons && <div className="mb-0.5 text-sm text-muted">Bloques</div>}
      {items.map((it) => {
        const ok = canUse(it);
        return (
          <button
            key={it.id}
            type="button"
            draggable={!disabled}
            disabled={disabled}
            title={`${it.label}: ${it.hint}${ok ? '' : ' (selecciona antes un bloque)'}`}
            aria-label={it.label}
            onDragStart={(e) => {
              e.dataTransfer.setData(dragKey, it.id);
              e.dataTransfer.setData('text/plain', it.label);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onUse(it)}
            className={cx(
              'flex items-center rounded-md border border-line bg-bg text-ui text-fg transition-colors hover:bg-hover disabled:opacity-50',
              icons ? 'size-(--et-icon-btn) min-h-8 min-w-8 justify-center' : 'min-h-(--et-control-sm) gap-2 px-2 py-1 text-left',
              !ok && !disabled && 'opacity-60',
              !disabled && 'cursor-grab active:cursor-grabbing',
            )}
          >
            <span className="flex w-[18px] shrink-0 items-center justify-center text-muted">
              <ShapeGlyph glyph={it.glyph} />
            </span>
            {!icons && <span className="min-w-0 truncate">{it.label}</span>}
          </button>
        );
      })}
      {!icons && <div className="mt-1.5 text-sm text-muted">Arrastra al lienzo</div>}
    </div>
  );
}

const fieldCls = inputClass('sm');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-bold text-muted">{title}</div>
      {children}
    </div>
  );
}

/** Campo de texto que aplica el cambio con Intro o al salir (Esc lo descarta). */
function CommitInput({ value, onCommit, className, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => {
    if (v !== value) onCommit(v);
  };
  return (
    <input
      {...rest}
      value={v}
      className={className}
      onChange={(e) => setV(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          done();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function DirectionToggle({ value, onChange, disabled }: { value: string | null; onChange: (d: 'TD' | 'LR') => void; disabled: boolean }) {
  const vertical = value === 'TD' || value === 'TB' || value === null;
  const horizontal = value === 'LR';
  const btn = (on: boolean, label: string, d: 'TD' | 'LR', icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(d)}
      className={cx('inline-flex h-(--et-control-sm) w-10 items-center justify-center rounded-md border text-ui disabled:opacity-50', on ? 'border-transparent bg-active text-accent' : 'border-line-strong text-muted hover:bg-hover')}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex gap-1">
      {btn(vertical, 'Vertical: de arriba abajo (TD)', 'TD', <ArrowDown size={16} />)}
      {btn(horizontal, 'Horizontal: de izquierda a derecha (LR)', 'LR', <ArrowRight size={16} />)}
    </div>
  );
}

export interface PropsHandlers {
  onRename: (blockId: string, text: string) => void;
  onShape: (blockId: string, shape: string) => void;
  onConnect: (fromBlock: string, toBlock: string) => void;
  onDeleteLink: (linkId: string) => void;
  onLinkLabel: (linkId: string, text: string) => void;
  onDirection: (d: 'TD' | 'LR') => void;
  onDeleteBlock: (blockId: string) => void;
}

/** Propiedades del bloque seleccionado (o datos del diagrama si no hay selección). */
export function PropsPanel({
  kind,
  kindName,
  model,
  selection,
  canEdit,
  h,
}: {
  kind: DiagramKind;
  kindName: string;
  model: Model;
  selection: string[];
  canEdit: boolean;
  h: PropsHandlers;
}) {
  const sel = selection.length === 1 ? selection[0] : null;
  const block = sel ? model.blocks.find((b) => b.id === sel) ?? null : null;
  const link = sel && !block ? model.links.find((l) => l.id === sel) ?? null : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto text-ui">
      {block ? (
        <BlockProps kind={kind} model={model} block={block} canEdit={canEdit} h={h} />
      ) : link ? (
        <LinkProps link={link} canEdit={canEdit} h={h} />
      ) : (
        <>
          <div className="text-muted">Diagrama</div>
          <Section title="Tipo">
            <div className="text-fg">{kindName}</div>
          </Section>
          {model.hasDirection && (
            <Section title="Dirección">
              <DirectionToggle value={model.direction} onChange={h.onDirection} disabled={!canEdit} />
            </Section>
          )}
          <p className="text-muted">{selection.length > 1 ? 'Hay varios elementos seleccionados.' : 'Selecciona un bloque para editarlo.'}</p>
        </>
      )}
    </div>
  );
}

function BlockProps({ kind, model, block, canEdit, h }: { kind: DiagramKind; model: Model; block: Block; canEdit: boolean; h: PropsHandlers }) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setPicking(false);
    setQ('');
  }, [block.id]);
  useEffect(() => {
    if (picking) search.current?.focus();
  }, [picking]);
  const shapes = shapeOptions(kind);
  const incoming = model.links.filter((l) => l.to === block.id);
  const outgoing = model.links.filter((l) => l.from === block.id);
  const others = model.blocks.filter((b) => b.id !== block.id && b.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <div className="text-muted">Bloque seleccionado</div>
      <Section title="Texto">
        <CommitInput aria-label="Texto del bloque" className={fieldCls} value={block.label} disabled={!canEdit} onCommit={(t) => h.onRename(block.id, t)} />
      </Section>
      {shapes.length > 0 && (
        <Section title={kind === 'sequence' ? 'Tipo' : 'Forma'}>
          <div className="relative">
            <Select
              inputSize="sm"
              aria-label={kind === 'sequence' ? 'Tipo de participante' : 'Forma del bloque'}
              className="appearance-none pr-7!"
              value={block.shape ?? ''}
              disabled={!canEdit}
              onChange={(e) => h.onShape(block.id, e.target.value)}
            >
              {block.shape && !shapes.some((s) => s.id === block.shape) && <option value={block.shape}>{block.shape}</option>}
              {shapes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
            <ChevronDown size={16} aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted" />
          </div>
        </Section>
      )}
      <Section title="Conexiones">
        <div className="flex flex-col">
          {incoming.map((l) => (
            <LinkRow key={l.id} dir="in" link={l} canEdit={canEdit} h={h} />
          ))}
          {outgoing.map((l) => (
            <LinkRow key={l.id} dir="out" link={l} canEdit={canEdit} h={h} />
          ))}
          {!incoming.length && !outgoing.length && <div className="py-1 text-muted">Sin conexiones</div>}
        </div>
        <Button variant="subtle" size="sm" disabled={!canEdit || model.blocks.length < 2} onClick={() => setPicking(!picking)} aria-expanded={picking} className="mt-1 -ml-2.5 text-accent!">
          <Plus size={14} />
          Conectar con…
        </Button>
        {picking && (
          <div className="mt-1 rounded-md border border-line-strong bg-bg">
            <div className="flex items-center gap-1 border-b border-line px-2">
              <Search size={14} className="shrink-0 text-muted" aria-hidden />
              <input
                ref={search}
                aria-label="Buscar bloque"
                placeholder="Buscar bloque…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') setPicking(false);
                  if (e.key === 'Enter' && others[0]) {
                    h.onConnect(block.id, others[0].id);
                    setPicking(false);
                  }
                }}
                className="et-focus-inset h-(--et-control-sm) min-w-0 flex-1 bg-transparent text-ui placeholder:text-muted"
              />
            </div>
            <ul role="listbox" aria-label="Bloques" className="max-h-32 overflow-y-auto py-0.5">
              {others.map((b) => (
                <li key={b.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="et-focus-inset block min-h-(--et-row) w-full truncate px-2 py-1 text-left text-fg hover:bg-hover"
                    onClick={() => {
                      h.onConnect(block.id, b.id);
                      setPicking(false);
                    }}
                  >
                    {b.label || b.raw}
                  </button>
                </li>
              ))}
              {!others.length && <li className="px-2 py-1 text-muted">Ningún bloque</li>}
            </ul>
          </div>
        )}
      </Section>
      {model.hasDirection && (
        <Section title="Dirección">
          <DirectionToggle value={model.direction} onChange={h.onDirection} disabled={!canEdit} />
        </Section>
      )}
    </>
  );
}

function LinkRow({ dir, link, canEdit, h }: { dir: 'in' | 'out'; link: Link; canEdit: boolean; h: PropsHandlers }) {
  const name = dir === 'in' ? link.fromLabel : link.toLabel;
  return (
    <div className="group flex min-h-(--et-row) items-center gap-1">
      <span className="shrink-0 text-muted" aria-hidden>
        {dir === 'in' ? '←' : '→'}
      </span>
      <span className="min-w-0 max-w-[45%] shrink-0 truncate text-fg" title={name}>
        <span className="sr-only">{dir === 'in' ? 'Desde ' : 'Hacia '}</span>
        {name}
      </span>
      <CommitInput
        aria-label={`Etiqueta de la conexión ${dir === 'in' ? 'desde' : 'hacia'} ${name}`}
        placeholder="etiqueta"
        value={link.label}
        disabled={!canEdit}
        onCommit={(t) => h.onLinkLabel(link.id, t)}
        className="h-(--et-control-sm) min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-ui text-muted placeholder:text-muted hover:border-line-strong focus:border-line-strong focus:text-fg"
      />
      <IconButton label="Quitar esta conexión" disabled={!canEdit} onClick={() => h.onDeleteLink(link.id)}>
        <X size={16} />
      </IconButton>
    </div>
  );
}

function LinkProps({ link, canEdit, h }: { link: Link; canEdit: boolean; h: PropsHandlers }) {
  return (
    <>
      <div className="text-muted">Conexión seleccionada</div>
      <Section title="De → a">
        <div className="text-fg">
          {link.fromLabel} → {link.toLabel}
        </div>
      </Section>
      <Section title="Etiqueta">
        <CommitInput aria-label="Etiqueta de la conexión" className={fieldCls} value={link.label} disabled={!canEdit} onCommit={(t) => h.onLinkLabel(link.id, t)} />
      </Section>
      <Button variant="danger" size="sm" disabled={!canEdit} onClick={() => h.onDeleteLink(link.id)} className="self-start">
        Quitar conexión
      </Button>
    </>
  );
}

export const KIND_NAME: Record<DiagramKind, string> = {
  flowchart: 'Diagrama de flujo',
  sequence: 'Diagrama de secuencia',
  state: 'Diagrama de estados',
  class: 'Diagrama de clases',
  er: 'Diagrama entidad-relación',
  otro: 'Solo lectura',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function StatusBar({ kind, model, saved, editable }: { kind: DiagramKind; model: Model; saved: boolean; editable: boolean }) {
  const blocks = model.blocks.filter((b) => isBlockId(b.id)).length;
  return (
    <div className="flex min-h-7 shrink-0 items-center gap-3 border-t border-line px-2.5 py-1 text-sm text-muted">
      <span>{KIND_NAME[kind]}</span>
      {editable && (
        <span className="tabular-nums">
          {plural(blocks, 'bloque', 'bloques')} · {plural(model.links.length, 'conexión', 'conexiones')}
        </span>
      )}
      <span className="flex-1" />
      <span className={cx(!saved && 'text-warn')}>{saved ? 'Guardado' : 'Sin guardar'}</span>
    </div>
  );
}
