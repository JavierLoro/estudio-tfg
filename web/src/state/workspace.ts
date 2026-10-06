import type { DockviewApi, IDockviewPanel } from 'dockview-react';
import { create } from 'zustand';
import type { Root } from '../api';
import { basename, docKey, panelKindFor } from '../lib/paths';
import { layoutStorageKey } from '../lib/instance';
import { load, remove, save } from '../lib/storage';
import { releaseDoc, requestReveal } from './docs';
import { useUI } from './ui';
import { api as http } from '../api';

// Tipos de panel y sus parámetros.
export type PanelComponent = 'latex' | 'note' | 'pdf' | 'resource' | 'search' | 'home' | 'settings' | 'datos';

export interface FileParams {
  root: Root;
  path: string;
}
export interface SearchParams {
  q?: string;
  scope?: Root | 'all';
}

export interface OpenOptions {
  /** Abrir dividiendo a la derecha (⌥clic / «Abrir al lado»). */
  side?: boolean;
  line?: number;
  /** No robar el foco. */
  inactive?: boolean;
  /** Abrir una nota en modo edición (notas recién creadas). */
  mode?: 'edit';
}

// Layout por instancia (ver lib/instance.ts).
const layoutKey = () => layoutStorageKey();

let dock: DockviewApi | null = null;
export const getDock = () => dock;

export function setDock(api: DockviewApi | null) {
  dock = api;
}

export function panelIdFor(component: PanelComponent, path?: string) {
  return path ? `${component}:${path}` : component;
}

function position(opts: OpenOptions) {
  if (!dock) return undefined;
  const group = dock.activeGroup;
  if (opts.side && group) return { referenceGroup: group, direction: 'right' as const };
  if (group) return { referenceGroup: group };
  return undefined;
}

function addOrFocus(
  id: string,
  component: PanelComponent,
  title: string,
  params: object,
  opts: OpenOptions = {},
  extra: { renderer?: 'always' | 'onlyWhenVisible' } = {},
): IDockviewPanel | null {
  if (!dock) return null;
  // Abrir o enfocar cualquier panel devuelve al espacio de trabajo.
  if (!opts.inactive) useUI.getState().hideHome();
  const existing = dock.getPanel(id);
  if (existing) {
    // Nunca dos editores para el mismo documento: se enfoca el existente.
    if (!opts.inactive) existing.api.setActive();
    return existing;
  }
  const pos = position(opts);
  return dock.addPanel({
    id,
    component,
    title,
    params,
    inactive: opts.inactive,
    renderer: extra.renderer,
    ...(pos ? { position: pos } : {}),
  });
}

export function openFile(root: Root, path: string, opts: OpenOptions = {}) {
  const kind = panelKindFor(root, path);
  if (kind === 'external') {
    window.open(http.rawUrl(root, path), '_blank', 'noopener');
    return;
  }
  const component: PanelComponent = kind;
  const params: FileParams & { mode?: 'edit' } = { root, path };
  if (opts.mode) params.mode = opts.mode;
  addOrFocus(panelIdFor(component, path), component, basename(path), params, opts);
  useUI.getState().pushRecent(root, path);
  if (opts.line != null) requestReveal(docKey(root, path), opts.line);
}

export function openResource(path: string, opts: OpenOptions = {}) {
  addOrFocus(panelIdFor('resource', path), 'resource', basename(path).replace(/\.md$/i, ''), { root: 'notes', path }, opts);
}

export function openPdf(opts: OpenOptions = {}) {
  addOrFocus('pdf', 'pdf', 'PDF', {}, opts, { renderer: 'always' });
}

/** Inicio es una vista propia (no una pestaña): ocupa el área central hasta abrir algo. */
export function openHome() {
  useUI.getState().showHome();
}

export function openSettings(opts: OpenOptions = {}) {
  addOrFocus('settings', 'settings', 'Ajustes', {}, opts);
}

export function openDatos(opts: OpenOptions = {}) {
  addOrFocus('datos', 'datos', 'Datos del trabajo', {}, opts);
}

/** Cierra las pestañas de archivos de las raíces indicadas (los borradores se conservan). */
export function closeFilePanels(roots: Root[]) {
  if (!dock || !roots.length) return;
  for (const p of [...dock.panels]) {
    const params = p.params as Partial<FileParams> | undefined;
    const c = p.api.component;
    if ((c === 'latex' || c === 'note' || c === 'resource') && params?.root && roots.includes(params.root)) p.api.close();
  }
}

const isFilePanel = (c: string) => c === 'latex' || c === 'note' || c === 'resource';
const under = (path: string, base: string) => path === base || path.startsWith(base + '/');

