// Instancia actual (status.instanceId = hash de notesDir|memoriaDir).
// Los borradores y el layout se guardan con este prefijo para no mezclar
// archivos de vaults/memorias distintos que compartan ruta relativa.

import { keysWithPrefix, load, remove, save } from './storage';

const DRAFT_BASE = 'et:draft:';
const LAYOUT_BASE = 'et:layout:v1';
const MIGRATED_KEY = 'et:instance-migrated';

/** null = servidor sin instanceId (pre-v0.2): se usan las claves sin prefijo. */
let current: string | null = null;

export const getInstance = () => current;

export function setInstance(id: string | null) {
  current = id;
}

/** `et:draft:<instanceId>:<root>:<path>` (o `et:draft:<root>:<path>` sin instancia). */
export function draftStorageKey(docKey: string, instance: string | null = current): string {
  return instance ? `${DRAFT_BASE}${instance}:${docKey}` : DRAFT_BASE + docKey;
}

export function layoutStorageKey(instance: string | null = current): string {
  return instance ? `${LAYOUT_BASE}:${instance}` : LAYOUT_BASE;
}

function moveKey(from: string, to: string) {
  if (from === to) return;
  const v = load<unknown>(from, null);
  if (v == null) return;
  if (load<unknown>(to, null) == null) save(to, v);
  remove(from);
}

/** Mueve un borrador (si existe) de una instancia a otra. */
export function moveDraft(docKey: string, fromInstance: string | null, toInstance: string | null) {
  moveKey(draftStorageKey(docKey, fromInstance), draftStorageKey(docKey, toInstance));
}

/** Pasa el borrador de un documento a la clave de otro (renombrar o mover). */
export function renameDraft(fromDocKey: string, toDocKey: string) {
  const from = draftStorageKey(fromDocKey);
  const v = load<unknown>(from, null);
  if (v == null) return;
  save(draftStorageKey(toDocKey), v);
  remove(from);
}

/**
 * Una sola vez: los borradores y el layout guardados antes de v0.2 (sin prefijo)
 * pasan a la instancia actual.
 */
export function migrateLegacyKeys(instance: string) {
  if (load<string | null>(MIGRATED_KEY, null)) return;
  for (const k of keysWithPrefix(DRAFT_BASE)) {
    const rest = k.slice(DRAFT_BASE.length);
    if (rest.startsWith('notes:') || rest.startsWith('memoria:')) moveKey(k, draftStorageKey(rest, instance));
  }
  moveKey(LAYOUT_BASE, layoutStorageKey(instance));
  save(MIGRATED_KEY, instance);
}
