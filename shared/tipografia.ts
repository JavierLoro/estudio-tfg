export const FUENTES_TEXTO = [
  ['times', 'Times · NewTX'],
  ['latinmodern', 'Clásica de LaTeX · Latin Modern Roman'],
  ['palatino', 'Palatino · NewPX'],
  ['heros', 'Palo seco · TeX Gyre Heros'],
  ['schola', 'TeX Gyre Schola'], ['bonum', 'TeX Gyre Bonum'], ['adventor', 'TeX Gyre Adventor'],
] as const;
export const FUENTES_TITULOS = [
  ['sans', 'Palo seco · Latin Modern Sans'], ['texto', 'La misma que el texto'],
  ['times', 'Times · TeX Gyre Termes'], ['latinmodern', 'Clásica · Latin Modern Roman'],
  ['palatino', 'Palatino · TeX Gyre Pagella'], ['heros', 'Palo seco · TeX Gyre Heros'],
  ['schola', 'TeX Gyre Schola'], ['bonum', 'TeX Gyre Bonum'], ['adventor', 'TeX Gyre Adventor'],
] as const;
export const FUENTES_CODIGO = [['bera', 'Bera Mono'], ['latinmodernmono', 'Latin Modern Mono'], ['cursor', 'TeX Gyre Cursor']] as const;
export const NIVELES_TITULOS = [['Capitulo', 'Capítulos'], ['Seccion', 'Secciones'], ['Subseccion', 'Subsecciones']] as const;
export const FUENTES_PERSONALES_KEYS = ['fuenteTexto','fuenteTitulos','fuenteCodigo',...NIVELES_TITULOS.map(([nivel]) => 'fuente'+nivel)];
export const TIPOGRAFIA_DEFAULTS: Record<string, string> = {
  fuenteTexto: 'times', fuenteTitulos: 'sans', fuenteCodigo: 'bera',
  fuenteCapitulo: 'heredar', tamanoCapitulo: '22', negritaCapitulo: 'si', mayusculasCapitulo: 'si',
  fuenteSeccion: 'heredar', tamanoSeccion: '15', negritaSeccion: 'si', mayusculasSeccion: 'si',
  fuenteSubseccion: 'heredar', tamanoSubseccion: '13.5', negritaSubseccion: 'si', mayusculasSubseccion: 'no',
};
export const TIPOGRAFIA_KEYS = Object.keys(TIPOGRAFIA_DEFAULTS);
