import { create } from 'zustand';
import { api, ApiError, ConflictError, errorMessage, type ChangeEvent, type Root } from '../api';
import { docKey } from '../lib/paths';
import { draftStorageKey, renameDraft } from '../lib/instance';
import { load, remove, save } from '../lib/storage';
import { toast } from './ui';
import { useCompile } from './compile';
import { refreshOutlineSoon } from './outline';
import { useCursor } from './cursor';

export interface Conflict {
  content: string;
  rev: string;
  /** 'save' = 409 al guardar; 'external' = cambió en disco mientras había cambios locales. */
  source: 'save' | 'external';
}

export interface Draft {
  content: string;
  baseRev: string;
  savedAt: number;
}

export interface Doc {
  key: string;
  root: Root;
  path: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  /** Contenido actual del editor. */
  content: string;
  /** Contenido correspondiente a `rev` (último guardado/cargado). */
  savedContent: string;
  rev: string;
  mtime?: number;
  saving: boolean;
  conflict: Conflict | null;
  deleted: boolean;
  /** Borrador local distinto del disco, ofrecido al abrir. */
  draftOffer: Draft | null;
  /** Se incrementa cuando el contenido se reemplaza desde fuera del editor. */
  extVersion: number;
  lastSavedAt?: number;
}

export type DocIndicator = 'guardado' | 'sin guardar' | 'conflicto' | 'guardando' | 'cargando' | 'error';

export function isDirty(d: Doc | undefined): boolean {
  return !!d && d.status === 'ready' && (d.content !== d.savedContent || d.deleted);
}

export function indicatorOf(d: Doc | undefined): DocIndicator {
  if (!d || d.status === 'loading') return 'cargando';
  if (d.status === 'error') return 'error';
  if (d.conflict) return 'conflicto';
  if (d.saving) return 'guardando';
  if (isDirty(d)) return 'sin guardar';
  return 'guardado';
}

interface DocsState {
  docs: Record<string, Doc>;
  /** Peticiones de "ir a línea": key → {line, nonce}. */
  reveal: Record<string, { line: number; nonce: number }>;
}

export const useDocs = create<DocsState>(() => ({ docs: {}, reveal: {} }));

const get = () => useDocs.getState();
function patch(key: string, p: Partial<Doc>) {
  const d = get().docs[key];
  if (!d) return;
  useDocs.setState({ docs: { ...get().docs, [key]: { ...d, ...p } } });
}

// ---- Borradores en localStorage ----

// Clave por instancia (ver lib/instance.ts): `et:draft:<instanceId>:<root>:<path>`.
const draftKey = (key: string) => draftStorageKey(key);
const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();

function writeDraftNow(key: string) {
  draftTimers.delete(key);
  const d = get().docs[key];
  if (!d || d.status !== 'ready') return;
  if (d.content === d.savedContent && !d.deleted) {
    remove(draftKey(key));
    return;
  }
  const ok = save(draftKey(key), { content: d.content, baseRev: d.rev, savedAt: Date.now() } satisfies Draft);
  if (!ok) console.warn('No se pudo guardar el borrador local de', key);
}

function scheduleDraft(key: string) {
  const t = draftTimers.get(key);
  if (t) clearTimeout(t);
  draftTimers.set(key, setTimeout(() => writeDraftNow(key), 350));
}

/** Escribe ya todos los borradores pendientes (pagehide/beforeunload). */
export function flushDrafts() {
  for (const key of [...draftTimers.keys()]) {
    clearTimeout(draftTimers.get(key)!);
    writeDraftNow(key);
  }
}

export function readDraft(root: Root, path: string): Draft | null {
  return load<Draft | null>(draftKey(docKey(root, path)), null);
}

// ---- Carga ----

const loading = new Map<string, Promise<void>>();

/** Asegura que el documento está cargado (una sola vez por clave). */
export function ensureDoc(root: Root, path: string): Promise<void> {
  const key = docKey(root, path);
  const existing = get().docs[key];
  if (existing && existing.status !== 'error') return loading.get(key) ?? Promise.resolve();
  return loadDoc(root, path);
}

