import { create } from 'zustand';
import { api, errorMessage, type Entry, type Resource, type Root, type Status } from '../api';
import { load, save } from '../lib/storage';

export type Section = 'home' | 'memoria' | 'notes' | 'resources' | 'search';

export interface Toast {
  id: number;
  kind: 'info' | 'ok' | 'error' | 'warn';
  text: string;
  action?: { label: string; run: () => void };
  timeout?: number;
}

export interface RecentItem {
  root: Root;
  path: string;
  at: number;
}

interface PromptRequest {
  title: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  password?: boolean;
  okLabel?: string;
  resolve: (v: string | null) => void;
}

interface UIState {
  section: Section;
  sidebarOpen: boolean;
  setSection: (s: Section) => void;
  toggleSidebar: () => void;

  captureOpen: boolean;
  setCaptureOpen: (v: boolean) => void;
  quickOpen: boolean;
  quickOpenQuery: string;
  setQuickOpen: (v: boolean, q?: string) => void;

  sidebarSearch: string;
  setSidebarSearch: (q: string) => void;

  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => number;
  dismissToast: (id: number) => void;

  prompt: PromptRequest | null;
  ask: (p: Omit<PromptRequest, 'resolve'>) => Promise<string | null>;
  closePrompt: (v: string | null) => void;

  status: Status | null;
  statusError: string | null;
  refreshStatus: () => Promise<void>;

  trees: Partial<Record<Root, Entry[]>>;
  treeErrors: Partial<Record<Root, string>>;
  refreshTree: (root: Root) => Promise<void>;

  resources: Resource[] | null;
  resourcesError: string | null;
  refreshResources: () => Promise<void>;

  recents: RecentItem[];
  pushRecent: (root: Root, path: string) => void;
  dropRecent: (root: Root, path: string) => void;
}

const RECENTS_KEY = 'et:recents';
const SIDEBAR_KEY = 'et:sidebar';
let toastSeq = 1;

const sidebarSaved = load<{ section: Section; open: boolean }>(SIDEBAR_KEY, { section: 'memoria', open: true });

export const useUI = create<UIState>((set, get) => ({
  section: sidebarSaved.section,
  sidebarOpen: sidebarSaved.open,
  setSection: (s) => {
    const { section, sidebarOpen } = get();
    // Clic en la sección activa: pliega/despliega.
    const open = s === section ? !sidebarOpen : true;
    set({ section: s, sidebarOpen: open });
    save(SIDEBAR_KEY, { section: s, open });
  },
  toggleSidebar: () => {
    const open = !get().sidebarOpen;
    set({ sidebarOpen: open });
    save(SIDEBAR_KEY, { section: get().section, open });
  },

  captureOpen: false,
  setCaptureOpen: (v) => set({ captureOpen: v }),
  quickOpen: false,
  quickOpenQuery: '',
  setQuickOpen: (v, q) => set({ quickOpen: v, quickOpenQuery: q ?? '' }),

  sidebarSearch: '',
  setSidebarSearch: (q) => set({ sidebarSearch: q }),

  toasts: [],
  toast: (t) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    const timeout = t.timeout ?? (t.kind === 'error' ? 8000 : t.action ? 8000 : 4500);
    if (timeout > 0) setTimeout(() => get().dismissToast(id), timeout);
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),

  prompt: null,
  ask: (p) =>
    new Promise((resolve) => {
      get().prompt?.resolve(null);
      set({ prompt: { ...p, resolve } });
    }),
  closePrompt: (v) => {
    const p = get().prompt;
    set({ prompt: null });
    p?.resolve(v);
  },

  status: null,
  statusError: null,
  refreshStatus: async () => {
    try {
      const status = await api.status();
      set({ status, statusError: null });
    } catch (e) {
      set({ statusError: errorMessage(e) });
    }
  },

  trees: {},
  treeErrors: {},
  refreshTree: async (root) => {
    try {
      const t = await api.tree(root);
      set({ trees: { ...get().trees, [root]: t.entries }, treeErrors: { ...get().treeErrors, [root]: undefined } });
    } catch (e) {
      set({ treeErrors: { ...get().treeErrors, [root]: errorMessage(e) } });
    }
  },

  resources: null,
  resourcesError: null,
  refreshResources: async () => {
    try {
      const r = await api.resources();
      set({ resources: r.items, resourcesError: null });
    } catch (e) {
      set({ resourcesError: errorMessage(e) });
    }
  },

  recents: load<RecentItem[]>(RECENTS_KEY, []),
  pushRecent: (root, path) => {
    const recents = [{ root, path, at: Date.now() }, ...get().recents.filter((r) => !(r.root === root && r.path === path))].slice(0, 30);
    set({ recents });
    save(RECENTS_KEY, recents);
  },
  dropRecent: (root, path) => {
    const recents = get().recents.filter((r) => !(r.root === root && r.path === path));
    set({ recents });
    save(RECENTS_KEY, recents);
  },
}));

export const toast = (t: Omit<Toast, 'id'>) => useUI.getState().toast(t);

/** Lista plana de archivos de un árbol. */
export function flattenTree(entries: Entry[] | undefined, out: string[] = []): string[] {
  if (!entries) return out;
  for (const e of entries) {
    if (e.type === 'file') out.push(e.path);
    else flattenTree(e.children, out);
  }
  return out;
}
