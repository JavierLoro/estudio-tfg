// Sección «Diagramas» del panel lateral: los diagramas de la memoria (diagramas/*.mmd) con
// el estado de su figura exportada, para abrirlos, crearlos y gestionarlos desde un sitio.
import { useEffect, useMemo, useState } from 'react';
import { sideHint } from '../lib/shortcuts';
import { openActions } from './OpenActions';
import { Ellipsis, Plus, RefreshCw, Workflow, X } from 'lucide-react';
import type { DiagramaItem } from '../api';
import { basename } from '../lib/paths';
import {
  deleteDiagram,
  diagramName,
  exportDiagram,
  openInsertFigure,
  openNewDiagram,
  renameDiagram,
  useDiagramas,
} from '../state/diagramas';
import { openFile, panelIdFor, useActivePanel } from '../state/workspace';
import { openContextMenu, type MenuItem } from './ContextMenu';
import { Button, Empty, IconButton, Input, Spinner, cx } from './ui';

const ESTADO: Record<DiagramaItem['estado'], { label: string; cls: string; title: string }> = {
  exportado: { label: 'Exportada', cls: 'text-ok', title: 'La figura de la memoria está al día' },
  desactualizado: { label: 'Desactualizada', cls: 'text-warn', title: 'El diagrama cambió desde la última exportación' },
  'sin-exportar': { label: 'Sin exportar', cls: 'text-muted', title: 'Aún no hay figura para la memoria' },
};

export function DiagramasSection() {
  const items = useDiagramas((s) => s.items);
  const error = useDiagramas((s) => s.error);
  const [filter, setFilter] = useState('');
  const activeId = useActivePanel((s) => s.id);

  useEffect(() => {
    void useDiagramas.getState().refresh();
  }, []);

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (items ?? [])
      .filter((it) => !q || it.nombre.toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [items, filter]);

  const counts = useMemo(() => {
    const c = { desactualizado: 0, 'sin-exportar': 0 };
    for (const it of items ?? []) if (it.estado !== 'exportado') c[it.estado]++;
    return c;
  }, [items]);

  const menu = (it: DiagramaItem): MenuItem[] => {
    const m: MenuItem[] = [
      { label: 'Abrir', run: () => openFile('memoria', it.path) },
      { label: 'Abrir al lado', hint: sideHint(), run: () => openFile('memoria', it.path, { side: true }) },
      { label: it.estado === 'sin-exportar' ? 'Exportar figura' : 'Volver a exportar', run: () => void exportDiagram(it.path) },
      { label: 'Insertar en la memoria…', run: () => openInsertFigure(it.path) },
    ];
    for (const u of it.usos.slice(0, 5)) {
      m.push({ label: `Ver uso en ${basename(u.file)}:${u.line}`, run: () => openFile('memoria', u.file, { line: u.line }) });
    }
    m.push(
      { label: 'Renombrar…', run: () => void renameDiagram(it) },
      { label: 'Copiar \\includegraphics', run: () => void navigator.clipboard?.writeText(`\\includegraphics[width=0.8\\textwidth]{${it.nombre}}`) },
      { label: 'Eliminar', danger: true, run: () => void deleteDiagram(it) },
    );
    return m;
  };

  return (
    <>
      <div className="flex h-(--et-toolbar) shrink-0 items-center gap-0.5 pr-1.5 pl-3">
        <h2 className="flex-1 text-sm font-semibold tracking-wider text-muted uppercase">Diagramas</h2>
        <IconButton label="Nuevo diagrama" onClick={() => openNewDiagram('')}>
          <Plus size={16} />
        </IconButton>
        <IconButton label="Recargar" onClick={() => void useDiagramas.getState().refresh()}>
          <RefreshCw size={16} />
        </IconButton>
      </div>
      {items && items.length > 0 && (
        <div className="px-2 pb-1.5">
          <div className="relative">
            <Input
              inputSize="sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
              placeholder="Filtrar diagramas…"
              aria-label="Filtrar diagramas"
              className="pr-9!"
            />
            {filter && (
              <IconButton label="Limpiar filtro" className="absolute top-1/2 right-0 -translate-y-1/2" onClick={() => setFilter('')}>
                <X size={16} />
              </IconButton>
            )}
          </div>
        </div>
      )}
      {(counts.desactualizado > 0 || counts['sin-exportar'] > 0) && (
        <p className="px-3 pb-1.5 text-sm text-muted">
          {counts.desactualizado > 0 && <span className="text-warn">{counts.desactualizado} desactualizada{counts.desactualizado === 1 ? '' : 's'}</span>}
          {counts.desactualizado > 0 && counts['sin-exportar'] > 0 && ' · '}
          {counts['sin-exportar'] > 0 && <span>{counts['sin-exportar']} sin exportar</span>}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto" role="list" aria-label="Diagramas de la memoria">
        {items === null ? (
          error ? (
            <Empty>No se pudieron cargar los diagramas: {error}</Empty>
          ) : (
            <div className="flex justify-center py-4 text-muted">
              <Spinner />
            </div>
          )
        ) : items.length === 0 ? (
          <Empty
            icon={<Workflow size={26} />}
            action={
              <>
                <Button variant="primary" onClick={() => openNewDiagram('')}>
                  <Plus size={16} /> Nuevo diagrama
                </Button>
                <p>También puedes usar un bloque mermaid de una nota con «Usar en la memoria».</p>
              </>
            }
          >
            <p className="text-ui">Aún no hay diagramas en la memoria.</p>
          </Empty>
        ) : list.length === 0 ? (
          <Empty>Ningún diagrama coincide.</Empty>
        ) : (
          list.map((it) => {
            const st = ESTADO[it.estado];
            const name = diagramName(it.path) ?? it.nombre;
            const folder = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
            const active = activeId === panelIdFor('diagram', it.path);
            const n = it.usos.length;
            return (
              <div
                key={it.path}
                role="listitem"
                className={cx('group flex min-h-(--et-row) w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left hover:bg-hover', active && 'bg-active')}
                title={`${it.path}\n${sideHint()}: abrir al lado`}
                {...openActions((side) => openFile('memoria', it.path, { side }), () => menu(it))}
              >
                <Workflow size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui text-fg">
                    {basename(name)}
                    {folder && <span className="ml-1.5 text-sm text-muted">{folder}</span>}
                  </span>
                  <span className="flex gap-1.5 text-sm">
                    <span className={st.cls} title={st.title}>
                      {st.label}
                    </span>
                    <span className="text-muted">· {n ? `en ${n} ${n === 1 ? 'sitio' : 'sitios'}` : 'sin usar'}</span>
                  </span>
                </span>
                <IconButton
                  label={`Acciones de ${basename(name)}`}
                  title="Más acciones"
                  className="-my-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    openContextMenu({ clientX: r.left, clientY: r.bottom + 2, preventDefault: () => {} }, menu(it));
                  }}
                >
                  <Ellipsis size={16} />
                </IconButton>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
