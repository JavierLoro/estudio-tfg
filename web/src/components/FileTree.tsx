import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, File, FileCode2, FileImage, FileText, Folder, FolderOpen } from 'lucide-react';
import { api, errorMessage, type Entry, type Root } from '../api';
import { basename, ext, join } from '../lib/paths';
import { load, save } from '../lib/storage';
import { indicatorOf, useDocs } from '../state/docs';
import { flattenTree, toast, useUI } from '../state/ui';
import { openFile, panelIdFor, useActivePanel } from '../state/workspace';
import { openContextMenu } from './ContextMenu';
import { fold, highlight } from './SearchView';
import { ALT, Empty, Spinner, cx } from './ui';
import { panelKindFor } from '../lib/paths';

function iconFor(path: string) {
  const e = ext(path);
  if (['tex', 'sty', 'cls', 'bib', 'bst'].includes(e)) return <FileCode2 size={14} className="shrink-0 text-muted" />;
  if (e === 'md') return <FileText size={14} className="shrink-0 text-muted" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'eps'].includes(e)) return <FileImage size={14} className="shrink-0 text-faint" />;
  return <File size={14} className="shrink-0 text-faint" />;
}

const expKey = (root: Root) => `et:tree-expanded:${root}`;

export async function createFileIn(root: Root, dir: string) {
  const ui = useUI.getState();
  const isNotes = root === 'notes';
  const name = await ui.ask({
    title: isNotes ? 'Nueva nota' : 'Nuevo archivo de la memoria',
    label: dir ? `En «${dir}/»` : 'En la raíz',
    placeholder: isNotes ? 'Nombre de la nota' : 'capitulo.tex',
    okLabel: 'Crear',
  });
  if (!name?.trim()) return;
  let rel = name.trim();
  if (!ext(rel)) rel += isNotes ? '.md' : '.tex';
  const path = join(dir, rel);
  const title = basename(path).replace(/\.[^.]+$/, '');
  const content = ext(path) === 'md' ? `# ${title}\n\n` : ext(path) === 'tex' ? `% ${basename(path)}\n\n` : '';
  try {
    await api.createFile(root, path, content);
    await useUI.getState().refreshTree(root);
    openFile(root, path);
  } catch (e) {
    toast({ kind: 'error', text: `No se pudo crear «${path}»: ${errorMessage(e)}` });
  }
}

export function FileTree({ root, filter }: { root: Root; filter: string }) {
  const entries = useUI((s) => s.trees[root]);
  const error = useUI((s) => s.treeErrors[root]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(load<string[]>(expKey(root), [])));
  const activeId = useActivePanel((s) => s.id);
  // Estado de guardado de los documentos abiertos de esta raíz: "ruta|estado;…"
  const openStates = useDocs((s) =>
    Object.values(s.docs)
      .filter((d) => d.root === root)
      .map((d) => `${d.path}|${indicatorOf(d)}`)
      .join(';'),
  );
  const stateMap = useMemo(() => new Map(openStates ? openStates.split(';').map((x) => x.split('|') as [string, string]) : []), [openStates]);

  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
    save(expKey(root), [...next]);
  };

  const q = fold(filter.trim());
  const flat = useMemo(() => (q ? flattenTree(entries).filter((p) => fold(p).includes(q)) : null), [entries, q]);

  if (error && !entries) return <div className="px-3 py-2 text-[12px] text-danger">{error}</div>;
  if (!entries)
    return (
      <div className="flex justify-center py-4 text-muted">
        <Spinner />
      </div>
    );

  const isActive = (path: string) => activeId === panelIdFor(panelKindFor(root, path) === 'latex' ? 'latex' : 'note', path);

  const fileRow = (path: string, depth: number, label?: React.ReactNode) => {
    const st = stateMap.get(path);
    return (
      <button
        key={path}
        type="button"
        role="treeitem"
        aria-selected={isActive(path)}
        className={cx(
          'group flex h-[24px] w-full items-center gap-1.5 pr-2 text-left text-[12.5px] hover:bg-hover',
          isActive(path) && 'bg-active text-fg',
        )}
        style={{ paddingLeft: 8 + depth * 12 + 14 }}
        title={`${path}\n${ALT}clic: abrir al lado`}
        onClick={(e) => openFile(root, path, { side: e.altKey })}
        onContextMenu={(e) =>
          openContextMenu(e, [
            { label: 'Abrir', run: () => openFile(root, path) },
            { label: 'Abrir al lado', hint: `${ALT}clic`, run: () => openFile(root, path, { side: true }) },
            { label: 'Copiar ruta', run: () => void navigator.clipboard?.writeText(path) },
          ])
        }
      >
        {iconFor(path)}
        <span className="min-w-0 flex-1 truncate">{label ?? basename(path)}</span>
        {st === 'sin guardar' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="Sin guardar" />}
        {st === 'conflicto' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" title="Conflicto" />}
      </button>
    );
  };

  if (flat) {
    if (!flat.length) return <Empty>Ningún archivo coincide.</Empty>;
    return (
      <div role="tree">
        {flat.slice(0, 300).map((p) =>
          fileRow(
            p,
            0,
            <>
              {highlight(basename(p), filter)}
              <span className="ml-1.5 text-[11px] text-faint">{p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''}</span>
            </>,
          ),
        )}
      </div>
    );
  }

  const render = (list: Entry[], depth: number): React.ReactNode =>
    list.map((e) => {
      if (e.type === 'file') return fileRow(e.path, depth);
      const open = expanded.has(e.path);
      return (
        <div key={e.path} role="group">
          <button
            type="button"
            role="treeitem"
            aria-expanded={open}
            className="flex h-[24px] w-full items-center gap-1 pr-2 text-left text-[12.5px] hover:bg-hover"
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => toggle(e.path)}
            onContextMenu={(ev) =>
              openContextMenu(ev, [
                { label: root === 'notes' ? 'Nueva nota aquí…' : 'Nuevo archivo aquí…', run: () => void createFileIn(root, e.path) },
                { label: 'Copiar ruta', run: () => void navigator.clipboard?.writeText(e.path) },
              ])
            }
          >
            {open ? <ChevronDown size={13} className="shrink-0 text-faint" /> : <ChevronRight size={13} className="shrink-0 text-faint" />}
            {open ? <FolderOpen size={14} className="shrink-0 text-muted" /> : <Folder size={14} className="shrink-0 text-muted" />}
            <span className="truncate">{e.name}</span>
          </button>
          {open && e.children && render(e.children, depth + 1)}
        </div>
      );
    });

  if (!entries.length) return <Empty>Carpeta vacía.</Empty>;
  return <div role="tree">{render(entries, 0)}</div>;
}
