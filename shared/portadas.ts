export const ZONAS = ['superior', 'central', 'inferior'] as const;
export type ZonaPortada = typeof ZONAS[number];
export const ELEMENTOS_PORTADA = [
  ['logo', 'Logo'], ['universidad', 'Universidad'], ['escuela', 'Escuela o facultad'], ['titulacion', 'Titulación'],
  ['tipo', 'Tipo de trabajo'], ['titulo', 'Título'], ['autor', 'Autor/a'], ['tutor', 'Tutor/a'],
  ['cotutor', 'Cotutor/a'], ['fecha', 'Fecha'],
  ['departamento', 'Departamento'], ['intensificacion', 'Especialidad'], ['cursoAcademico', 'Curso académico'],
  ['convocatoria', 'Convocatoria'], ['fechaDefensa', 'Fecha de defensa'], ['firma', 'Firma'], ['imagen', 'Imagen'],
] as const;
export type ElementoPortada = typeof ELEMENTOS_PORTADA[number][0] | 'texto';
export interface BloquePortada { id: string; tipo: ElementoPortada; zona: ZonaPortada; texto?: string; alineacion?: 'izquierda' | 'centro' | 'derecha'; espacio?: number; recurso?: string }
export interface PortadasConfig { exterior: BloquePortada[]; interior: BloquePortada[] }
export function portadasIniciales(): PortadasConfig {
  const common: BloquePortada[] = [
    ...(['logo', 'universidad', 'escuela', 'titulacion'] as const).map((tipo) => ({ id: tipo, tipo, zona: 'superior' as const })),
    ...(['tipo', 'titulo', 'autor'] as const).map((tipo) => ({ id: tipo, tipo, zona: 'central' as const })),
  ];
  return {
    exterior: [...common.map((b) => ({ ...b })), { id: 'fecha', tipo: 'fecha', zona: 'inferior' }],
    interior: [...common.map((b) => ({ ...b })), ...(['tutor', 'cotutor', 'fecha'] as const).map((tipo) => ({ id: tipo, tipo, zona: 'inferior' as const }))],
  };
}
