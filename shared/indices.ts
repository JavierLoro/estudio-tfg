export const TIPOS_INDICE = [
  ['indiceGeneral', 'Índice general'], ['indiceFiguras', 'Índice de figuras'],
  ['indiceTablas', 'Índice de tablas'], ['indiceCodigo', 'Índice de código'],
] as const;
export const NIVELES_APARTADOS = [
  ['capitulos', 'Capítulos'], ['secciones', 'Capítulos y secciones'],
  ['subsecciones', 'Capítulos, secciones y subsecciones'],
] as const;
export const INDICES_DEFAULTS: Record<string, string> = {
  ...Object.fromEntries(TIPOS_INDICE.map(([key]) => [key, 'si'])),
  numerarHasta: 'subsecciones', indiceHasta: 'subsecciones',
};
export const INDICES_KEYS = Object.keys(INDICES_DEFAULTS);
