import { api, ApiError, errorMessage } from '../api';
import { load, save } from '../lib/storage';
import { toast, useUI } from './ui';
import { create } from 'zustand';

export interface CaptureInput {
  url?: string;
  title?: string;
  note?: string;
  tags?: string;
  file?: File | null;
}

interface QueuedCapture {
  id: string;
  createdAt: number;
  url?: string;
  title?: string;
  note?: string;
  tags?: string;
  file?: { name: string; type: string; dataUrl: string };
  lastError?: string;
}

const KEY = 'et:capture-queue';
/** Límite para guardar adjuntos sin conexión en localStorage (base64 ocupa ~1,33×). */
export const OFFLINE_FILE_LIMIT = 3 * 1024 * 1024;

export const useCaptureQueue = create<{ items: QueuedCapture[] }>(() => ({ items: load<QueuedCapture[]>(KEY, []) }));

function persist(items: QueuedCapture[]): boolean {
  useCaptureQueue.setState({ items });
  return save(KEY, items);
}

function buildForm(c: { url?: string; title?: string; note?: string; tags?: string }, file?: Blob, fileName?: string) {
  const fd = new FormData();
  if (c.url?.trim()) fd.set('url', c.url.trim());
  if (c.title?.trim()) fd.set('title', c.title.trim());
  if (c.note?.trim()) fd.set('note', c.note);
  if (c.tags?.trim()) fd.set('tags', c.tags.trim());
  if (file) fd.set('file', file, fileName);
  return fd;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Fallo "recuperable": red caída, servidor caído o error 5xx. */
function isRetryable(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500 || e.status === 408 || e.status === 429;
  return true;
}

export type CaptureOutcome =
  | { kind: 'ok'; path: string; title: string }
  | { kind: 'queued' }
  | { kind: 'error'; message: string };

export async function submitCapture(input: CaptureInput): Promise<CaptureOutcome> {
  try {
    const r = await api.capture(buildForm(input, input.file ?? undefined, input.file?.name));
    useUI.getState().refreshResources();
    return { kind: 'ok', path: r.path, title: r.title };
  } catch (e) {
    if (!isRetryable(e)) return { kind: 'error', message: errorMessage(e) };
    // Encolar para reintentar.
    const item: QueuedCapture = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      url: input.url, title: input.title, note: input.note, tags: input.tags,
      lastError: errorMessage(e),
    };
    if (input.file) {
      if (input.file.size > OFFLINE_FILE_LIMIT) {
        return { kind: 'error', message: `${errorMessage(e)}. El adjunto es demasiado grande para guardarlo sin conexión; vuelve a intentarlo cuando haya conexión.` };
      }
      try {
        item.file = { name: input.file.name, type: input.file.type, dataUrl: await readAsDataUrl(input.file) };
      } catch {
        return { kind: 'error', message: 'No se pudo leer el adjunto' };
      }
    }
    const ok = persist([...useCaptureQueue.getState().items, item]);
    if (!ok) return { kind: 'error', message: `${errorMessage(e)} y no hay espacio para guardarla localmente.` };
    scheduleRetry();
    return { kind: 'queued' };
  }
}

let flushing = false;
export async function flushCaptureQueue(): Promise<void> {
  if (flushing) return;
  const items = useCaptureQueue.getState().items;
  if (!items.length) return;
  flushing = true;
  let sent = 0;
  try {
    for (const item of items) {
      try {
        const blob = item.file ? await dataUrlToBlob(item.file.dataUrl) : undefined;
        const r = await api.capture(buildForm(item, blob, item.file?.name));
        persist(useCaptureQueue.getState().items.filter((x) => x.id !== item.id));
        sent++;
        toast({ kind: 'ok', text: `Captura pendiente guardada: ${r.path}` });
      } catch (e) {
        if (!isRetryable(e)) {
          // Error definitivo (400…): se descarta para no bloquear la cola, avisando.
          persist(useCaptureQueue.getState().items.filter((x) => x.id !== item.id));
          toast({ kind: 'error', text: `Captura pendiente rechazada (${errorMessage(e)}): ${item.url || item.title || item.note?.slice(0, 40) || 'sin título'}` });
          continue;
        }
        persist(useCaptureQueue.getState().items.map((x) => (x.id === item.id ? { ...x, lastError: errorMessage(e) } : x)));
        break; // seguimos sin conexión
      }
    }
  } finally {
    flushing = false;
  }
  if (sent) useUI.getState().refreshResources();
  if (useCaptureQueue.getState().items.length) scheduleRetry();
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushCaptureQueue();
  }, 60_000);
}

export function initCaptureQueue() {
  window.addEventListener('online', () => void flushCaptureQueue());
  void flushCaptureQueue();
}
