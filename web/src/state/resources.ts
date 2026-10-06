import { api, errorMessage, type Resource } from '../api';
import { toast, useUI } from './ui';

export const STATUS_LABEL: Record<string, string> = {
  inbox: 'Bandeja',
  revisado: 'Revisado',
  descartado: 'Descartado',
};

export async function setResourceStatus(path: string, status: string) {
  // Actualización optimista de la lista.
  const prev = useUI.getState().resources;
  if (prev) useUI.setState({ resources: prev.map((r) => (r.path === path ? { ...r, status } : r)) });
  try {
    const baseRev = prev?.find((r) => r.path === path)?.rev;
    await api.patchResource({ path, status, baseRev });
    toast({ kind: 'ok', text: `Marcado como ${STATUS_LABEL[status]?.toLowerCase() ?? status}` });
  } catch (e) {
    if (prev) useUI.setState({ resources: prev });
    toast({ kind: 'error', text: `No se pudo cambiar el estado: ${errorMessage(e)}` });
  } finally {
    void useUI.getState().refreshResources();
  }
}

export async function setResourceTags(path: string, tags: string[]) {
  try {
    const baseRev = useUI.getState().resources?.find((r) => r.path === path)?.rev;
    await api.patchResource({ path, tags, baseRev });
  } catch (e) {
    toast({ kind: 'error', text: `No se pudieron guardar las etiquetas: ${errorMessage(e)}` });
  } finally {
    void useUI.getState().refreshResources();
  }
}

/** Ruta del adjunto relativa a la raíz `notes`. */
export function attachmentPath(r: Pick<Resource, 'attachment'>, resourcesSubdir: string): string | null {
  if (!r.attachment) return null;
  const a = r.attachment.replace(/^\.?\//, '');
  return a.startsWith(resourcesSubdir + '/') ? a : `${resourcesSubdir}/${a}`;
}
