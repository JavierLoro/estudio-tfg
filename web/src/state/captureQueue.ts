import { create } from 'zustand';
import { api, ApiError, errorMessage } from '../api';
import { captureStorage, type QueuedCapture } from '../lib/captureStorage';
import { toast, useUI } from './ui';

export type { QueuedCapture } from '../lib/captureStorage';
export interface CaptureInput {
  url?: string;
  title?: string;
  note?: string;
  tags?: string;
  file?: File | null;
}
export const OFFLINE_FILE_LIMIT = 50 * 1024 * 1024;
export const useCaptureQueue = create<{ items: QueuedCapture[]; open: boolean; busy: boolean; error: string | null }>(() => ({ items: [], open: false, busy: false, error: null }));
let initialized = false;
let serial: Promise<unknown> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Serializar también entre pestañas; cada acción vuelve a leer el estado durable. */
function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const work = async () => {
    const execute = async () => {
      useCaptureQueue.setState({ busy: true, error: null });
      try { return await run(); }
      finally { useCaptureQueue.setState({ busy: false }); }
    };
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('et:captures', execute);
    return execute();
  };
  const result = serial.then(work, work);
  serial = result.catch(() => undefined);
  return result;
}

async function refresh() {
  const items = await captureStorage.read();
  useCaptureQueue.setState({ items });
  return items;
}
async function initialize() {
  if (!initialized) {
    await captureStorage.migrate();
    initialized = true;
  }
  return refresh();
}
async function put(item: QueuedCapture) {
  await captureStorage.put(item);
  await refresh();
}

const retryable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 408 || e.status === 429;
const storageError = (e: unknown) => `No se pudo actualizar la cola local: ${errorMessage(e)}. El contenido pendiente se conserva; revisa el espacio del navegador.`;

function form(item: QueuedCapture) {
  const fd = new FormData();
  fd.set('operationId', item.id);
  fd.set('libraryId', item.libraryId!);
  for (const key of ['url', 'title', 'note', 'tags'] as const) if (item[key] !== undefined) fd.set(key, item[key]!);
  if (item.file) fd.set('file', item.file.blob, item.file.name);
  return fd;
}

async function send(item: QueuedCapture): Promise<{ path: string; title: string } | null> {
  let confirmed = false;
  try {
    const status = await api.status();
    if (!item.libraryId || status.libraryId !== item.libraryId) {
      await put({ ...item, blocked: true, lastError: item.libraryId ? 'Vuelve a la biblioteca original para enviarla' : 'Asigna el destino antes de enviar' });
      return null;
    }
    const result = await api.capture(form(item));
    confirmed = true;
    await captureStorage.delete(item.id);
    await refresh();
    void useUI.getState().refreshResources();
    return result;
  } catch (e) {
    const message = confirmed ? 'El servidor confirmó el recurso, pero no se pudo retirar el pendiente local. Reintenta para recuperar el mismo recibo.'
      : e instanceof ApiError && e.status === 401 ? 'Autentícate y vuelve a reintentar; la captura sigue guardada' : errorMessage(e);
    try { await put({ ...item, blocked: !retryable(e), lastError: message }); }
    catch (storageFailure) { useCaptureQueue.setState({ error: storageError(storageFailure) }); }
    return null;
  }
}

export type CaptureOutcome =
  | { kind: 'ok'; path: string; title: string }
  | { kind: 'queued' }
  | { kind: 'error'; message: string };

export async function submitCapture(input: CaptureInput): Promise<CaptureOutcome> {
  return exclusive(async () => {
    try {
      await initialize();
      const status = useUI.getState().status;
      if (!status?.libraryId) return { kind: 'error', message: 'Conecta con el servidor y confirma la biblioteca de destino antes de añadir recursos' };
      if (input.file && input.file.size > OFFLINE_FILE_LIMIT) return { kind: 'error', message: 'El adjunto supera el máximo de 50 MB' };
      const item: QueuedCapture = {
        id: crypto.randomUUID(), createdAt: Date.now(), libraryId: status.libraryId,
        destination: `${status.notesDir}/${status.resourcesSubdir}`, url: input.url, title: input.title, note: input.note, tags: input.tags,
        file: input.file ? { name: input.file.name, type: input.file.type, blob: input.file } : undefined,
      };
      // Si falla el commit, no se envía ni se publica nada en el estado de la cola.
      await put(item);
      const result = await send(item);
      scheduleRetry();
      return result ? { kind: 'ok', ...result } : { kind: 'queued' };
    } catch (e) {
      const message = storageError(e);
      useCaptureQueue.setState({ error: message });
      return { kind: 'error', message };
    }
  });
}

export async function flushCaptureQueue(id?: string): Promise<void> {
  await exclusive(async () => {
    try {
      const items = await initialize();
      for (const item of items) {
        if ((id && item.id !== id) || (!id && item.blocked)) continue;
        const result = await send(item);
        if (result) toast({ kind: 'ok', text: `Captura pendiente guardada: ${result.path}` });
      }
    } catch (e) { useCaptureQueue.setState({ error: storageError(e) }); }
    scheduleRetry();
  });
}

export async function discardCapture(id: string): Promise<void> {
  await exclusive(async () => {
    try { await captureStorage.delete(id); await refresh(); }
    catch (e) { useCaptureQueue.setState({ error: storageError(e) }); }
  });
}

export async function assignCaptureDestination(id: string): Promise<void> {
  await exclusive(async () => {
    try {
      const item = (await initialize()).find((x) => x.id === id);
      if (!item || item.libraryId) return;
      const status = await api.status();
      if (!status.libraryId) throw new Error('El servidor no identifica la biblioteca');
      await put({ ...item, libraryId: status.libraryId, destination: `${status.notesDir}/${status.resourcesSubdir}`, blocked: true,
        lastError: 'Destino asignado. Pulsa Reintentar para enviarla.' });
    } catch (e) { useCaptureQueue.setState({ error: errorMessage(e) }); }
  });
}

export async function editCapture(id: string, changes: Pick<QueuedCapture, 'url' | 'title' | 'note' | 'tags'>): Promise<boolean> {
  return exclusive(async () => {
    try {
      const item = (await initialize()).find((x) => x.id === id);
      if (!item) return false;
      if (item.libraryId) {
        const state = await api.captureOperation(item.id, item.libraryId);
        // No alterar una operación posiblemente publicada: primero recuperar su recibo.
        if (state.state !== 'unknown') throw new Error('El servidor ya recibió esta operación. Reintenta para recuperar su resultado antes de editar el recurso.');
      }
      await put({ ...item, ...changes, blocked: true, lastError: 'Edición guardada. Pulsa Reintentar para enviarla.' });
      return true;
    } catch (e) {
      useCaptureQueue.setState({ error: errorMessage(e) });
      return false;
    }
  });
}

function scheduleRetry() {
  if (retryTimer || !useCaptureQueue.getState().items.some((item) => !item.blocked)) return;
  retryTimer = setTimeout(() => { retryTimer = null; void flushCaptureQueue(); }, 60_000);
}

export function initCaptureQueue() {
  const online = () => void flushCaptureQueue();
  window.addEventListener('online', online);
  void flushCaptureQueue();
  return () => {
    window.removeEventListener('online', online);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}
