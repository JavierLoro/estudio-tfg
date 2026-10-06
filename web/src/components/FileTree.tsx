import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Ellipsis, File, FileCode2, FileImage, FileText, Folder, FolderOpen } from 'lucide-react';
import type { Entry, Root } from '../api';
import { basename, dirname, ext, join, panelKindFor } from '../lib/paths';
import { indicatorOf, useDocs } from '../state/docs';
import { canMoveInto, createFileIn, createFolderIn, deleteEntry, expandPath, moveEntry, moveInto, toggleExpanded, useExpanded } from '../state/files';
import { flattenTree, useUI } from '../state/ui';
import { openFile, panelIdFor, useActivePanel } from '../state/workspace';
import { openContextMenu, type MenuItem } from './ContextMenu';
import { fold, highlight } from './SearchView';
import { openMoveDialog } from './MoveDialog';
import { ALT, Empty, Spinner, cx, isMac } from './ui';

function iconFor(path: string) {
  const e = ext(path);
  if (['tex', 'sty', 'cls', 'bib', 'bst'].includes(e)) return <FileCode2 size={14} className="shrink-0 text-muted" />;
  if (e === 'md') return <FileText size={14} className="shrink-0 text-muted" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'eps'].includes(e)) return <FileImage size={14} className="shrink-0 text-faint" />;
  return <File size={14} className="shrink-0 text-faint" />;
}

const DEL_HINT = isMac ? '⌘⌫' : 'Supr';

/** Lo que se está arrastrando (dataTransfer no se puede leer durante dragover). */
let dragged: { root: Root; path: string } | null = null;

/** Campo de renombrado en línea: selecciona el nombre sin la extensión; ↵ confirma, Esc cancela. */
function RenameInput({ initial, isDir, onCommit, onCancel }: { initial: string; isDir: boolean; onCommit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, !isDir && dot > 0 ? dot : initial.length);
  }, [initial, isDir]);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value ?? initial);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Nuevo nombre"
      className="h-[20px] min-w-0 flex-1 rounded border border-accent bg-bg px-1 text-[12.5px] outline-none"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

