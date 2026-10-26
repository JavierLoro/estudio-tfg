import type { NuevaMemoriaConfig } from './nueva-memoria.ts';
export interface RequisitoNormativa {
  nombre: string; valor: string; pagina: number | null; cita: string;
}
export interface DudaNormativa { id: string; pregunta: string; opciones: string[]; pagina: number | null; cita: string }
export interface PropuestaNormativa {
  id: string; rev: string; account: string; project: string; model: string;
  source: { name: string; type: 'pdf' | 'text'; rev: string };
  state: 'running' | 'prepared' | 'cancelled' | 'error' | 'creating' | 'created';
  createdAt: number; updatedAt: number; calls: number; error?: string; destination?: string;
  config: NuevaMemoriaConfig | null; requisitos: RequisitoNormativa[]; dudas: DudaNormativa[];
  limitaciones: string[]; respuestas: Record<string, string>;
}
