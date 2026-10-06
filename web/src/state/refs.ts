// Autocompletado (v0.8): citas, etiquetas y acrónimos de la memoria (GET /api/memoria/refs).
// Se carga bajo demanda (al escribir en un .tex) y se refresca, con retardo, al cambiar la memoria.

import { create } from 'zustand';
import { api, type RefsResponse } from '../api';

interface RefsState {
  data: RefsResponse | null;
  /** Cambió algo en disco desde la última carga. */
  stale: boolean;
}

export const useRefs = create<RefsState>(() => ({ data: null, stale: false }));

let inflight: Promise<RefsResponse | null> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<RefsResponse | null> {
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const data = await api.memoriaRefs();
      useRefs.setState({ data, stale: false });
      return data;
    } catch {
      // Sin servidor o memoria sin configurar: se sigue con lo último que hubiera.
      return useRefs.getState().data;
    } finally {
      inflight = null;
    }
  })();
  inflight = p;
  return p;
}

/** Datos para completar: la primera vez (o si quedaron obsoletos) se piden al servidor. */
export function ensureRefs(): Promise<RefsResponse | null> {
  const { data, stale } = useRefs.getState();
  if (data && !stale) return Promise.resolve(data);
  if (data) {
    // Obsoletos pero usables: se devuelven ya y se actualizan en segundo plano.
    void load();
    return Promise.resolve(data);
  }
  return load();
}

/** Cambio en la memoria: si ya se usó el autocompletado, se relee tras una pausa. */
export function refreshRefsSoon(path: string, delay = 700) {
  if (!/\.(tex|bib)$/i.test(path)) return;
  if (!useRefs.getState().data) return;
  useRefs.setState({ stale: true });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, delay);
}

/** Ajustes cambiados (otra memoria): se olvida lo cargado. */
export function invalidateRefs() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  useRefs.setState({ data: null, stale: false });
}
