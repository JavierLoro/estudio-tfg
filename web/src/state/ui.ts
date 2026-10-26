import { getInstance } from '../lib/instance';
import { create } from 'zustand';
import { api, errorMessage, type Entry, type Resource, type Root, type Status } from '../api';
import { load, save } from '../lib/storage';
import { SECTIONS, clampRatio, isSection, spacesKey, type Section, type Sidebars, type ViewPair } from '../lib/spaces';
export type { Section } from '../lib/spaces';

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 600;
export const SIDEBAR_DEFAULT = 260;
const clampWidth = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));

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
  /** Solo confirmar: sin campo de texto (`label` es el mensaje). Resuelve 'ok' o null. */
  confirm?: boolean;
  danger?: boolean;
  resolve: (v: string | null) => void;
}

interface UIState {
  section: Section;
  multiview: boolean;
  viewPair: ViewPair;
  viewRatio: number;
  sidebars: Sidebars;
  initSpaces: () => void;
  showMultiview: () => void;
  focusSection: (s: Section) => void;
  revealSection: (s: Section) => void;
  setViewSide: (side: 0 | 1, s: Section) => void;
  setViewRatio: (ratio: number) => void;
  setSidebarOpen: (s: Section, open: boolean) => void;
  sidebarOpen: boolean;
  setSection: (s: Section) => void;
  toggleSidebar: () => void;
  sidebarWidth: number;
  setSidebarWidth: (w: number, persist?: boolean) => void;

  /** Vista Inicio a pantalla completa en el área central (el espacio de trabajo se conserva oculto). */
  homeView: boolean;
  libraryView: boolean;
  showLibrary: () => void;
  showHome: () => void;
  hideHome: () => void;

  settingsOpen: boolean;
  settingsOpened: boolean;
  settingsTab: 'general' | 'assistant';

  captureOpen: boolean;
  captureFiles: File[] | null;
  setCaptureOpen: (v: boolean) => void;
  quickOpen: boolean;
  quickOpenQuery: string;
  setQuickOpen: (v: boolean, q?: string) => void;

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
  resourcesWarnings: { path: string; message: string }[];
  refreshResources: () => Promise<void>;

  /** Se incrementa cada vez que se aplican ajustes nuevos (recargar búsquedas, listas…). */
  settingsVersion: number;
  bumpSettingsVersion: () => void;

  recents: RecentItem[];
  pushRecent: (root: Root, path: string) => void;
  /** Tras renombrar o mover: cambia las rutas de los recientes. */
  renameRecents: (root: Root, pairs: { from: string; to: string }[]) => void;
  dropRecent: (root: Root, path: string) => void;
}

const RECENTS_KEY = 'et:recents';
const SIDEBAR_KEY = 'et:sidebar';
const SIDEBAR_WIDTH_KEY = 'et:sidebar-width';
const HOME_KEY = 'et:home-view';
let toastSeq = 1;

const sidebarRaw = load<{ section: string; open: boolean }>(SIDEBAR_KEY, { section: 'memoria', open: true });
// Inicio y Buscar ya no son secciones del panel lateral.
const sidebarSaved: { section: Section; open: boolean } = {
  section: (['memoria', 'diagramas', 'notes', 'resources'].includes(sidebarRaw.section) ? sidebarRaw.section : 'memoria') as Section,
  open: sidebarRaw.open !== false,
};

