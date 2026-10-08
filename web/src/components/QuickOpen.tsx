import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, FilePlus2, FileCode2, FileText, Inbox, Search, Workflow } from 'lucide-react';
import type { Root } from '../api';
import { score } from '../lib/quickOpen';
import { kbd } from '../lib/kbd';
import { sideByEvent } from '../lib/shortcuts';
import { openActions } from './OpenActions';
import { basename, stripExt } from '../lib/paths';
import { createNoteAt } from '../state/files';
import { openNewDiagram, sanitizeDiagramName, useNewDiagram } from '../state/diagramas';
import { flattenTree, useUI } from '../state/ui';
import { openFile, openResource, openSearch } from '../state/workspace';
import { fold, highlight, useSearch } from './SearchView';
import { cx } from './ui';

type Item =
  | { kind: 'file'; root: Root; path: string; score: number }
  | { kind: 'resource'; path: string; title: string; score: number }
  | { kind: 'hit'; root: Root; path: string; line: number; snippet: string }
  | { kind: 'create'; path: string }
  | { kind: 'diagram'; name: string }
  | { kind: 'search' };

export function QuickOpen() {
  const open = useUI((s) => s.quickOpen);
  const initial = useUI((s) => s.quickOpenQuery);
  const setOpen = useUI((s) => s.setQuickOpen);
  const trees = useUI((s) => s.trees);
  const resources = useUI((s) => s.resources);
  const recents = useUI((s) => s.recents);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ(initial);
      setSel(0);
      const ui = useUI.getState();
      if (!ui.trees.memoria) void ui.refreshTree('memoria');
      if (!ui.trees.notes) void ui.refreshTree('notes');
      if (!ui.resources) void ui.refreshResources();
      setTimeout(() => input.current?.select(), 0);
    }
  }, [open, initial]);

  const fq = fold(q.trim());
  const { items: hits } = useSearch(open ? q : '', 'all');

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (!fq) {
      for (const r of recents.slice(0, 12)) out.push({ kind: 'file', root: r.root, path: r.path, score: 0 });
      return out;
    }
    const files: Item[] = [];
    for (const root of ['memoria', 'notes'] as Root[]) {
      for (const p of flattenTree(trees[root])) {
        const s = score(p, fq);
        if (s >= 0) files.push({ kind: 'file', root, path: p, score: s + (root === 'memoria' ? 2 : 0) });
      }
    }
    files.sort((a, b) => (b as { score: number }).score - (a as { score: number }).score);
    out.push(...files.slice(0, 30));
    const res = (resources ?? [])
      .filter((r) => fold(r.title).includes(fq) || fold(r.url ?? '').includes(fq))
      .slice(0, 8)
      .map((r) => ({ kind: 'resource' as const, path: r.path, title: r.title, score: 0 }));
    out.push(...res);
    // v0.8: «Nuevo diagrama» al escribir «nuevo diagrama» o «diagrama <nombre>».
    const dm = /^(?:nuevo\s+)?diagrama\s+(.+)$/.exec(fold(q.trim()));
    if (fq.length >= 3 && 'nuevo diagrama'.includes(fq)) out.push({ kind: 'diagram', name: '' });
    else if (dm && sanitizeDiagramName(dm[1])) out.push({ kind: 'diagram', name: sanitizeDiagramName(q.trim().split(/\s+/).slice(dm[0].startsWith('nuevo') ? 2 : 1).join(' ')) });
    // Sin coincidencia exacta con una nota: ofrecer crearla (admite Carpeta/Nombre).
    const typed = q.trim().replace(/^\/+|\/+$/g, '');
    if (typed) {
      const want = fold(typed.replace(/\.md$/i, ''));
      const exact = flattenTree(trees.notes).some((p) => {
        const noExt = fold(p.replace(/\.md$/i, ''));
        return noExt === want || (!want.includes('/') && fold(stripExt(basename(p))) === want);
      });
      if (!exact) out.push({ kind: 'create', path: typed });
    }
    if (fq.length >= 2) {
      out.push({ kind: 'search' });
      for (const h of (hits ?? []).filter((h) => h.line > 1 || !fold(basename(h.path)).includes(fq)).slice(0, 25)) {
        out.push({ kind: 'hit', root: h.root, path: h.path, line: h.line, snippet: h.snippet });
      }
    }
    return out;
  }, [fq, q, trees, resources, recents, hits]);

  useEffect(() => {
    if (sel >= items.length) setSel(Math.max(0, items.length - 1));
  }, [items.length, sel]);

  useEffect(() => {
    list.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;
  const close = () => setOpen(false);

  const choose = (it: Item | undefined, side: boolean) => {
    if (!it) return;
    close();
    if (it.kind === 'file') openFile(it.root, it.path, { side });
    else if (it.kind === 'resource') openResource(it.path, { side });
    else if (it.kind === 'create') void createNoteAt(it.path);
    else if (it.kind === 'diagram') {
      openNewDiagram('');
      if (it.name) useNewDiagram.setState((s) => ({ req: s.req ? { ...s.req, name: it.name } : s.req }));
    }
    else if (it.kind === 'hit') openFile(it.root, it.path, { side, line: it.line });
    else openSearch(q.trim(), 'all', { side });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/25 p-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div role="dialog" aria-modal="true" aria-label="Abrir o buscar" className="flex max-h-[70vh] w-[640px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-bg shadow-pop">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <Search size={15} className="text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(items[sel], sideByEvent(e));
              }
            }}
            placeholder="Nombre de archivo, recurso o texto…"
            aria-label="Buscar"
            role="combobox"
            aria-expanded="true"
            aria-controls="et-quickopen-list"
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          />
        </div>
        <div ref={list} id="et-quickopen-list" role="listbox" className="min-h-0 flex-1 overflow-auto py-1">
          {!fq && items.length > 0 && <div className="px-3 py-1 text-[11px] text-faint">Recientes</div>}
          {items.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-faint">{fq ? 'Sin coincidencias' : 'Escribe para buscar'}</div>}
          {items.map((it, i) => {
            const active = i === sel;
            const common = {
              'data-idx': i,
              role: 'option',
              'aria-selected': active,
              onMouseMove: () => setSel(i),
              ...(it.kind === 'create' || it.kind === 'diagram'
                ? { onClick: () => choose(it, false) }
                : openActions((side) => choose(it, side))),
              className: cx('flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-[12.5px]', active && 'bg-active'),
            } as const;
            if (it.kind === 'create')
              return (
                <div key="create" {...common} className={cx(common.className, 'text-accent')}>
                  <FilePlus2 size={14} className="shrink-0" /> Crear nota «{it.path}»
                  {active && <CornerDownLeft size={12} className="ml-auto opacity-60" />}
                </div>
              );
            if (it.kind === 'diagram')
              return (
                <div key="diagram" {...common} className={cx(common.className, 'text-accent')}>
                  <Workflow size={14} className="shrink-0" /> {it.name ? `Nuevo diagrama «${it.name}» en la memoria` : 'Nuevo diagrama en la memoria…'}
                  {active && <CornerDownLeft size={12} className="ml-auto opacity-60" />}
                </div>
              );
            if (it.kind === 'search')
              return (
                <div key="search" {...common} className={cx(common.className, 'mt-1 border-t border-line pt-1.5 text-accent')}>
                  <Search size={13} /> Buscar «{q.trim()}» en todo (abrir panel)
                  {active && <CornerDownLeft size={12} className="ml-auto opacity-60" />}
                </div>
              );
            if (it.kind === 'hit')
              return (
                <div key={`h-${i}`} {...common}>
                  <span className="w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-muted">{highlight(it.snippet, q)}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-faint">
                    {basename(it.path)}:{it.line}
                  </span>
                </div>
              );
            if (it.kind === 'resource')
              return (
                <div key={`r-${it.path}`} {...common}>
                  <Inbox size={14} className="shrink-0 text-muted" />
                  <span className="truncate">{highlight(it.title, q)}</span>
                  <span className="ml-auto shrink-0 text-[10.5px] text-faint">recurso</span>
                </div>
              );
            return (
              <div key={`f-${it.root}-${it.path}`} {...common}>
                {it.root === 'memoria' ? <FileCode2 size={14} className="shrink-0 text-muted" /> : <FileText size={14} className="shrink-0 text-muted" />}
                <span className="shrink-0">{highlight(basename(it.path), q)}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{it.path}</span>
                <span className="shrink-0 text-[10.5px] text-faint">{it.root === 'memoria' ? 'memoria' : 'notas'}</span>
              </div>
            );
          })}
        </div>
        <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-1 text-[10.5px] text-faint">
          <span>{kbd('ArrowUp')}{kbd('ArrowDown')} navegar</span>
          <span>{kbd('Enter')} abrir</span>
          <span>{kbd('Alt-Enter')} / {kbd('Ctrl-Shift-Enter')} / clic central: abrir al lado</span>
          <span>{kbd('Escape')} cerrar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
