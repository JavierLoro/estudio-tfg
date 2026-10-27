import type { NuevaMemoriaConfig } from './nueva-memoria.ts';
export interface RequisitoNormativa {
  nombre: string; valor: string; pagina: number | null; cita: string;
}
export interface DudaNormativa { id: string; pregunta: string; opciones: string[]; pagina: number | null; cita: string }
export interface AvisoNormativa { id: string; texto: string; descartado: boolean }
export interface PropuestaNormativa {
  id: string; rev: string; account: string; project: string; model: string;
  source: { name: string; type: 'pdf' | 'text'; rev: string };
  state: 'running' | 'prepared' | 'cancelled' | 'error' | 'creating' | 'created';
  createdAt: number; updatedAt: number; calls: number; error?: string; destination?: string;
  config: NuevaMemoriaConfig | null; requisitos: RequisitoNormativa[]; dudas: DudaNormativa[];
  limitaciones: string[]; respuestas: Record<string, string>;
  referenciaId?: string; referenciaRev?: string;
  referencia?: NuevaMemoriaConfig;
  aceptada?: NuevaMemoriaConfig;
  revisionAceptada?: {requisitos: RequisitoNormativa[]; avisos: AvisoNormativa[]; correcciones: string[]};
  preview?: { id: string; configRev: string; ok: boolean; diagnostics: { severity: string; message: string }[] };
  appliedRev?: string;
  avisos: AvisoNormativa[]; correcciones: string[];
}
