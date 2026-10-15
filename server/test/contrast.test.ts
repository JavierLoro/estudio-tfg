import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contraste de los tokens de color de la interfaz (web/src/index.css), en claro y oscuro.
// WCAG 2.2 AA: texto ≥ 4,5:1; bordes de control, anillo de foco e iconos ≥ 3:1.

const WEB_SRC = join(import.meta.dirname, '../../web/src');
const css = readFileSync(join(WEB_SRC, 'index.css'), 'utf8');

type RGBA = [number, number, number, number];
type Theme = 'claro' | 'oscuro';

/** Divide por comas de primer nivel (respeta paréntesis). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseColor(v: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((x) => x.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`Color no reconocido: ${v}`);
}

/** Tokens light-dark(claro, oscuro) del bloque :root. */
function readTokens(): Record<Theme, Record<string, RGBA>> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!root) throw new Error('Sin bloque :root en index.css');
  const out: Record<Theme, Record<string, RGBA>> = { claro: {}, oscuro: {} };
  for (const m of root[1].matchAll(/--([\w-]+):\s*light-dark\(([\s\S]*?)\);/g)) {
    const [light, dark] = splitTop(m[2]);
    const name = m[1].replace(/^et-/, '');
    out.claro[name] = parseColor(light);
    out.oscuro[name] = parseColor(dark);
  }
  return out;
}

const tokens = readTokens();

/** Color opaco resultante de pintar `top` sobre `base`. */
function over(top: RGBA, base: RGBA): RGBA {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + base[i] * (1 - a)).concat(1) as RGBA;
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(a: RGBA, b: RGBA): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Superficie: un token o «token/sobre» (p. ej. hover sobre bg-soft). */
function surface(theme: Theme, name: string): RGBA {
  const t = tokens[theme];
  const [top, base = 'bg'] = name.split('/');
  const c = t[top];
  if (!c) throw new Error(`Token desconocido: ${top}`);
  return c[3] < 1 ? over(c, surface(theme, base)) : c;
}

const SURFACES = ['bg', 'bg-soft', 'bg-sunken', 'rail', 'hover/bg', 'hover/bg-soft', 'hover/rail'];
const TEXT = ['fg', 'muted', 'accent', 'ok', 'warn', 'danger', 'info'];

// [primer plano, fondo, mínimo]
const pairs: [string, string, number][] = [
  ...TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg, 4.5] as [string, string, number])),
  // Selección: elemento activo de árboles, pestañas y botones conmutados.
  ['fg', 'active', 4.5],
  ['muted', 'active', 4.5],
  ['accent', 'active', 4.5],
  // Botón primario.
  ['accent-fg', 'accent', 4.5],
  ['accent-fg', 'accent-hover', 4.5],
  // Avisos con su fondo propio (Banner, StatusPill).
  ['ok', 'ok-bg', 4.5],
  ['warn', 'warn-bg', 4.5],
  ['danger', 'danger-bg', 4.5],
  ['info', 'info-bg', 4.5],
  ['fg', 'warn-bg', 4.5],
  ['fg', 'danger-bg', 4.5],
  ['fg', 'info-bg', 4.5],
  ['fg', 'ok-bg', 4.5],
  // Coincidencias resaltadas en búsquedas.
  ['fg', 'mark', 4.5],
  // Sintaxis del editor sobre el fondo y la línea activa.
  ...['syn-keyword', 'syn-command', 'syn-string', 'syn-comment', 'syn-number', 'syn-bracket', 'syn-heading', 'syn-link', 'syn-meta']
    .flatMap((fg) => [[fg, 'bg', 4.5], [fg, 'cm-active-line/bg', 4.5]] as [string, string, number][]),
  // No textuales: bordes de controles, anillo de foco e iconos (faint).
  ...['border-strong', 'focus', 'faint'].flatMap((fg) =>
    ['bg', 'bg-soft', 'bg-sunken', 'rail'].map((bg) => [fg, bg, 3] as [string, string, number])),
  ['focus', 'active', 3],
];

describe('contraste de los tokens de color', () => {
  it('hay tokens para los dos temas', () => {
    expect(Object.keys(tokens.claro).length).toBeGreaterThan(20);
    expect(Object.keys(tokens.oscuro)).toEqual(Object.keys(tokens.claro));
  });
  for (const theme of ['claro', 'oscuro'] as Theme[]) {
    it(`tema ${theme}: todos los pares cumplen su mínimo`, () => {
      const fails = pairs
        .map(([fg, bg, min]) => ({ fg, bg, min, r: ratio(surface(theme, fg), surface(theme, bg)) }))
        .filter((p) => p.r < p.min)
        .map((p) => `${p.fg} sobre ${p.bg}: ${p.r.toFixed(2)} < ${p.min}`);
      expect(fails).toEqual([]);
    });
  }
});

describe('uso de los tokens', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(f)) files.push(p);
    }
  };
  walk(WEB_SRC);
  it('«faint» no se usa como color de texto', () => {
    const bad = files.filter((f) => /\btext-faint\b|placeholder:text-faint|color:\s*'?var\(--et-faint\)/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('no hay tamaños de letra en px por debajo de la escala', () => {
    const bad = files.filter((f) => /text-\[\d+(\.\d+)?px\]/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
