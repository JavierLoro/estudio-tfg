import type { SerializedDockview } from 'dockview-react';

export const SECTIONS = ['memoria', 'notes', 'diagramas', 'resources'] as const;
export type Section = typeof SECTIONS[number];
export const SECTION_LABELS: Record<Section, string> = { memoria: 'Memoria', notes: 'Notas', diagramas: 'Diagramas', resources: 'Biblioteca' };
export type ViewPair = [Section, Section];
export interface SidebarPreference { open: boolean; width: number }
export type Sidebars = Record<Section, SidebarPreference>;
export interface ViewPreset {
  id: string;
  name: string;
  pair: ViewPair;
  ratio: number;
  sidebars: Sidebars;
  layouts: Partial<Record<Section, SerializedDockview>>;
  libraryView: boolean;
}
export const spacesKey = (name: string, instance: string | null) => `et:spaces:v1:${instance ?? 'legacy'}:${name}`;
export const isSection = (v: unknown): v is Section => SECTIONS.includes(v as Section);
export const clampRatio = (v: number) => Math.min(75, Math.max(25, Number.isFinite(v) ? v : 50));

export function panelSection(component: string, root?: string): Section {
  if (component === 'diagram') return 'diagramas';
  if (component === 'resource') return 'resources';
  if (component === 'note' || root === 'notes') return 'notes';
  return 'memoria';
}

/** Separa el layout antiguo conservando los grupos y su orden dentro de cada apartado. */
export function sectionLayout(layout: SerializedDockview, section: Section): SerializedDockview {
  const panels = Object.fromEntries(Object.entries(layout.panels).filter(([, panel]) => panelSection(panel.contentComponent ?? '', panel.params?.root) === section));
  const groups: string[] = [];
  type Node = SerializedDockview['grid']['root'];
  const filter = (node: Node): Node | null => {
    if (Array.isArray(node.data)) {
      const data = node.data.map(filter).filter((n): n is Node => n !== null);
      return data.length ? { ...node, data } : null;
    }
    const views = node.data.views.filter(id => Object.hasOwn(panels, id));
    if (views.length) groups.push(node.data.id);
    return views.length ? { ...node, data: { ...node.data, views, activeView: views.includes(node.data.activeView ?? '') ? node.data.activeView : views[0] } } : null;
  };
  const root = filter(layout.grid.root) ?? { type: 'branch', data: [] };
  return { grid: { ...layout.grid, root }, panels, activeGroup: groups.includes(layout.activeGroup ?? '') ? layout.activeGroup : groups[0] };
}

export function validPreset(value: unknown): value is ViewPreset {
  if (!value || typeof value !== 'object') return false;
  const p = value as ViewPreset;
  return typeof p.id === 'string' && typeof p.name === 'string' && !!p.name.trim()
    && Array.isArray(p.pair) && p.pair.length === 2 && p.pair.every(isSection) && p.pair[0] !== p.pair[1]
    && Number.isFinite(p.ratio) && p.ratio >= 25 && p.ratio <= 75 && typeof p.libraryView === 'boolean'
    && SECTIONS.every(s => p.sidebars?.[s] && typeof p.sidebars[s].open === 'boolean'
      && Number.isFinite(p.sidebars[s].width) && p.sidebars[s].width >= 180 && p.sidebars[s].width <= 600)
    && !!p.layouts && typeof p.layouts === 'object' && p.pair.every(s => validLayout(p.layouts[s])) && Object.entries(p.layouts).every(([s, layout]) =>
      isSection(s) && validLayout(layout));
}

export function validLayout(value: unknown): value is SerializedDockview {
  if (!value || typeof value !== 'object') return false;
  const layout = value as SerializedDockview;
  if (!layout.grid || !['HORIZONTAL', 'VERTICAL'].includes(layout.grid.orientation)
    || !Number.isFinite(layout.grid.width) || !Number.isFinite(layout.grid.height)
    || !layout.panels || typeof layout.panels !== 'object' || Array.isArray(layout.panels)) return false;
  const components = ['latex', 'note', 'diagram', 'pdf', 'resource', 'search', 'home', 'settings', 'datos', 'assistant'];
  if (!Object.entries(layout.panels).every(([id, panel]) => panel && panel.id === id && components.includes(panel.contentComponent ?? '')
    && (!['latex', 'note', 'diagram', 'resource'].includes(panel.contentComponent ?? '')
      || (['memoria', 'notes'].includes(panel.params?.root) && typeof panel.params?.path === 'string')))) return false;
  let nodes = 0;
  const seen = new Set<string>();
  const check = (node: SerializedDockview['grid']['root'], depth = 0): boolean => {
    if (!node || ++nodes > 1000 || depth > 32) return false;
    if (node.type === 'branch') return Array.isArray(node.data) && node.data.every(child => check(child, depth + 1));
    if (node.type !== 'leaf' || !node.data || Array.isArray(node.data) || typeof node.data.id !== 'string' || !Array.isArray(node.data.views)) return false;
    return node.data.views.every(id => {
      if (typeof id !== 'string' || !Object.hasOwn(layout.panels, id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  return check(layout.grid.root);
}
