export declare const REPO_ROOT: string;
export declare const TEMPLATE_DIR: string;
export declare function isEmptyDir(dir: string): boolean;
export declare function createMemoriaFromTemplate(dir: string, opts?: { template?: string }): { dir: string; git: boolean };
