export const NUMERACION_PAGINAS = [
  ['romanos', 'Preliminares en romanos; cuerpo desde 1'],
  ['continua', 'Numeración continua desde el principio'],
] as const;
export const CONTENIDOS_PAGINA = [
  ['vacio', 'Vacío'], ['capitulo', 'Capítulo'], ['seccion', 'Sección'],
  ['pagina', 'Número de página'], ['texto', 'Texto propio'],
] as const;
export const POSICIONES_PAGINA = [
  ['cabeceraIzquierda', 'Cabecera izquierda'], ['cabeceraCentro', 'Cabecera central'], ['cabeceraDerecha', 'Cabecera derecha'],
  ['pieIzquierda', 'Pie izquierdo'], ['pieCentro', 'Pie central'], ['pieDerecha', 'Pie derecho'],
] as const;
export const PAGINACION_DEFAULTS: Record<string, string> = {
  numeracionPaginas: 'romanos', estiloPagina: 'actual', reflejarCabeceras: 'si', cabeceraInicioCapitulo: 'no',
  cabeceraIzquierda: 'capitulo', cabeceraCentro: 'vacio', cabeceraDerecha: 'seccion',
  pieIzquierda: 'vacio', pieCentro: 'pagina', pieDerecha: 'vacio',
  ...Object.fromEntries(POSICIONES_PAGINA.map(([key]) => [key + 'Texto', ''])),
};
export const PAGINACION_KEYS = Object.keys(PAGINACION_DEFAULTS);
