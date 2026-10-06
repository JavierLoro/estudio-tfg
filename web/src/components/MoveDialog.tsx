import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownRight, Folder, FolderPlus, Home } from 'lucide-react';
import { create } from 'zustand';
import type { Root } from '../api';
import { basename, dirname } from '../lib/paths';
import { canMoveInto, createFolderIn, listDirs, moveInto } from '../state/files';
import { useUI } from '../state/ui';
import { fold } from './SearchView';
import { Button, Modal, cx } from './ui';

interface MoveTarget {
  root: Root;
  path: string;
}

const useMoveDialog = create<{ target: MoveTarget | null }>(() => ({ target: null }));

/** Abre «Mover a…» para un archivo o carpeta. */
export function openMoveDialog(root: Root, path: string) {
  useMoveDialog.setState({ target: { root, path } });
}

const close = () => useMoveDialog.setState({ target: null });

/** Diálogo «Mover a…»: lista de carpetas con buscador, la raíz y «Nueva carpeta…». */
export function MoveDialog() {
  const target = useMoveDialog((s) => s.target);
  const trees = useUI((s) => s.trees);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (target) {
      setQ('');
      setSel('');
    }
  }, [target]);

  const folders = useMemo(() => {
    if (!target) return [];
    const fq = fold(q.trim());
    const dirs = listDirs(trees[target.root]).filter((d) => canMoveInto(target.path, d) || d === dirname(target.path));
    return ['', ...dirs.filter((d) => !fq || fold(d).includes(fq))].filter((d) => d !== '' || !fq || fold('raíz').includes(fq));
  }, [target, trees, q]);

  useEffect(() => {
    list.current?.querySelector(`[data-sel="true"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!target) return null;
  const here = dirname(target.path);
  const valid = (d: string) => canMoveInto(target.path, d);

  const confirm = () => {
    if (!valid(sel)) return;
    close();
    void moveInto(target.root, target.path, sel);
  };
  const step = (delta: number) => {
    const i = folders.indexOf(sel);
    const next = folders[Math.min(Math.max((i < 0 ? 0 : i) + delta, 0), folders.length - 1)];
    if (next != null) setSel(next);
  };
  const newFolder = async () => {
    const created = await createFolderIn(target.root, sel);
    if (created != null) {
      setQ('');
      setSel(created);
    }
  };

  return (
    <Modal
      open
      // Esc en «Nueva carpeta…» (otro diálogo encima) no debe cerrar este.
      onClose={() => !useUI.getState().prompt && close()}
      title={`Mover «${basename(target.path)}» a…`}
      width={460}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => void newFolder()}>
            <FolderPlus size={13} /> Nueva carpeta…
          </Button>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={confirm} disabled={!valid(sel)}>
            Mover aquí
          </Button>
        </>
      }
    >
      <div className="border-b border-line p-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              step(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              step(-1);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              confirm();
            }
          }}
          placeholder="Buscar carpeta…"
          aria-label="Buscar carpeta"
          className="h-8 w-full rounded-md border border-line-strong bg-bg px-2 text-[13px] outline-none focus:border-accent"
        />
        {sel !== '' && <div className="mt-1 text-[11px] text-faint">Destino: {sel}/</div>}
      </div>
      <div ref={list} role="listbox" aria-label="Carpetas" className="max-h-[50vh] overflow-auto py-1">
        {folders.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-faint">Sin carpetas que coincidan.</div>}
        {folders.map((d) => {
          const active = d === sel;
          const disabled = !valid(d);
          const depth = d ? d.split('/').length - 1 : 0;
          return (
            <div
              key={d || '/'}
              role="option"
              aria-selected={active}
              aria-disabled={disabled}
              data-sel={active}
              onClick={() => !disabled && setSel(d)}
              onDoubleClick={() => {
                if (!disabled) {
                  setSel(d);
                  close();
                  void moveInto(target.root, target.path, d);
                }
              }}
              className={cx(
                'flex h-7 items-center gap-2 pr-3 text-[12.5px]',
                disabled ? 'cursor-default text-faint' : 'cursor-pointer hover:bg-hover',
                active && 'bg-active',
              )}
              style={{ paddingLeft: 12 + depth * 12 }}
            >
              {d === '' ? <Home size={14} className="shrink-0 text-muted" /> : <Folder size={14} className="shrink-0 text-muted" />}
              <span className="truncate">{d === '' ? 'Raíz' : basename(d)}</span>
              {d !== '' && fold(q.trim()) && <span className="min-w-0 truncate text-[11px] text-faint">{dirname(d)}</span>}
              {d === here && <span className="ml-auto text-[10.5px] text-faint">actual</span>}
              {active && !disabled && <CornerDownRight size={12} className="ml-auto opacity-60" />}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