export function FileTree({ root, filter }: { root: Root; filter: string }) {
  const entries = useUI((s) => s.trees[root]);
  const error = useUI((s) => s.treeErrors[root]);
  const expanded = useExpanded((s) => s.sets[root]);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Destino resaltado durante un arrastre: ruta de carpeta, '' = raíz. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const hover = useRef<{ path: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const activeId = useActivePanel((s) => s.id);
  // Estado de guardado de los documentos abiertos de esta raíz: "ruta|estado;…"
  const openStates = useDocs((s) =>
    Object.values(s.docs)
      .filter((d) => d.root === root)
      .map((d) => `${d.path}|${indicatorOf(d)}`)
      .join(';'),
  );
  const stateMap = useMemo(() => new Map(openStates ? openStates.split(';').map((x) => x.split('|') as [string, string]) : []), [openStates]);

  const q = fold(filter.trim());
  const flat = useMemo(() => (q ? flattenTree(entries).filter((p) => fold(p).includes(q)) : null), [entries, q]);

  const clearHover = () => {
    if (hover.current) clearTimeout(hover.current.timer);
    hover.current = null;
  };
  useEffect(() => clearHover, []);

  if (error && !entries) return <div className="px-3 py-2 text-[12px] text-danger">{error}</div>;
  if (!entries)
    return (
      <div className="flex justify-center py-4 text-muted">
        <Spinner />
      </div>
    );

  const isActive = (path: string) => activeId === panelIdFor(panelKindFor(root, path) === 'latex' ? 'latex' : 'note', path);

  // ---- Renombrar ----
  const commitRename = (path: string, isDir: boolean, raw: string) => {
    setRenaming(null);
    let name = raw.trim();
    if (!name || name === basename(path) || name.includes('/')) return;
    const old = ext(path);
    if (!isDir && old && !ext(name)) name += '.' + old;
    void moveEntry(root, path, join(dirname(path), name), { rename: true, isDir });
  };

  // ---- Arrastrar y soltar ----
  const dragStart = (e: React.DragEvent, path: string) => {
    dragged = { root, path };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
  };
  const dragEnd = () => {
    dragged = null;
    clearHover();
    setDropTarget(null);
  };
  /** Fija el destino del arrastre; devuelve si es válido. */
  const over = (e: React.DragEvent, dir: string, collapsedFolder = false): boolean => {
    if (!dragged || dragged.root !== root || !canMoveInto(dragged.path, dir)) return false;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== dir) setDropTarget(dir);
    if (collapsedFolder) {
      if (hover.current?.path !== dir) {
        clearHover();
        hover.current = { path: dir, timer: setTimeout(() => expandPath(root, dir), 600) };
      }
    } else if (hover.current && hover.current.path !== dir) clearHover();
    return true;
  };
  const leave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropTarget(null);
  };
  const drop = (e: React.DragEvent, dir: string) => {
    const d = dragged;
    dragEnd();
    if (!d || d.root !== root || !canMoveInto(d.path, dir)) return;
    e.preventDefault();
    e.stopPropagation();
    void moveInto(root, d.path, dir);
  };

  // ---- Teclado en una fila ----
  const rowKeys = (e: React.KeyboardEvent, path: string, isDir: boolean) => {
    if (e.key === 'F2') {
      e.preventDefault();
      setRenaming(path);
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
      e.preventDefault();
      void deleteEntry(root, path, isDir);
    }
  };

  // ---- Menús ----
  const emptyMenu = (e: React.MouseEvent) =>
    openContextMenu(e, [
      { label: root === 'notes' ? 'Nueva nota…' : 'Nuevo archivo…', run: () => void createFileIn(root, '') },
      { label: 'Nueva carpeta…', run: () => void createFolderIn(root, '') },
    ]);

  const fileMenu = (path: string): MenuItem[] => [
    { label: 'Abrir', run: () => openFile(root, path) },
    { label: 'Abrir al lado', hint: `${ALT}clic`, run: () => openFile(root, path, { side: true }) },
    { label: 'Renombrar', hint: 'F2', run: () => setRenaming(path) },
    { label: 'Mover a…', run: () => openMoveDialog(root, path) },
    { label: 'Eliminar', hint: DEL_HINT, danger: true, run: () => void deleteEntry(root, path, false) },
    { label: 'Copiar ruta', run: () => void navigator.clipboard?.writeText(path) },
  ];

  const dirMenu = (path: string): MenuItem[] => [
    { label: root === 'notes' ? 'Nueva nota aquí…' : 'Nuevo archivo aquí…', run: () => void createFileIn(root, path) },
    { label: 'Nueva carpeta aquí…', run: () => void createFolderIn(root, path) },
    { label: 'Renombrar', hint: 'F2', run: () => setRenaming(path) },
    { label: 'Mover a…', run: () => openMoveDialog(root, path) },
    { label: 'Eliminar', hint: DEL_HINT, danger: true, run: () => void deleteEntry(root, path, true) },
    { label: 'Copiar ruta', run: () => void navigator.clipboard?.writeText(path) },
  ];

  const fileRow = (path: string, depth: number, label?: React.ReactNode) => {
    const st = stateMap.get(path);
    const cls = cx(
      'group flex h-[24px] w-full items-center gap-1.5 pr-2 text-left text-[12.5px] hover:bg-hover',
      isActive(path) && 'bg-active text-fg',
    );
    const style = { paddingLeft: 8 + depth * 12 + 14 };
    if (renaming === path)
      return (
        <div key={path} className={cls} style={style}>
          {iconFor(path)}
          <RenameInput initial={basename(path)} isDir={false} onCommit={(n) => commitRename(path, false, n)} onCancel={() => setRenaming(null)} />
        </div>
      );
    return (
      <button
        key={path}
        type="button"
        role="treeitem"
        aria-selected={isActive(path)}
        draggable
        className={cls}
        style={style}
        title={`${path}\n${ALT}clic: abrir al lado`}
        onClick={(e) => openFile(root, path, { side: e.altKey })}
        onKeyDown={(e) => rowKeys(e, path, false)}
        onDragStart={(e) => dragStart(e, path)}
        onDragEnd={dragEnd}
        // Soltar sobre un archivo = soltar en su carpeta.
        onDragOver={(e) => !flat && over(e, dirname(path))}
        onDrop={(e) => !flat && drop(e, dirname(path))}
        onContextMenu={(e) => {
          e.stopPropagation();
          openContextMenu(e, fileMenu(path));
        }}
      >
        {iconFor(path)}
        <span className="min-w-0 flex-1 truncate">{label ?? basename(path)}</span>
        {st === 'sin guardar' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="Sin guardar" />}
        {st === 'conflicto' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" title="Conflicto" />}
        <RowMenuButton label={`Acciones de ${basename(path)}`} items={() => fileMenu(path)} />
      </button>
    );
  };

  const dirRow = (e: Entry, depth: number, open: boolean) => {
    const cls = cx(
      'group flex h-[24px] w-full items-center gap-1 pr-2 text-left text-[12.5px] hover:bg-hover',
      dropTarget === e.path && 'bg-accent/20 outline outline-1 -outline-offset-1 outline-accent',
    );
    const style = { paddingLeft: 8 + depth * 12 };
    const chevron = open ? <ChevronDown size={13} className="shrink-0 text-faint" /> : <ChevronRight size={13} className="shrink-0 text-faint" />;
    const folder = open ? <FolderOpen size={14} className="shrink-0 text-muted" /> : <Folder size={14} className="shrink-0 text-muted" />;
    if (renaming === e.path)
      return (
        <div className={cls} style={style}>
          {chevron}
          {folder}
          <RenameInput initial={e.name} isDir onCommit={(n) => commitRename(e.path, true, n)} onCancel={() => setRenaming(null)} />
        </div>
      );
    return (
      <button
        type="button"
        role="treeitem"
        aria-expanded={open}
        draggable
        className={cls}
        style={style}
        onClick={() => toggleExpanded(root, e.path)}
        onKeyDown={(ev) => rowKeys(ev, e.path, true)}
        onDragStart={(ev) => dragStart(ev, e.path)}
        onDragEnd={dragEnd}
        onDragOver={(ev) => over(ev, e.path, !open)}
        onDragLeave={leave}
        onDrop={(ev) => drop(ev, e.path)}
        onContextMenu={(ev) => {
          ev.stopPropagation();
          openContextMenu(ev, dirMenu(e.path));
        }}
      >
        {chevron}
        {folder}
        <span className="min-w-0 flex-1 truncate">{e.name}</span>
        <RowMenuButton label={`Acciones de ${e.name}`} items={() => dirMenu(e.path)} />
      </button>
    );
  };

  const wrapper = (children: React.ReactNode) => (
    <div
      role="tree"
      className={cx('min-h-full', dropTarget === '' && 'bg-accent/10 outline outline-1 -outline-offset-1 outline-accent')}
      onContextMenu={emptyMenu}
      onDragOver={(e) => over(e, '')}
      onDragLeave={leave}
      onDrop={(e) => drop(e, '')}
    >
      {children}
    </div>
  );

  if (flat) {
    if (!flat.length) return <Empty>Ningún archivo coincide.</Empty>;
    return wrapper(
      flat.slice(0, 300).map((p) =>
        fileRow(
          p,
          0,
          <>
            {highlight(basename(p), filter)}
            <span className="ml-1.5 text-[11px] text-faint">{p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''}</span>
          </>,
        ),
      ),
    );
  }

  const render = (list: Entry[], depth: number): React.ReactNode =>
    list.map((e) => {
      if (e.type === 'file') return fileRow(e.path, depth);
      const open = expanded.has(e.path);
      return (
        <div key={e.path} role="group">
          {dirRow(e, depth, open)}
          {open && e.children && render(e.children, depth + 1)}
        </div>
      );
    });

  return wrapper(entries.length ? render(entries, 0) : <Empty>Carpeta vacía.</Empty>);
}

/** «⋯» al pasar por la fila (o con ella enfocada): abre el mismo menú que el clic derecho. */
function RowMenuButton({ label, items }: { label: string; items: () => MenuItem[] }) {
  const open = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    openContextMenu({ clientX: r.left, clientY: r.bottom + 2, preventDefault: () => {} }, items());
  };
  return (
    // span y no button: la fila ya es un <button> y no se pueden anidar.
    <span
      role="button"
      tabIndex={-1}
      aria-label={label}
      title="Más acciones"
      className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted group-hover:inline-flex group-focus-visible:inline-flex hover:bg-hover hover:text-fg"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        open(e.currentTarget);
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Ellipsis size={13} />
    </span>
  );
}
