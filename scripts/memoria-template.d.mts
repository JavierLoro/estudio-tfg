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
