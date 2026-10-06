// Mermaid compartido (carga diferida). Mermaid es un singleton con una configuración
// global: las notas lo dibujan con el tema de la app y los diagramas de la memoria con el
// de impresión (lib/diagram.ts). Para que no se pisen, cada dibujo pasa por una cola y
// fija su configuración justo antes (initialize parte siempre de los valores por defecto).

import type { MermaidConfig } from 'mermaid';

type Mermaid = typeof import('mermaid').default;

let mermaidPromise: Promise<Mermaid> | null = null;
export function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) mermaidPromise = import('mermaid').then((m) => m.default);
  return mermaidPromise;
}

/** Configuración de las notas: tema de la app. */
export function appMermaidConfig(): MermaidConfig {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return { startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', fontFamily: 'inherit' };
}

let queue: Promise<unknown> = Promise.resolve();

/** Ejecuta `fn` con `config` aplicada, de una en una. */
export function withMermaid<T>(config: MermaidConfig, fn: (m: Mermaid) => Promise<T>): Promise<T> {
  const run = async () => {
    const m = await loadMermaid();
    m.initialize({ startOnLoad: false, securityLevel: 'strict', ...config });
    return fn(m);
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/** Dibuja con la configuración de las notas. */
export function renderAppMermaid(id: string, code: string) {
  return withMermaid(appMermaidConfig(), (m) => m.render(id, code));
}