export const useUI = create<UIState>((set, get) => ({
  section: sidebarSaved.section,
  multiview: false,
  viewPair: ['memoria', 'resources'],
  viewRatio: 50,
  sidebars: Object.fromEntries(SECTIONS.map(s => [s, { open: sidebarSaved.open, width: clampWidth(load<number>(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT)) }])) as Sidebars,
  initSpaces: () => {
    const raw = load<Partial<Pick<UIState, 'viewPair' | 'viewRatio' | 'sidebars' | 'multiview' | 'libraryView'>> | null>(spacesKey('current', getInstance()), {});
    const stored = raw && typeof raw === 'object' ? raw : {};
    const candidate = stored.viewPair;
    const pair: ViewPair = Array.isArray(candidate) && candidate.length === 2 && candidate.every(isSection) && candidate[0] !== candidate[1] ? candidate : ['memoria', 'resources'];
    const sidebars = { ...get().sidebars };
    for (const s of SECTIONS) {
      const entry = stored.sidebars?.[s];
      if (entry && typeof entry.open === 'boolean' && Number.isFinite(entry.width)) sidebars[s] = { open: entry.open, width: clampWidth(entry.width) };
    }
    const section = stored.multiview === true && !pair.includes(get().section) ? pair[0] : get().section;
    set({ section, sidebars, multiview: stored.multiview === true, viewPair: pair, libraryView: stored.libraryView !== false,
      viewRatio: clampRatio(stored.viewRatio ?? 50), sidebarOpen: sidebars[section].open, sidebarWidth: sidebars[section].width });
  },
  focusSection: s => {
    const pref = get().sidebars[s];
    set({ section: s, sidebarOpen: pref.open, sidebarWidth: pref.width });
  },
  setSection: s => {
    get().focusSection(s);
    set({ multiview: false, homeView: false, ...(s === 'resources' ? { libraryView: true } : {}) });
    save(SIDEBAR_KEY, { section: s, open: get().sidebars[s].open });
    save(HOME_KEY, false);
    persistSpaces();
  },
  revealSection: s => {
    if (get().multiview && !get().viewPair.includes(s)) {
      const pair: ViewPair = [...get().viewPair];
      pair[get().section === pair[1] ? 1 : 0] = s;
      set({ viewPair: pair });
    }
    get().focusSection(s);
    set({ homeView: false });
    save(SIDEBAR_KEY, { section: s, open: get().sidebars[s].open });
    save(HOME_KEY, false);
    persistSpaces();
  },
  showMultiview: () => {
    set({ multiview: true, homeView: false });
    get().focusSection(get().viewPair[0]);
    save(HOME_KEY, false);
    persistSpaces();
  },
  setViewSide: (side, s) => {
    const pair: ViewPair = [...get().viewPair];
    if (pair[1 - side] === s) pair[1 - side] = pair[side];
    pair[side] = s;
    set({ viewPair: pair });
    get().focusSection(s);
    persistSpaces();
  },
  setViewRatio: ratio => { set({ viewRatio: clampRatio(ratio) }); persistSpaces(); },
  sidebarOpen: sidebarSaved.open,
  sidebarWidth: clampWidth(load<number>(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT)),
  setSidebarWidth: (w, persist = true) => {
    const width = clampWidth(w);
    const section = get().section;
    set({ sidebarWidth: width, sidebars: { ...get().sidebars, [section]: { ...get().sidebars[section], width } } });
    if (persist) { save(SIDEBAR_WIDTH_KEY, width); persistSpaces(); }
  },
  setSidebarOpen: (s, open) => {
    set({ sidebars: { ...get().sidebars, [s]: { ...get().sidebars[s], open } }, ...(get().section === s ? { sidebarOpen: open } : {}) });
    persistSpaces();
  },
  toggleSidebar: () => {
    const s = get().section;
    get().setSidebarOpen(s, !get().sidebars[s].open);
  },

  homeView: load<boolean>(HOME_KEY, false),
  libraryView: true,
  showLibrary: () => { get().revealSection('resources'); set({ libraryView: true }); persistSpaces(); },
  showHome: () => { set({ homeView: true }); save(HOME_KEY, true); },
  hideHome: () => { set({ homeView: false }); save(HOME_KEY, false); },

  settingsOpen: false,
  settingsOpened: false,
  settingsTab: 'general',

  captureOpen: false,
  captureFiles: null,
  setCaptureOpen: (v) => set({ captureOpen: v }),
  quickOpen: false,
  quickOpenQuery: '',
  setQuickOpen: (v, q) => set({ quickOpen: v, quickOpenQuery: q ?? '' }),

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
  resourcesWarnings: [],
  refreshResources: async () => {
    try {
      const r = await api.resources();
      set({ resources: r.items, resourcesError: null, resourcesWarnings: r.warnings ?? [] });
    } catch (e) {
      set({ resourcesError: errorMessage(e) });
    }
  },

  settingsVersion: 0,
  bumpSettingsVersion: () => set({ settingsVersion: get().settingsVersion + 1 }),

  recents: load<RecentItem[]>(RECENTS_KEY, []),
  pushRecent: (root, path) => {
    const recents = [{ root, path, at: Date.now() }, ...get().recents.filter((r) => !(r.root === root && r.path === path))].slice(0, 30);
    set({ recents });
    save(RECENTS_KEY, recents);
  },
  renameRecents: (root, pairs) => {
    const map = (path: string) => {
      for (const p of pairs) {
        if (path === p.from) return p.to;
        if (path.startsWith(p.from + '/')) return p.to + path.slice(p.from.length);
      }
      return path;
    };
    const seen = new Set<string>();
    const recents = get()
      .recents.map((r) => (r.root === root ? { ...r, path: map(r.path) } : r))
      .filter((r) => !seen.has(`${r.root}:${r.path}`) && !!seen.add(`${r.root}:${r.path}`));
    set({ recents });
    save(RECENTS_KEY, recents);
  },
  dropRecent: (root, path) => {
    const recents = get().recents.filter((r) => !(r.root === root && r.path === path));
    set({ recents });
    save(RECENTS_KEY, recents);
  },
}));

export function persistSpaces() {
  const { viewPair, viewRatio, sidebars, multiview, libraryView } = useUI.getState();
  save(spacesKey('current', getInstance()), { viewPair, viewRatio, sidebars, multiview, libraryView });
}

export const toast = (t: Omit<Toast, 'id'>) => useUI.getState().toast(t);

/** Diálogo de confirmación (misma ventana que `ask`, sin campo de texto). */
export async function confirmDialog(p: { title: string; text: string; okLabel?: string; danger?: boolean }): Promise<boolean> {
  const r = await useUI.getState().ask({ title: p.title, label: p.text, okLabel: p.okLabel ?? 'Aceptar', confirm: true, danger: p.danger });
  return r != null;
}

/** Lista plana de archivos de un árbol. */
export function flattenTree(entries: Entry[] | undefined, out: string[] = []): string[] {
  if (!entries) return out;
  for (const e of entries) {
    if (e.type === 'file') out.push(e.path);
    else flattenTree(e.children, out);
  }
  return out;
}
