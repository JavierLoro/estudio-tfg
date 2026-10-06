// Ajustes (v0.2): datos de /api/settings, instancia actual y aplicación en caliente
// de un cambio de configuración (respuesta de PUT, SSE `settings` o estado nuevo).

import { create } from 'zustand';
import { api, errorMessage, type Root, type SettingsResponse, type Status } from '../api';
import { getInstance, migrateLegacyKeys, moveDraft, setInstance } from '../lib/instance';
import { useCompile } from './compile';
import { useOutline } from './outline';
import { flushDrafts, useDocs } from './docs';
import { toast, useUI } from './ui';
import { closeFilePanels, scheduleLayoutSave } from './workspace';

interface SettingsState {
  data: SettingsResponse | null;
  error: string | null;
  loading: boolean;
  /** La instancia está fijada: ya se pueden leer borradores y layout. */
  ready: boolean;
  load: () => Promise<void>;
  setData: (d: SettingsResponse) => void;
}

export const useSettings = create<SettingsState>((set) => ({
  data: null,
  error: null,
  loading: false,
  ready: false,
  load: async () => {
    set({ loading: true });
    try {
      const data = await api.settings();
      set({ data, error: null });
    } catch (e) {
      set({ error: errorMessage(e) });
    } finally {
      set({ loading: false });
    }
  },
  setData: (data) => set({ data, error: null }),
}));

/** Fija la instancia inicial (con migración única de claves antiguas). */
export function initInstance(status: Status) {
  const id = status.instanceId ?? null;
  if (id) migrateLegacyKeys(id);
  setInstance(id);
  useSettings.setState({ ready: true });
}

const sameDirs = (a: Status, b: Status) =>
  a.notesDir === b.notesDir &&
  a.memoriaDir === b.memoriaDir &&
  a.resourcesSubdir === b.resourcesSubdir &&
  a.memoriaMain === b.memoriaMain &&
  (a.instanceId ?? null) === (b.instanceId ?? null);

/** Aplica en la interfaz la transición de configuración `prev` → `next`. */
function applyTransition(prev: Status, next: Status) {
  const changed: Root[] = [];
  if (prev.notesDir !== next.notesDir) changed.push('notes');
  if (prev.memoriaDir !== next.memoriaDir) changed.push('memoria');

  // 1) Borradores pendientes y pestañas de raíces cambiadas, aún con la instancia anterior.
  flushDrafts();
  closeFilePanels(changed);

  // 2) Cambio de instancia: los borradores de los documentos que siguen abiertos se mueven.
  const oldId = getInstance();
  const newId = next.instanceId ?? null;
  if (oldId !== newId) {
    for (const key of Object.keys(useDocs.getState().docs)) moveDraft(key, oldId, newId);
    setInstance(newId);
    scheduleLayoutSave();
  }

  // 3) Recargar todo lo que depende de las carpetas.
  const ui = useUI.getState();
  void ui.refreshTree('notes');
  void ui.refreshTree('memoria');
  void ui.refreshResources();
  if (changed.includes('memoria') || prev.memoriaMain !== next.memoriaMain) useCompile.setState({ last: null });
  void useCompile.getState().fetchLast();
  void useOutline.getState().refresh();
  ui.bumpSettingsVersion();
  void useSettings.getState().load();
  toast({ kind: 'ok', text: 'Configuración aplicada' });
}

let started = false;
/** Observa el estado: cualquier cambio de carpetas (venga de donde venga) se aplica una vez. */
export function watchSettingsTransitions() {
  if (started) return;
  started = true;
  useUI.subscribe((s, p) => {
    if (!useSettings.getState().ready || !s.status || !p.status || s.status === p.status) return;
    if (!sameDirs(p.status, s.status)) applyTransition(p.status, s.status);
  });
}

/**
 * Hubo un cambio de ajustes (respuesta de PUT/reset/init-memoria o SSE `settings`):
 * se relee el estado y, si cambió algo, el observador lo aplica.
 */
export function notifySettingsChanged(data?: SettingsResponse) {
  if (data?.values && data.sources) useSettings.getState().setData(data);
  return useUI.getState().refreshStatus();
}
