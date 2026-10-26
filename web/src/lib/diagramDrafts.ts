import type { Draft } from '../state/docs';

// Las escenas con imágenes no caben de forma fiable en localStorage.
let serial: Promise<unknown> = Promise.resolve();
function transaction<T>(run: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  const work = () => new Promise<T>((resolve, reject) => {
    const request = indexedDB.open('et:diagram-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cierra otras pestañas para recuperar los borradores de diagramas'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('drafts', 'readwrite', { durability: 'strict' });
      let value: T;
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('No se pudo conservar el borrador del dibujo')); };
      try { run(tx.objectStore('drafts'), v => { value = v; }); }
      catch (e) { tx.abort(); reject(e); }
    };
  });
  const next = serial.then(work, work);
  serial = next.catch(() => undefined);
  return next;
}

export const diagramDrafts = {
  read: (key: string) => transaction<Draft | null>((store, done) => {
    const r = store.get(key); r.onsuccess = () => done(r.result ?? null);
  }),
  write: (key: string, draft: Draft | null) => transaction<void>(store => { if (draft) store.put(draft, key); else store.delete(key); }),
  rename: (from: string, to: string) => transaction<void>(store => {
    const r = store.get(from);
    r.onsuccess = () => {
      if (r.result) {
        const target = store.get(to);
        target.onsuccess = () => {
          if (target.result) { store.transaction.abort(); return; }
          store.put(r.result, to); store.delete(from);
        };
      }
    };
  }),
};
