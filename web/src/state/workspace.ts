import type { DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview-react';
import { create } from 'zustand';
import type { Root } from '../api';
import { basename, docKey, panelKindFor } from '../lib/paths';
import { layoutStorageKey } from '../lib/instance';
import { load, remove, save } from '../lib/storage';
import { flushDrafts, releaseDoc, requestReveal } from './docs';
import { persistSpaces, useUI } from './ui';
import { api as http } from '../api';
import { SECTIONS, panelSection, sectionLayout, validLayout, type Section, type ViewPreset } from '../lib/spaces';
import { addAssistantContext, useAssistant, type AssistantContext } from './assistant';

// Tipos de panel y sus parámetros.
export type PanelComponent = 'latex' | 'note' | 'diagram' | 'pdf' | 'resource' | 'search' | 'home' | 'settings' | 'datos' | 'assistant';

export interface FileParams {
  root: Root;
  path: string;
}
export interface SearchParams {
  q?: string;
  scope?: Root | 'all';
}

export interface OpenOptions {
  /** Abrir dividiendo a la derecha (Alt-clic / Ctrl-Mayús-clic / clic central / «Abrir al lado»). */
  side?: boolean;
  line?: number;
  /** No robar el foco. */
  inactive?: boolean;
  /** Abrir una nota en modo edición (notas recién creadas). */
  mode?: 'edit';
}

// Un área de pestañas por apartado; los documentos siguen en el store compartido.
const layoutKey = (section: Section) => section === 'memoria' ? layoutStorageKey() : `${layoutStorageKey()}:${section}`;
const docks = new Map<Section, DockviewApi>();
const pending = new Map<Section, (() => void)[]>();
let restoring = false;
export const getDock = (section: Section = useUI.getState().section) => docks.get(section) ?? null;

export function setDock(section: Section, api: DockviewApi | null) {
  if (api) docks.set(section, api); else docks.delete(section);
  useActivePanel.setState({ ready: docks.size > 0 });
}

export function flushDockOpens(section: Section) {
  const jobs = pending.get(section) ?? [];
  pending.delete(section);
  for (const job of jobs) job();
}

export function setActivePanel(section: Section, id: string | null) {
  useActivePanel.setState(s => ({ ids: { ...s.ids, [section]: id }, ...(useUI.getState().section === section ? { id } : {}) }));
}

export function panelIdFor(component: PanelComponent, path?: string) {
  return path ? `${component}:${path}` : component;
}

function position(dock: DockviewApi, opts: OpenOptions) {
  if (!dock) return undefined;
  const group = dock.activeGroup?.api.isVisible ? dock.activeGroup : dock.groups.find(g => g.api.isVisible);
  if (opts.side && group) return { referenceGroup: group, direction: 'right' as const };
  if (group) return { referenceGroup: group };
  // El PDF fijo puede ser el único grupo restante y estar oculto.
  if (dock.groups.length) return { referenceGroup: dock.groups[0], direction: 'left' as const };
  return undefined;
}

function addOrFocus(
  id: string,
  component: PanelComponent,
  title: string,
  params: object,
  opts: OpenOptions = {},
  extra: { renderer?: 'always' | 'onlyWhenVisible' } = {},
  queued = false,
): IDockviewPanel | null {
  const section = panelSection(component, (params as Partial<FileParams>).root);
  if (!opts.inactive && !queued) useUI.getState().revealSection(section);
  if (component === 'resource' && !opts.inactive) { useUI.setState({ libraryView: false }); persistSpaces(); }
  const dock = getDock(section);
  if (!dock) {
    pending.set(section, [...(pending.get(section) ?? []), () => addOrFocus(id, component, title, params, opts, extra, true)]);
    return null;
  }
  const existing = dock.getPanel(id);
  if (existing) {
    // Nunca dos editores para el mismo documento: se enfoca el existente.
    if (!opts.inactive) existing.api.setActive();
    return existing;
  }
  const pos = position(dock, opts);
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
  const title=useUI.getState().resources?.find(r=>r.path===path)?.title??basename(path).replace(/\.md$/i,'');
  addOrFocus(panelIdFor('resource', path), 'resource', title, { root: 'notes', path }, opts);
}

export function openPdf(opts: OpenOptions = {}) {
  if (!useUI.getState().multiview) {
    if (!opts.inactive) {
      useUI.getState().revealSection('memoria');
      requestAnimationFrame(() => document.getElementById('memoria-pdf')?.focus());
    }
    return;
  }
  addOrFocus('pdf', 'pdf', 'PDF', {}, opts, { renderer: 'always' });
}

/** Inicio es una vista propia (no una pestaña): ocupa el área central hasta abrir algo. */
export function openHome() {
  useUI.getState().showHome();
}

export function openSettings(tab: 'general' | 'assistant' = 'general') {
  useUI.setState({ settingsOpened: true, settingsOpen: true, settingsTab: tab });
}

export function openAssistant(context?: AssistantContext) {
  if (context) addAssistantContext(context);
  useAssistant.setState(s => ({ opened: true, visible: true, minimized: false, focusRequest: s.focusRequest + 1 }));
}

export function openDatos(opts: OpenOptions = {}) {
  addOrFocus('datos', 'datos', 'Datos del trabajo', {}, opts);
}

const isFilePanel = (c: string) => c === 'latex' || c === 'note' || c === 'diagram' || c === 'resource';

/** Cierra las pestañas de archivos de las raíces indicadas (los borradores se conservan). */
export function closeFilePanels(roots: Root[]) {
  if (!roots.length) return;
  for (const dock of docks.values()) for (const p of [...dock.panels]) {
    const params = p.params as Partial<FileParams> | undefined;
    const c = p.api.component;
    if (isFilePanel(c) && params?.root && roots.includes(params.root)) p.api.close();
  }
}

const under = (path: string, base: string) => path === base || path.startsWith(base + '/');

/** Cierra las pestañas de los archivos de `root` bajo `base` (archivo o carpeta eliminados). */
export function closePanelsUnder(root: Root, base: string) {
  for (const dock of docks.values()) for (const p of [...dock.panels]) {
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
  for (const dock of docks.values()) rekeyDockPanels(dock, root, pairs);
}

function rekeyDockPanels(dock: DockviewApi, root: Root, pairs: { from: string; to: string }[]) {
  if (!pairs.length) return;
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
  const ui = useUI.getState();
  if (ui.homeView || (ui.section === 'resources' && ui.libraryView)) return null;
  const p = getDock()?.activePanel;
  if (!p) return null;
  const params = p.params as Partial<FileParams> | undefined;
  if ((p.api.component === 'latex' || p.api.component === 'note' || p.api.component === 'diagram') && params?.root && params.path) {
    return { root: params.root, path: params.path };
  }
  return null;
}

// ---- Persistencia del layout ----

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleLayoutSave() {
  if (restoring) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    for (const [section, dock] of docks) save(layoutKey(section), dock.toJSON());
  }, 300);
}