export function loadDoc(root: Root, path: string): Promise<void> {
  const key = docKey(root, path);
  const prev = get().docs[key];
  if (!prev || prev.status === 'error') {
    useDocs.setState({
      docs: {
        ...get().docs,
        [key]: {
          key, root, path, status: 'loading', content: '', savedContent: '', rev: '', saving: false,
          conflict: null, deleted: false, draftOffer: null, extVersion: 0,
        },
      },
    });
  }
  const p = (async () => {
    try {
      const f = await api.readFile(root, path);
      const draft = readDraft(root, path);
      let draftOffer: Draft | null = null;
      if (draft) {
        if (draft.content === f.content) remove(draftKey(key));
        else draftOffer = draft;
      }
      const cur = get().docs[key];
      if (!cur) return;
      patch(key, {
        status: 'ready', error: undefined, content: f.content, savedContent: f.content, rev: f.rev, mtime: f.mtime,
        draftOffer, deleted: false, extVersion: cur.extVersion + 1,
      });
    } catch (e) {
      patch(key, { status: 'error', error: e instanceof ApiError && e.status === 404 ? 'El archivo no existe' : errorMessage(e) });
    } finally {
      loading.delete(key);
    }
  })();
  loading.set(key, p);
  return p;
}

/** Libera el documento al cerrar su pestaña (el borrador, si lo hay, se queda en localStorage). */
export function releaseDoc(key: string) {
  const d = get().docs[key];
  if (!d) return;
  if (isDirty(d)) {
    flushDrafts();
    writeDraftNow(key);
    toast({ kind: 'warn', text: `«${d.path}» tenía cambios sin guardar: se conserva el borrador y se ofrecerá al reabrirlo.` });
  }
  const docs = { ...get().docs };
  delete docs[key];
  useDocs.setState({ docs });
}

// ---- Renombrar, mover y eliminar (v0.7) ----

/** Claves antiguas de documentos movidos: el `unlink` que detecte el vigilante no es un borrado. */
const movedAway = new Map<string, number>();
const MOVED_GRACE_MS = 15_000;
const wasMovedAway = (key: string) => {
  const t = movedAway.get(key);
  if (t == null) return false;
  if (Date.now() - t < MOVED_GRACE_MS) return true;
  movedAway.delete(key);
  return false;
};

/** Pasa un documento abierto (y su borrador y su cursor) a otra ruta, sin recargar el editor. Devuelve si había documento. */
export function rekeyDoc(root: Root, from: string, to: string): boolean {
  const oldKey = docKey(root, from);
  const newKey = docKey(root, to);
  if (oldKey === newKey) return false;
  movedAway.set(oldKey, Date.now());
  // Borrador pendiente de escribir: ahora, con la clave vieja, y luego se mueve.
  const t = draftTimers.get(oldKey);
  if (t) {
    clearTimeout(t);
    writeDraftNow(oldKey);
  }
  renameDraft(oldKey, newKey);
  const cur = useCursor.getState().lines;
  if (oldKey in cur) {
    const lines = { ...cur, [newKey]: cur[oldKey] };
    delete lines[oldKey];
    useCursor.setState({ lines });
  }
  const d = get().docs[oldKey];
  if (!d) return false;
  const docs = { ...get().docs };
  delete docs[oldKey];
  docs[newKey] = { ...d, key: newKey, path: to };
  const reveal = { ...get().reveal };
  delete reveal[oldKey];
  useDocs.setState({ docs, reveal });
  return true;
}

/** Olvida un documento eliminado: sin pestaña, sin borrador y sin aviso al llegar el `unlink`. */
export function dropDoc(root: Root, path: string) {
  const key = docKey(root, path);
  movedAway.set(key, Date.now());
  const t = draftTimers.get(key);
  if (t) clearTimeout(t);
  draftTimers.delete(key);
  remove(draftKey(key));
  const docs = { ...get().docs };
  delete docs[key];
  useDocs.setState({ docs });
}

/** Documentos abiertos de una raíz bajo `path` (el propio archivo o los de una carpeta). */
export function docsUnder(root: Root, path: string): Doc[] {
  return Object.values(get().docs).filter((d) => d.root === root && (d.path === path || d.path.startsWith(path + '/')));
}

// ---- Edición ----

export function setContent(key: string, content: string) {
  const d = get().docs[key];
  if (!d || d.content === content) return;
  patch(key, { content });
  scheduleDraft(key);
}

/** Reemplaza el contenido desde fuera del editor (el editor se sincroniza con extVersion). */
function replaceContent(key: string, p: Partial<Doc> & { content: string }) {
  const d = get().docs[key];
  if (!d) return;
  patch(key, { ...p, extVersion: d.extVersion + 1 });
  scheduleDraft(key);
}

export function restoreDraft(key: string) {
  const d = get().docs[key];
  if (!d?.draftOffer) return;
  replaceContent(key, { content: d.draftOffer.content, draftOffer: null });
}

