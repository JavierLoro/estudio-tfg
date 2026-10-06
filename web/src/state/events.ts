import type { ChangeEvent, CompileResult, Root, SettingsResponse } from '../api';
import { notifySettingsChanged } from './settings';
import { handleExternalChange } from './docs';
import { useCompile } from './compile';
import { useUI } from './ui';
import { handleMoveEvent } from './files';
import { handleOutlineEvent, refreshOutlineSoon, useOutline } from './outline';
import { invalidateRefs, refreshRefsSoon } from './refs';
import { create } from 'zustand';

type Listener = (ev: ChangeEvent) => void;
const listeners = new Set<Listener>();

/** Suscripción a cambios en disco (para paneles que no usan el store de documentos). */
export function onFileChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const useConnection = create<{ connected: boolean }>(() => ({ connected: false }));

const treeTimers: Partial<Record<Root, ReturnType<typeof setTimeout>>> = {};
function refreshTreeSoon(root: Root) {
  const t = treeTimers[root];
  if (t) clearTimeout(t);
  treeTimers[root] = setTimeout(() => useUI.getState().refreshTree(root), 250);
}

let resTimer: ReturnType<typeof setTimeout> | null = null;
function refreshResourcesSoon() {
  if (resTimer) clearTimeout(resTimer);
  resTimer = setTimeout(() => useUI.getState().refreshResources(), 300);
}

let statusTimer: ReturnType<typeof setTimeout> | null = null;
function refreshStatusSoon() {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => useUI.getState().refreshStatus(), 1000);
}

let source: EventSource | null = null;

export function connectEvents() {
  if (source) return;
  const es = new EventSource('/api/events');
  source = es;
  es.onopen = () => {
    const was = useConnection.getState().connected;
    useConnection.setState({ connected: true });
    if (!was) {
      // Tras una reconexión, ponerse al día.
      useUI.getState().refreshStatus();
      useCompile.getState().fetchLast();
      void useOutline.getState().refresh();
    }
  };
  es.onerror = () => useConnection.setState({ connected: false });
  es.addEventListener('change', (msg) => {
    let ev: ChangeEvent;
    try {
      ev = JSON.parse((msg as MessageEvent).data);
    } catch {
      return;
    }
    if (ev.kind !== 'change') refreshTreeSoon(ev.root);
    if (ev.kind === 'move' && ev.from) handleMoveEvent(ev.root, ev.from, ev.path);
    if (ev.root === 'memoria') {
      useCompile.getState().markMemoriaChanged();
      // Respaldo: el server emite `outline` al cambiar; si no llega, se relee igualmente.
      if (/\.(tex|bib)$/i.test(ev.path)) refreshOutlineSoon(2000);
      refreshRefsSoon(ev.path);
    }
    const sub = useUI.getState().status?.resourcesSubdir ?? 'Recursos';
    if (ev.root === 'notes' && (ev.path === sub || ev.path.startsWith(sub + '/'))) refreshResourcesSoon();
    if (ev.path.includes('.sync-conflict-')) refreshStatusSoon();
    void handleExternalChange(ev);
    for (const l of listeners) l(ev);
  });
  es.addEventListener('settings', (msg) => {
    // Datos: los valores nuevos (o el formato completo de GET /api/settings).
    let data: Partial<SettingsResponse> | null = null;
    try {
      data = JSON.parse((msg as MessageEvent).data);
    } catch {
      /* da igual: se relee el estado */
    }
    invalidateRefs();
    void notifySettingsChanged(data && 'values' in data && 'sources' in data ? (data as SettingsResponse) : undefined);
  });
  es.addEventListener('outline', (msg) => handleOutlineEvent((msg as MessageEvent).data));
  es.addEventListener('compile', (msg) => {
    try {
      const r = JSON.parse((msg as MessageEvent).data) as CompileResult;
      useCompile.getState().setResult(r);
    } catch {
      /* ignore */
    }
  });
}
