export type PathSep = '/' | '\\';

/** Rutas del servidor: no dependen del sistema del navegador. */
export function isAbsPath(p: string): boolean {
  return /^(\/|~(?:[\\/]|$)|[A-Za-z]:[\\/]|\\\\)/.test(p);
}

/** Conserva la unidad o el recurso UNC como una única raíz. */
export function splitAbs(p: string): { root: string; parts: string[] } {
  const unc = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)(?:[\\/]|$)/.exec(p);
  const drive = /^[A-Za-z]:[\\/]/.exec(p);
  const home = /^~(?:[\\/]|$)/.exec(p);
  const sep: PathSep = p.includes('\\') ? '\\' : '/';
  const root = unc ? `${sep}${sep}${unc[1]}${sep}${unc[2]}${sep}` : drive ? `${p.slice(0, 2)}${sep}` : home ? '~' : p.startsWith('/') ? '/' : '';
  const rest = p.slice(unc?.[0].length ?? drive?.[0].length ?? home?.[0].length ?? root.length);
  const parts: string[] = [];
  for (const part of rest.split(/[\\/]/).filter(Boolean)) {
    if (part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return { root, parts };
}

export function joinAbs(dir: string, name: string, sep: PathSep): string {
  const base = dir.replace(/[\\/]/g, sep);
  const tail = name.replace(/[\\/]/g, sep).replace(/^[\\/]+/, '');
  return base.endsWith(sep) ? base + tail : `${base}${sep}${tail}`;
}

/** Relativa dentro de base (siempre con /), vacía para base, null fuera. */
export function relUnder(base: string, p: string): string | null {
  if (!isAbsPath(base) || !isAbsPath(p)) return null;
  const b = splitAbs(base);
  const c = splitAbs(p);
  const windows = /^[A-Za-z]:/.test(b.root) || /^[\\/]{2}/.test(b.root);
  const key = (s: string) => windows ? s.replace(/\\/g, '/').toLowerCase() : s.replace(/\\/g, '/');
  if (key(b.root) !== key(c.root) || b.parts.length > c.parts.length) return null;
  if (b.parts.some((part, i) => key(part) !== key(c.parts[i]))) return null;
  return c.parts.slice(b.parts.length).join('/');
}

export function parentAbs(p: string, sep: PathSep): string {
  const { root, parts } = splitAbs(p);
  return parts.slice(0, -1).reduce((dir, part) => joinAbs(dir, part, sep), root);
}

/** Migas desde la raíz permitida más próxima; conserva raíces de disco y UNC. */
export function absCrumbs(p: string, roots: string[], sep: PathSep): { label: string; path: string }[] {
  const root = roots.filter((r) => relUnder(r, p) !== null).sort((a, b) => b.length - a.length)[0];
  const split = splitAbs(p);
  let acc = root ?? split.root;
  const parts = root ? relUnder(root, p)!.split('/').filter(Boolean) : split.parts;
  const out = acc ? [{ label: acc, path: acc }] : [];
  for (const part of parts) {
    acc = joinAbs(acc, part, sep);
    out.push({ label: part, path: acc });
  }
  return out;
}