export function discardDraft(key: string) {
  remove(draftKey(key));
  patch(key, { draftOffer: null });
}

export function requestReveal(key: string, line: number) {
  useDocs.setState({ reveal: { ...get().reveal, [key]: { line, nonce: Date.now() + Math.random() } } });
}

// ---- Guardado ----

export async function saveDoc(key: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const d = get().docs[key];
  if (!d || d.status !== 'ready' || d.saving) return false;
  if (!isDirty(d) && !d.conflict) return true;
  const sent = d.content;
  patch(key, { saving: true });
  try {
    let rev: string;
    let mtime: number | undefined;
    if (d.deleted) {
      const r = await api.createFile(d.root, d.path, sent);
      rev = r.rev;
      mtime = r.mtime;
    } else {
      const r = await api.saveFile(d.root, d.path, sent, d.rev);
      rev = r.rev;
      mtime = r.mtime;
    }
    const cur = get().docs[key];
    if (cur) {
      patch(key, { saving: false, rev, mtime, savedContent: sent, conflict: null, deleted: false, lastSavedAt: Date.now() });
      writeDraftNow(key);
    }
    if (d.root === 'memoria') {
      useCompile.getState().markMemoriaChanged();
      refreshOutlineSoon(1500);
    }
    return true;
  } catch (e) {
    if (e instanceof ConflictError) {
      patch(key, { saving: false, conflict: { content: e.content, rev: e.rev, source: 'save' } });
      return false;
    }
    patch(key, { saving: false });
    writeDraftNow(key);
    if (!opts.quiet) toast({ kind: 'error', text: `No se pudo guardar «${d.path}»: ${errorMessage(e)}. El borrador local está a salvo.` });
    return false;
  }
}

/** Resolución de conflictos. */
export async function keepMine(key: string): Promise<boolean> {
  const d = get().docs[key];
  if (!d?.conflict) return saveDoc(key);
  // Re-PUT con la revisión nueva del disco como base.
  patch(key, { rev: d.conflict.rev, conflict: null, savedContent: d.conflict.content });
  return saveDoc(key);
}

export function loadDisk(key: string) {
  const d = get().docs[key];
  if (!d?.conflict) return;
  const { content, rev } = d.conflict;
  replaceContent(key, { content, savedContent: content, rev, conflict: null });
}

export async function saveAll(root?: Root): Promise<void> {
  const keys = Object.values(get().docs)
    .filter((d) => isDirty(d) && !d.conflict && (!root || d.root === root))
    .map((d) => d.key);
  await Promise.all(keys.map((k) => saveDoc(k)));
}

// ---- Cambios en disco (SSE) ----

export async function handleExternalChange(ev: ChangeEvent) {
  const key = docKey(ev.root, ev.path);
  const d = get().docs[key];
  if (!d || d.status !== 'ready') return;
  if (ev.kind === 'move') return; // lo trata state/files.ts
  if (ev.kind === 'unlink') {
    if (wasMovedAway(key)) return; // eco de un movimiento o borrado hecho desde aquí
    patch(key, { deleted: true });
    scheduleDraft(key);
    toast({ kind: 'warn', text: `«${ev.path}» se ha eliminado del disco. Guarda para recrearlo.` });
    return;
  }
  if (d.saving) return; // el eco de nuestro propio guardado
  let f;
  try {
    f = await api.readFile(ev.root, ev.path);
  } catch {
    return;
  }
  const cur = get().docs[key];
  if (!cur || cur.saving) return;
  if (f.rev === cur.rev && !cur.deleted) return; // nada nuevo (p. ej. nuestro guardado)
  if (!isDirty(cur) || f.content === cur.content) {
    // Limpio (o idéntico): recarga silenciosa.
    replaceContent(key, { content: f.content, savedContent: f.content, rev: f.rev, mtime: f.mtime, deleted: false, conflict: null });
    return;
  }
  // Con cambios locales: conflicto pendiente.
  patch(key, { deleted: false, conflict: { content: f.content, rev: f.rev, source: 'external' } });
}

/** Resumen para la cabecera. */
export function useGlobalSaveState() {
  return useDocs((s) => {
    let dirty = 0;
    let conflicts = 0;
    let saving = 0;
    for (const d of Object.values(s.docs)) {
      if (d.conflict) conflicts++;
      else if (isDirty(d)) dirty++;
      if (d.saving) saving++;
    }
    return `${dirty}|${conflicts}|${saving}`;
  });
}

export function anyDirty(): boolean {
  return Object.values(get().docs).some((d) => isDirty(d) || !!d.conflict);
}
