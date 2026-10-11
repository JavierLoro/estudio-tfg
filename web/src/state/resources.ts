import { create } from 'zustand';
import { api, ConflictError, errorMessage, type ResourceChanges } from '../api';
import { toast, useUI } from './ui';

export const STATUS_LABEL: Record<string, string> = {
  inbox: 'Bandeja', revisado: 'Revisado', descartado: 'Descartado',
};

type Changes = ResourceChanges;
interface PendingChange {
  path: string;
  changes: Changes;
  notesDir: string;
  libraryId?: string;
  content: string;
  rev: string;
  reviewed: boolean;
}
export const useResourceEdit = create<{ pending: PendingChange | null; busy: boolean; error: string | null }>(() => ({ pending: null, busy: false, error: null }));

export async function updateResource(path: string, changes: Changes, baseRev?: string, retry = false, destination?: string): Promise<boolean> {
  const state = useResourceEdit.getState();
  if (state.busy || (state.pending && !retry)) return false;
  const notesDir = useUI.getState().status?.notesDir ?? '';
  const libraryId = destination ?? useUI.getState().status?.libraryId;
  useResourceEdit.setState({ busy: true, error: null });
  try {
    const revision = baseRev ?? useUI.getState().resources?.find((r) => r.path === path)?.rev;
    if (!revision) throw new Error('Recarga el recurso antes de editarlo');
    if (destination && destination !== useUI.getState().status?.libraryId) throw new Error('La biblioteca cambió; vuelve al destino de esta edición');
    await api.patchResource({ path, ...changes, baseRev: revision, libraryId });
    useResourceEdit.setState({ pending: null });
    toast({ kind: 'ok', text: 'Recurso actualizado' });
    return true;
  } catch (e) {
    if (e instanceof ConflictError) {
      useResourceEdit.setState({ pending: { path, changes, notesDir, libraryId, content: e.content, rev: e.rev, reviewed: false } });
    } else {
      useResourceEdit.setState({ error: errorMessage(e) });
      toast({ kind: 'error', text: `No se pudo actualizar el recurso: ${errorMessage(e)}` });
    }
    return false;
  } finally {
    useResourceEdit.setState({ busy: false });
    void useUI.getState().refreshResources();
  }
}

export const setResourceStatus = (path: string, status: string, baseRev?: string) => updateResource(path, { status }, baseRev);
export const setResourceTags = (path: string, tags: string[], baseRev?: string) => updateResource(path, { tags }, baseRev);

export async function reloadResourceConflict() {
  const pending = useResourceEdit.getState().pending;
  if (!pending || useResourceEdit.getState().busy) return;
  useResourceEdit.setState({ busy: true, error: null });
  try {
    if (pending.notesDir !== useUI.getState().status?.notesDir) throw new Error('Vuelve al vault original para resolver este cambio');
    const current = await api.readFile('notes', pending.path);
    useResourceEdit.setState({ pending: { ...pending, content: current.content, rev: current.rev, reviewed: true } });
    await useUI.getState().refreshResources();
  } catch (e) {
    useResourceEdit.setState({ error: errorMessage(e) });
  } finally {
    useResourceEdit.setState({ busy: false });
  }
}

export async function reapplyResourceConflict() {
  const pending = useResourceEdit.getState().pending;
  if (!pending?.reviewed) return;
  if (pending.notesDir !== useUI.getState().status?.notesDir) {
    useResourceEdit.setState({ error: 'Vuelve al vault original para resolver este cambio' });
    return;
  }
  await updateResource(pending.path, pending.changes, pending.rev, true, pending.libraryId);
}