/** Cierra las pestañas de los archivos de `root` bajo `base` (archivo o carpeta eliminados). */
export function closePanelsUnder(root: Root, base: string) {
  if (!dock) return;
  for (const p of [...dock.panels]) {
    const params = p.params as Partial<FileParams> | undefined;
    if (isFilePanel(p.api.component) && params?.root === root && params.path && under(params.path, base)) p.api.close();
  }
}

/**
 * Tras renombrar o mover: cada pestaña del archivo pasa a la ruta nueva.
 * El id de un panel (`<componente>:<ruta>`) no se puede cambiar, así que se crea el panel
 * con el id nuevo en la misma posición del mismo grupo y se cierra el viejo. El documento
 * ya está re-clasificado en el store (el editor se vuelve a montar con el mismo contenido, y
 * el cursor y el desplazamiento se restauran desde state/cursor.ts); el panel mantiene sus parámetros (modo).
 */
export function rekeyPanels(root: Root, pairs: { from: string; to: string }[]) {
  if (!dock || !pairs.length) return;
  const active = dock.activePanel;
  let newActive: string | null = null;
  for (const panel of [...dock.panels]) {
    const params = panel.params as (Partial<FileParams> & Record<string, unknown>) | undefined;
    const component = panel.api.component as PanelComponent;
    if (!isFilePanel(component) || params?.root !== root || !params.path) continue;
    const pair = pairs.find((p) => under(params.path!, p.from));
    if (!pair) continue;
    const newPath = pair.to + params.path.slice(pair.from.length);
    const newId = panelIdFor(component, newPath);
    const wasActive = active?.id === panel.id;
    if (dock.getPanel(newId)) {
      panel.api.close();
      continue;
    }
    const group = panel.group;
    const index = group.panels.indexOf(panel);
    const groupActive = group.activePanel?.id === panel.id;
    dock.addPanel({
      id: newId,
      component,
      title: basename(newPath),
      params: { ...params, root, path: newPath },
      inactive: !groupActive,
      position: { referenceGroup: group, index },
    });
    panel.api.close();
    if (wasActive) newActive = newId;
  }
  // addPanel activa el grupo: devolver el foco al panel que lo tenía.
  if (newActive) dock.getPanel(newActive)?.api.setActive();
  else if (active && dock.getPanel(active.id)) active.api.setActive();
}

export function openSearch(q: string, scope: Root | 'all' = 'all', opts: OpenOptions = {}) {
  const p = addOrFocus('search', 'search', 'Búsqueda', { q, scope } satisfies SearchParams, opts);
  p?.api.updateParameters({ q, scope });
}

export function activeFile(): FileParams | null {
  const p = dock?.activePanel;
  if (!p) return null;
  const params = p.params as Partial<FileParams> | undefined;
  if ((p.api.component === 'latex' || p.api.component === 'note') && params?.root && params.path) {
    return { root: params.root, path: params.path };
  }
  return null;
}

// ---- Persistencia del layout ----

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleLayoutSave() {
  if (!dock) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (dock) save(layoutKey(), dock.toJSON());
  }, 300);
}

export function restoreLayout(api: DockviewApi): boolean {
  const data = load<unknown>(layoutKey(), null);
  if (!data) return false;
  try {
    api.fromJSON(data as Parameters<DockviewApi['fromJSON']>[0]);
    // Inicio ya no es una pestaña: se descarta si venía de un layout antiguo.
    api.getPanel('home')?.api.close();
    return api.panels.length > 0;
  } catch (e) {
    console.warn('Layout guardado no válido, se descarta', e);
    remove(layoutKey());
    try {
      api.clear();
    } catch {
      /* ignore */
    }
    return false;
  }
}

export function defaultLayout(memoriaMain: string) {
  if (!dock) return;
  dock.clear();
  const main = memoriaMain || 'tfg.tex';
  dock.addPanel({ id: panelIdFor('latex', main), component: 'latex', title: basename(main), params: { root: 'memoria', path: main } });
  dock.addPanel({
    id: 'pdf',
    component: 'pdf',
    title: 'PDF',
    params: {},
    renderer: 'always',
    position: { referencePanel: panelIdFor('latex', main), direction: 'right' },
  });
  dock.getPanel(panelIdFor('latex', main))?.api.setActive();
}

export function resetLayout() {
  remove(layoutKey());
  useUI.getState().hideHome();
  defaultLayout(useUI.getState().status?.memoriaMain ?? 'tfg.tex');
}

/** Al cerrar una pestaña de archivo se libera su documento. */
export function onPanelRemoved(panel: IDockviewPanel) {
  const params = panel.params as Partial<FileParams> | undefined;
  const c = panel.api.component;
  if ((c === 'latex' || c === 'note') && params?.root && params.path) {
    releaseDoc(docKey(params.root, params.path));
  }
}

// ---- Panel activo (para resaltar en el árbol) ----
export const useActivePanel = create<{ id: string | null }>(() => ({ id: null }));
