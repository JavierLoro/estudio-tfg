import { portadasIniciales, type PortadasConfig } from './portadas.js';
import { ESTILO_DEFAULTS } from './estilo.js';
import { TIPOGRAFIA_DEFAULTS } from './tipografia.js';
import { PAGINACION_DEFAULTS } from './paginacion.js';
import { INDICES_DEFAULTS } from './indices.js';

export interface NuevaMemoriaConfig {
  datos: Record<string, string>; institucion: Record<string, string>;
  apartados: Record<string, boolean>; capitulos: string[]; portadas?: PortadasConfig;
}
export function configuracionInicial(): NuevaMemoriaConfig {
  return {
    datos: { titulo: '', autor: '', tutor: '', idioma: 'espanol', estiloBibliografia: 'numeric' },
    institucion: { universidad: '', escuela: '', titulacion: '', idiomaPortadas: 'documento', papel: 'a4', caras: 'una',
      tamanoLetra: '12pt', interlineado: '1.5', ...ESTILO_DEFAULTS, ...TIPOGRAFIA_DEFAULTS, ...PAGINACION_DEFAULTS, ...INDICES_DEFAULTS,
      margenInterior: '25mm', margenExterior: '25mm', margenSuperior: '25mm', margenInferior: '25mm' },
    apartados: { portada: true, portadaInterior: true, indices: true, bibliografia: true,
      derechos: false, tribunal: false, resumen: false, abstract: false, agradecimientos: false, anexo: false },
    portadas: portadasIniciales(), capitulos: ['Introducción', 'Desarrollo', 'Conclusiones'],
  };
}
