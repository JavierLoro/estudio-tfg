export type Tools = { latexmk?: string; biber?: string; pdflatex?: string; lualatex?: string; rsvg?: string; perl?: string };
export type Diagnostic = { severity: 'error' | 'warning'; file: string; line: number | null; message: string };
export type Result = { ok: boolean; buildId: string; durationMs: number; pdf: string | null; log: string; diagnostics: Diagnostic[] };
export function newBuildId(): string;
export function pruneBuilds(root: string, keep?: number, currentId?: string): Promise<void>;
export function validateMain(main: unknown): string | null;
export function compileEnvironment(runtimeDir: string, options?: { tools?: Tools; platform?: string; windowsRoot?: string }): Record<string, string>;
export function run(cmd: string, args: string[], options: { cwd: string; timeoutMs: number; env: Record<string, string>; input?: string | Uint8Array; signal?: AbortSignal; platform?: string }): Promise<{ code: number; timedOut: boolean; cancelled: boolean; output: string }>;
export function compile(options: { main: string; workDir: string; outDir: string; buildId: string; started?: number; timeoutMs?: number; tools?: Tools; toolchain?: string; runtimeDir?: string; signal?: AbortSignal }): Promise<Result>;
export function svgToPdf(svg: string | Uint8Array, options?: { tool?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ pdf: Buffer; status?: never; error?: never } | { pdf?: never; status: number; error: string }>;

export function needsLua(workDir: string): Promise<boolean>;
