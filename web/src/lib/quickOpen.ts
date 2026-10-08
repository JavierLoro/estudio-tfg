import { fold } from './search.js';

/** Puntuación difusa sencilla: subsecuencia, premiando el nombre y los inicios de palabra. */
export function score(path: string, q: string): number {
  const name = fold(path.slice(path.lastIndexOf('/') + 1));
  const full = fold(path);
  if (!q) return 1;
  if (name.startsWith(q)) return 1000 - name.length;
  if (name.includes(q)) return 800 - name.length;
  if (full.includes(q)) return 500 - full.length;
  let i = 0;
  let s = 0;
  for (let k = 0; k < full.length && i < q.length; k++) {
    if (full[k] === q[i]) {
      s += k === 0 || '/ -_.'.includes(full[k - 1]) ? 5 : 1;
      i++;
    }
  }
  return i === q.length ? s : -1;
}