export function restoreLayout(api: DockviewApi, section: Section): boolean {
  const data = load<SerializedDockview | null>(layoutKey(section), null);
  if (!data) return false;
  try {
    if (!validLayout(data)) throw new Error('Distribución no válida');
    if (section === 'memoria') {
      // Distribuir los documentos del antiguo espacio único sin perder sus grupos.
      for (const target of SECTIONS.filter(s => s !== 'memoria')) {
        if (load(layoutKey(target), null) == null) save(layoutKey(target), sectionLayout(data, target));
      }
    }
    api.fromJSON(sectionLayout(data, section));
    api.getPanel('home')?.api.close();
    const assistant = api.getPanel('assistant');
    if (assistant) { assistant.api.close(); openAssistant(); }
    const settings = api.getPanel('settings');
    if (settings) { settings.api.close(); openSettings(); }
    save(layoutKey(section), api.toJSON());
    return true;
  } catch (e) {
    console.warn('Layout guardado no válido, se descarta', e);
    remove(layoutKey(section));
    try { api.clear(); } catch { /* El layout no llegó a crearse. */ }
    return false;
  }
}

export function snapshotLayouts(): ViewPreset['layouts'] {
  return Object.fromEntries(SECTIONS.map(section => [section, getDock(section)?.toJSON() ?? load<SerializedDockview | undefined>(layoutKey(section), undefined)]).filter(([, layout]) => layout !== undefined));
}

export function applyPreset(preset: ViewPreset): boolean {
  (document.activeElement as HTMLElement | null)?.blur?.();
  flushDrafts();
  const previous = snapshotLayouts();
  restoring = true;
  try {
    for (const section of preset.pair) {
      const dock = getDock(section);
      if (!dock) continue;
      const layout = preset.layouts[section];
      if (layout) dock.fromJSON(sectionLayout(layout, section)); else dock.clear();
      setActivePanel(section, dock.activePanel?.id ?? null);
    }
    for (const section of preset.pair) {
      const layout = preset.layouts[section];
      if (layout) save(layoutKey(section), sectionLayout(layout, section)); else remove(layoutKey(section));
    }
    const ui = useUI.getState();
    const sidebars = { ...ui.sidebars };
    for (const section of preset.pair) sidebars[section] = { ...preset.sidebars[section] };
    useUI.setState({ viewPair: [...preset.pair], viewRatio: preset.ratio, sidebars, libraryView: preset.pair.includes('resources') ? preset.libraryView : ui.libraryView });
    useUI.getState().showMultiview();
    return true;
  } catch {
    for (const section of preset.pair) {
      const dock = getDock(section);
      if (!dock) continue;
      const layout = previous[section];
      if (layout) dock.fromJSON(layout); else dock.clear();
      setActivePanel(section, dock.activePanel?.id ?? null);
    }
    useUI.getState().toast({ kind: 'error', text: 'No se pudo abrir esta vista guardada. Se conserva la distribución anterior.' });
    return false;
  } finally { restoring = false; }
}

export function defaultLayout(memoriaMain: string, section: Section = 'memoria') {
  const dock = getDock(section);
  if (!dock) return;
  dock.clear();
  if (section !== 'memoria') return;
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
  remove(layoutKey('memoria'));
  useUI.getState().setSection('memoria');
  defaultLayout(useUI.getState().status?.memoriaMain ?? 'tfg.tex');
}

/** Al cerrar una pestaña de archivo se libera su documento. */
export function onPanelRemoved(panel: IDockviewPanel) {
  if (restoring) return;
  const params = panel.params as Partial<FileParams> | undefined;
  const c = panel.api.component;
  if ((c === 'latex' || c === 'note' || c === 'diagram') && params?.root && params.path) {
    releaseDoc(docKey(params.root, params.path));
  }
}

// ---- Panel activo (para resaltar en el árbol) ----
export const useActivePanel = create<{ id: string | null; ready: boolean; ids: Partial<Record<Section, string | null>> }>(() => ({ id: null, ready: false, ids: {} }));
useUI.subscribe((state, prev) => {
  if (state.section !== prev.section) useActivePanel.setState({ id: getDock()?.activePanel?.id ?? null });
});
