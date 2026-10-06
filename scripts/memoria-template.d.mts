export interface Perfil {
  id: string;
  nombre: string;
  descripcion: string;
}
export declare const REPO_ROOT: string;
export declare const TEMPLATES_DIR: string;
export declare const BASE_DIR: string;
export declare const PERFILES_DIR: string;
export declare const DEFAULT_PERFIL: string;
export declare function isEmptyDir(dir: string): boolean;
export declare function listPerfiles(): Perfil[];
export declare function perfilDir(perfil: string): string;
export declare function copyTemplate(dir: string, opts?: { perfil?: string }): void;
export declare function createMemoriaFromTemplate(dir: string, opts?: { perfil?: string }): { dir: string; git: boolean; perfil: string };
export interface Manifiesto {
  version: string;
  clase: string | null;
  comandosDatos: string[];
  /** Ruta (o "<perfil>:<ruta>") → sha256, o varios hashes conocidos (el primero es el actual). */
  archivos: Record<string, string | string[]>;
}
export declare const MANIFIESTOS_DIR: string;
export declare const PLANTILLA_VERSION: string;
export declare const GIT_IDENTITY: string[];
export declare function sha256(buf: string | Uint8Array): string;
export declare function templateFiles(perfil?: string): Map<string, string>;
export declare function claseDe(src: string): string | null;
export declare function comandosDatos(src: string): string[];
export declare function buildManifest(): Manifiesto;
export declare function hashesDe(v: string | string[] | undefined): string[];
export declare function mergeManifest(fresh: Manifiesto, old: Manifiesto | null): Manifiesto;
export declare function readManifiestos(): Manifiesto[];
export declare function manifestProblems(): string[];
