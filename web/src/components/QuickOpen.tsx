import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, FileCode2, FileText, Inbox, Search } from 'lucide-react';
import type { Root } from '../api';
import { basename } from '../lib/paths';
import { flattenTree, useUI } from '../state/ui';
import { openFile, openResource, openSearch } from '../state/workspace';
import { fold, highlight, useSearch } from './SearchView';
import { ALT, cx } from './ui';

type Item =
  | { kind: 'file'; root: Root; path: string; score: number }
  | { kind: 'resource'; path: string; title: string; score: number }
  | { kind: 'hit'; root: Root; path: string; line: number; snippet: string }
  | { kind: 'search' };

/** Puntuación difusa sencilla: subsecuencia, premiando el nombre y los inicios de palabra. */
function score(path: string, q: string): number {
  const name = fold(basename(path));
  const full = fold(path);
  if (!q) return 1;
  if (name.startsWith(q)) return 1000 - name.length;
  if (name.includes(q)) return 800 - name.length;
  if (full.includes(q)) return 500 - full.length;
  let i = 0;
  let s = 0;
  for (let k = 0; k < full.length && i < q.length; k++) {
    if (full[k] === q[i]) {
      s += k === 0 || '/ -_.'.includes(full[k - 1]) ? 5 : 1;
      i++;
    }
  }
  return i === q.length ? s : -1;
}

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
    if (fq.length >= 2) {
      out.push({ kind: 'search' });
      for (const h of (hits ?? []).filter((h) => h.line > 1 || !fold(basename(h.path)).includes(fq)).slice(0, 25)) {
        out.push({ kind: 'hit', root: h.root, path: h.path, line: h.line, snippet: h.snippet });
      }
    }
    return out;
  }, [fq, trees, resources, recents, hits]);

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
                choose(items[sel], e.altKey);
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
              onClick: (e: React.MouseEvent) => choose(it, e.altKey),
              className: cx('flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-[12.5px]', active && 'bg-active'),
            } as const;
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
        <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line px-3 text-[10.5px] text-faint">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>{ALT}↵ abrir al lado</span>
          <span>esc cerrar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
