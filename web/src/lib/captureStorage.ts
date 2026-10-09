import { loadRequired, remove } from './storage';

export interface QueuedCapture {
  id: string;
  createdAt: number;
  libraryId?: string;
  destination?: string;
  url?: string;
  title?: string;
  note?: string;
  tags?: string;
  file?: { name: string; type: string; blob: Blob };
  lastError?: string;
  blocked?: boolean;
}
const LEGACY_KEY = 'et:capture-queue';
const DB_NAME = 'et:captures';

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('items', { keyPath: 'id' });
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cierra otras pestañas para abrir la cola de capturas'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (v: T) => void) => void): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      let result: T;
      // Durabilidad estricta para contenido del usuario antes del envío.
      const tx = db.transaction(['items', 'meta'], mode, { durability: 'strict' });
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('No se pudo guardar la captura localmente'));
      try { run(tx, (v) => { result = v; }); }
      catch (e) { tx.abort(); reject(e); }
    });
  } finally { db.close(); }
}

function legacyBlob(dataUrl: string, type: string): Blob {
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]*)$/.exec(dataUrl);
  if (!match) throw new Error('Hay un adjunto antiguo no válido; conserva la cola para recuperarlo');
  const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

export const captureStorage = {
  read: () => transaction<QueuedCapture[]>('readonly', (tx, done) => {
    const r = tx.objectStore('items').getAll();
    r.onsuccess = () => done((r.result as QueuedCapture[]).sort((a, b) => a.createdAt - b.createdAt));
  }),
  put: (item: QueuedCapture) => transaction<void>('readwrite', (tx) => { tx.objectStore('items').put(item); }),
  delete: (id: string) => transaction<void>('readwrite', (tx) => { tx.objectStore('items').delete(id); }),
  migrate: async () => {
    // Mantener el original si falla lectura, conversión o commit de la migración.
    const legacy = loadRequired<any[]>(LEGACY_KEY);
    if (legacy != null && !Array.isArray(legacy)) throw new Error('La cola antigua no es válida; conserva una copia antes de repararla');
    const converted: QueuedCapture[] = (legacy ?? []).map((item) => {
      if (!item || typeof item.id !== 'string' || typeof item.createdAt !== 'number') throw new Error('Captura antigua no válida');
      return { ...item, libraryId: undefined, destination: undefined, blocked: true,
        lastError: 'Asigna el vault de destino antes de enviar esta captura antigua',
        file: item.file ? { name: item.file.name, type: item.file.type, blob: legacyBlob(item.file.dataUrl, item.file.type) } : undefined,
      };
    });
    await transaction<void>('readwrite', (tx) => {
      const meta = tx.objectStore('meta');
      const r = meta.get('legacy-migrated');
      r.onsuccess = () => {
        if (r.result) return;
        const items = tx.objectStore('items');
        // add evita sustituir un elemento nuevo que ya tenga el mismo ID.
        for (const item of converted) {
          const exists = items.get(item.id);
          exists.onsuccess = () => {
            if (exists.result) tx.abort(); // Conservar el legado ante cualquier colisión.
            else items.add(item);
          };
        }
        meta.put(true, 'legacy-migrated');
      };
    });
    remove(LEGACY_KEY);
  },
};
