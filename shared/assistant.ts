export type ContextRoot = 'notes' | 'memoria';
export interface ContextPath { root: ContextRoot; path: string }
export type ContextScope = 'notes' | 'memoria' | 'library' | 'diagrams';
export interface ContextSelection {
  mode: 'off' | 'all' | 'partial'; scopes: ContextScope[];
  folders: ContextPath[]; files: ContextPath[]; excluded: ContextPath[];
}
export const CONTEXT_FIELDS = ['topic', 'objectives', 'scope', 'methodology', 'terminology', 'decisions', 'questions'] as const;
export type ContextProfile = Record<typeof CONTEXT_FIELDS[number], string>;
export const CONTEXT_LABELS: Record<keyof ContextProfile, string> = { topic: 'Tema', objectives: 'Objetivos', scope: 'Alcance', methodology: 'Metodología', terminology: 'Terminología', decisions: 'Decisiones confirmadas', questions: 'Preguntas pendientes' };
export interface ContextSource extends ContextPath { rev: string; offset: number; length: number }
export interface ContextFragment { id: string; text: string; source: ContextSource }
export interface ContextSnapshot {
  version: string; text: string; sources: ContextSource[]; profileRev: string;
}
export interface ContextProposal {
  id: string; state: 'running' | 'prepared' | 'accepted' | 'rejected' | 'error' | 'cancelled';
  fragments: ContextFragment[]; error?: string; remaining: number;
}
export interface ContextGrants { prepareContext: boolean; useContext: boolean; prepareDiagrams: boolean; search: boolean }
export interface ContextView {
  rev: string; project: string; account: string | null; profile: ContextProfile; selection: ContextSelection;
  grants: ContextGrants; fragments: (ContextFragment & { valid: boolean })[]; proposals: ContextProposal[];
  changed: { files: number; words: number; warn: boolean }; pending: number; warnings: string[];
  canUndo: boolean; effective: ContextSnapshot | null;
}
export const DIAGRAM_TYPES = ['flujo', 'secuencia', 'estados', 'arquitectura', 'er', 'clases', 'gantt', 'cronologia', 'mapa-mental', 'c4', 'kanban', 'requisitos', 'sectores', 'cuadrantes', 'sankey'] as const;
export interface DiagramGeneration {
  id: string; state: 'running' | 'prepared' | 'error' | 'cancelled'; name: string; type: string; description: string;
  model: string; code: string; explanation: string; assumptions: string; context?: ContextSnapshot; error?: string;
}
