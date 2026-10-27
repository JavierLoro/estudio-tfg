import { TIPOGRAFIA_DEFAULTS } from './tipografia.js';
import { PAGINACION_DEFAULTS } from './paginacion.js';
import { INDICES_DEFAULTS } from './indices.js';

export interface CampoEstilo {
  key: string; label: string; grupo: string; defecto: string;
  opciones?: readonly (readonly [string, string])[];
  min?: number; max?: number; unidad?: 'mm' | 'pt' | 'em';
}
const alineacion = [['izquierda', 'Izquierda'], ['centro', 'Centro'], ['derecha', 'Derecha']] as const;
export const CAMPOS_ESTILO: CampoEstilo[] = [
  { key: 'alineacionParrafo', label: 'Alineación', grupo: 'Párrafos', defecto: 'justificada', opciones: [['justificada', 'Justificada'], ...alineacion] },
  { key: 'sangriaParrafo', label: 'Sangría (em)', grupo: 'Párrafos', defecto: '1em', min: 0, max: 5, unidad: 'em' },
  { key: 'espacioParrafo', label: 'Entre párrafos (pt)', grupo: 'Párrafos', defecto: '0pt', min: 0, max: 40, unidad: 'pt' },
  ...(['Capitulo', 'Seccion', 'Subseccion'] as const).flatMap((nivel, i): CampoEstilo[] => [
    { key: 'alineacion' + nivel, label: 'Alineación', grupo: ['Capítulos', 'Secciones', 'Subsecciones'][i], defecto: 'izquierda', opciones: alineacion },
    { key: 'antes' + nivel, label: 'Antes (mm)', grupo: ['Capítulos', 'Secciones', 'Subsecciones'][i], defecto: ['10mm', '5mm', '4mm'][i], min: 0, max: 80, unidad: 'mm' },
    { key: 'despues' + nivel, label: 'Después (mm)', grupo: ['Capítulos', 'Secciones', 'Subsecciones'][i], defecto: ['38mm', '0mm', '-1mm'][i], min: -5, max: 80, unidad: 'mm' },
  ]),
  { key: 'marcaLista', label: 'Viñeta', grupo: 'Listas', defecto: 'actual', opciones: [['actual', 'Actual'], ['punto', 'Punto'], ['guion', 'Guion'], ['cuadrado', 'Cuadrado']] },
  { key: 'marcaEnumeracion', label: 'Enumeración', grupo: 'Listas', defecto: 'actual', opciones: [['actual', 'Actual'], ['numero', '1. 2. 3.'], ['letra', 'a) b) c)'], ['romano', 'i. ii. iii.']] },
  { key: 'espacioLista', label: 'Entre elementos (pt)', grupo: 'Listas', defecto: '1pt', min: 0, max: 30, unidad: 'pt' },
  { key: 'margenLista', label: 'Antes y después (pt)', grupo: 'Listas', defecto: '3pt', min: 0, max: 40, unidad: 'pt' },
  ...(['Figura', 'Tabla', 'Codigo'] as const).flatMap((tipo, i): CampoEstilo[] => [
    { key: 'fuenteLeyenda' + tipo, label: 'Fuente', grupo: ['Leyendas de figuras', 'Leyendas de tablas', 'Leyendas de código'][i], defecto: 'texto', opciones: [['texto', 'Texto'], ['sans', 'Palo seco'], ['codigo', 'Código']] },
    { key: 'tamanoLeyenda' + tipo, label: 'Tamaño', grupo: ['Leyendas de figuras', 'Leyendas de tablas', 'Leyendas de código'][i], defecto: 'small', opciones: [['footnotesize', 'Pequeño'], ['small', 'Mediano'], ['normalsize', 'Como el texto']] },
    { key: 'alineacionLeyenda' + tipo, label: 'Alineación', grupo: ['Leyendas de figuras', 'Leyendas de tablas', 'Leyendas de código'][i], defecto: 'actual', opciones: [['actual', 'Actual'], ['justificada', 'Justificada'], ...alineacion] },
    { key: 'espacioLeyenda' + tipo, label: 'Separación (pt)', grupo: ['Leyendas de figuras', 'Leyendas de tablas', 'Leyendas de código'][i], defecto: '6pt', min: 0, max: 40, unidad: 'pt' },
  ]),
  { key: 'anchoPapel', label: 'Ancho del papel (mm)', grupo: 'Papel personalizado', defecto: '210mm', min: 100, max: 500, unidad: 'mm' },
  { key: 'altoPapel', label: 'Alto del papel (mm)', grupo: 'Papel personalizado', defecto: '297mm', min: 140, max: 700, unidad: 'mm' },
];
export const ESTILO_DEFAULTS: Record<string, string> = Object.fromEntries(CAMPOS_ESTILO.map(f => [f.key, f.defecto]));
export const COMPORTAMIENTOS_ESTILO = [
  'Doble cara: capítulos en página impar.', 'Romano en preliminares y arábigo desde 1 en el cuerpo, o numeración continua.',
  'Bibliografía numeric: orden alfabético y citas numéricas.', 'Figuras, tablas y código numerados por capítulo.',
  'numerarHasta solo controla la numeración de títulos; indiceHasta solo controla la profundidad del índice. No cambian los contadores de figuras, tablas o código.',
  'Resumen y Abstract son apartados separados; su orden se invierte automáticamente al elegir inglés como idioma del documento.',
  'Departamento, especialidad, autoría, tutoría y fecha se rellenan después; su ausencia no es una incompatibilidad. La hoja de tribunal incluye espacios para firmas manuscritas.',
  'Portadas y hojas de cortesía sin número visible.', 'Las matemáticas conservan su familia comprobada.',
];
export interface StyleProfile { valores: Record<string, string>; baseRev: string | null; compatible: boolean; capacidades: CampoEstilo[]; automatico: string[] }
export const VALORES_ESTILO = { ...TIPOGRAFIA_DEFAULTS, ...PAGINACION_DEFAULTS, ...INDICES_DEFAULTS, ...ESTILO_DEFAULTS };
