// Cliente tipado de la API (ver docs/CONTRACT.md).

export type Root = 'notes' | 'memoria';

export interface Status {
  notesDir: string;
  memoriaDir: string;
  memoriaMain: string;
  resourcesSubdir: string;
  syncConflicts: string[];
  worker: 'up' | 'down';
  /** v0.2: false si `notesDir` o `memoriaDir` no existen. */
  configured?: boolean;
  /** v0.2: hash corto de `notesDir|memoriaDir` (prefijo de borradores y layout). */
  instanceId?: string;
}

// ---- Ajustes (v0.2) ----

export const SETTINGS_KEYS = ['notesDir', 'resourcesSubdir', 'memoriaDir', 'memoriaMain'] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];
export type SettingsValues = Record<SettingsKey, string>;
export type SettingsSource = 'settings' | 'env' | 'default';

export interface SettingsCheck {
  key: string;
  level: 'ok' | 'warning' | 'error';
  message: string;
}

export interface SettingsResponse {
  pathSep: '/' | '\\';
  values: SettingsValues;
  sources: Record<SettingsKey, SettingsSource>;
  allowedRoots: string[];
  checks: SettingsCheck[];
}

export interface FsDir {
  name: string;
  path: string;
  isObsidianVault: boolean;
  hasMainTex: boolean;
  isGitRepo: boolean;
}

export interface FsDirsResponse {
  path: string | null;
  parent: string | null;
  dirs: FsDir[];
}

export interface Entry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  children?: Entry[];
}

export interface TreeResponse {
  root: Root;
  entries: Entry[];
}

export interface FileResponse {
  root: Root;
  path: string;
  content: string;
  rev: string;
  mtime: number;
}

export interface SaveResponse {
  rev: string;
  mtime: number;
}

export interface Backlink {
  path: string;
  title: string;
  snippet: string;
}

export type ResourceStatus = 'inbox' | 'revisado' | 'descartado';

export interface Resource {
  path: string;
  title: string;
  url?: string;
  captured: string;
  status: ResourceStatus | string;
  tags: string[];
  attachment?: string;
  rev?: string;
}

export interface SearchItem {
  root: Root;
  path: string;
  line: number;
  snippet: string;
  /** v0.3 (solo `memoria`): apartado más interno que contiene la línea. */
  outline?: { id: string; number: string | null; title: string } | null;
}

// ---- Vista Documento (v0.3) ----

export type OutlineKind = 'datos' | 'frontmatter' | 'chapter' | 'section' | 'subsection' | 'bibliography' | 'appendix';

export interface OutlineItem {
  id: string;
  kind: OutlineKind;
  title: string;
  number: string | null;
  file: string;
  line: number;
  enabled: boolean;
  words: number;
  warnings: string[];
  children: OutlineItem[];
  /** Solo `bibliography`: número de entradas de los .bib (si el servidor lo da). */
  entries?: number;
}

export interface OutlineResponse {
  main: string;
  items: OutlineItem[];
  words: number;
  generatedAt: string;
  /** Problemas de estructura (archivos que faltan, ciclos…), si el servidor los da. */
  warnings?: string[];
}

// ---- Autocompletado (v0.8): GET /api/memoria/refs ----

export interface RefCita {
  key: string;
  tipo: string;
  titulo: string;
  autor: string;
  anio: string;
  archivo: string;
}
export type RefEtiquetaTipo = 'capitulo' | 'seccion' | 'figura' | 'tabla' | 'listado' | 'ecuacion' | 'anexo' | 'otro';
export interface RefEtiqueta {
  label: string;
  tipo: RefEtiquetaTipo;
  texto: string;
  archivo: string;
  linea: number;
}
export interface RefAcronimo {
  sigla: string;
  significado: string;
  archivo: string;
  linea: number;
}
export interface RefsResponse {
  citas: RefCita[];
  etiquetas: RefEtiqueta[];
  acronimos: RefAcronimo[];
}

export type NewSectionKind = 'chapter' | 'section' | 'appendix';

export interface NewSectionRequest {
  kind: NewSectionKind;
  title: string;
  after?: string;
  parent?: string;
}

export interface NewSectionResponse {
  item: OutlineItem;
  file: string;
  line: number;
}

export const OUTLINE_CONFLICT_MSG = 'tfg.tex cambió; vuelve a intentarlo';

export interface Diagnostic {
  severity: 'error' | 'warning';
  file: string;
  line: number | null;
  message: string;
}

export interface CompileResult {
  ok: boolean;
  buildId: string;
  startedAt: string;
  durationMs: number;
  diagnostics: Diagnostic[];
  pdfUrl: string | null;
  sourceRev: string;
}

/** v0.4: zona del PDF (puntos, origen arriba a la izquierda de la página). */
export interface SynctexForward {
  build: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** v0.4: posición del título de cada apartado en el PDF (orden del documento). */
export interface SynctexOutline {
  build: string;
  items: { id: string; page: number; y: number }[];
}

export interface SynctexInverse {
  build: string;
  file: string;
  line: number;
}

export interface ChangeEvent {
  root: Root;
  path: string;
  /** `move` (v0.7): `path` es el destino y `from` el origen. */
  from?: string;
  kind: 'add' | 'change' | 'unlink' | 'move';
}

// ---- Gestión de archivos (v0.7) ----

export interface MoveResponse {
  path: string;
  moved: { from: string; to: string }[];
  updated: { path: string; rev: string }[];
  /** Reescrituras de enlaces que fallaron (el movimiento ya está hecho). */
  failed?: { path: string; error: string }[];
}

// ---- Datos del trabajo (v0.5) ----

export interface DatosResponse {
  datos: Record<string, string>;
  institucion: Record<string, string>;
  rev: { datos: string | null; institucion: string | null };
}

export interface DatosChanges {
  datos?: Record<string, string>;
  institucion?: Record<string, string>;
}

export interface Perfil {
  id: string;
  nombre: string;
  descripcion: string;
}

// ---- Actualizar plantilla (v0.6) ----

export type AccionPlantilla = 'crear' | 'sustituir' | 'editar' | 'retirar';

export interface CambioPlantilla {
  archivo: string;
  accion: AccionPlantilla;
  motivo: string;
  /** Revisión del archivo en la vista previa (null = no existe). */
  rev: string | null;
}

export interface RevisarPlantilla {
  archivo: string;
  motivo: string;
}

export interface PlantillaPreview {
  estado: 'actual' | 'desactualizada' | 'desconocida';
  versionMemoria: string | null;
  versionPlantilla: string;
  perfil: string;
  cambios: CambioPlantilla[];
  revisar: RevisarPlantilla[];
}

export interface PlantillaResultado {
  aplicados: CambioPlantilla[];
  revisar: RevisarPlantilla[];
  commit: string | null;
  deshacer: string;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Error de red (sin respuesta del servidor). */
export class NetworkError extends Error {}

/** 400 `{ error, field }`: error de validación asociado a un campo. */
export class FieldError extends ApiError {
  field: string;
  constructor(message: string, field: string, body: unknown) {
    super(400, message, body);
    this.field = field;
  }
}

/** 409 de `PUT /api/memoria/datos`: trae el estado actual del disco. */
export class DatosConflictError extends ApiError {
  current: DatosResponse;
  constructor(current: DatosResponse, body: unknown) {
    super(409, 'conflict', body);
    this.current = current;
  }
}

/** 409 de `POST /api/memoria/plantilla/actualizar`: la vista previa ya no vale; trae la nueva. */
export class PlantillaConflictError extends ApiError {
  actual: PlantillaPreview;
  constructor(message: string, actual: PlantillaPreview, body: unknown) {
    super(409, message, body);
    this.actual = actual;
  }
}

export const FORBIDDEN_SETTINGS_MSG = 'Solo se puede cambiar la configuración desde este equipo o con token';

export class ConflictError extends ApiError {
  content: string;
  rev: string;
  constructor(content: string, rev: string, body: unknown) {
    super(409, 'conflict', body);
    this.content = content;
    this.rev = rev;
  }
}

// ---- Auth (opcional: AUTH_TOKEN en el server) ----

const TOKEN_KEY = 'et:token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  // La cookie permite que <iframe>, <img> y EventSource se autentiquen.
  document.cookie = `et_token=${encodeURIComponent(token)}; path=/; max-age=31536000; SameSite=Strict`;
}

type TokenPrompt = () => Promise<string | null>;
let tokenPrompt: TokenPrompt | null = null;
let pendingPrompt: Promise<string | null> | null = null;

/** La UI registra aquí la función que pide el token al usuario. */
export function registerTokenPrompt(fn: TokenPrompt) {
  tokenPrompt = fn;
}

async function askToken(): Promise<string | null> {
  if (!tokenPrompt) return null;
  if (!pendingPrompt) {
    pendingPrompt = tokenPrompt().finally(() => {
      pendingPrompt = null;
    });
  }
  return pendingPrompt;
}

// ---- fetch base ----

async function request(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = readToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'Error de red');
  }
  if (res.status === 401 && !retried) {
    const t = await askToken();
    if (t) {
      setToken(t);
      return request(path, init, true);
    }
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    if (res.status === 409 && body && typeof body === 'object' && 'content' in body && 'rev' in body) {
      const b = body as { content: string; rev: string };
      throw new ConflictError(b.content, b.rev, body);
    }
    if (res.status === 400 && body && typeof body === 'object' && typeof (body as { field?: unknown }).field === 'string') {
      throw new FieldError(msg, (body as { field: string }).field, body);
    }
    throw new ApiError(res.status, msg, body);
  }
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  return (await res.json()) as T;
}

function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.set(k, v);
  return u.toString();
}

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Endpoints protegidos de ajustes: 403 → mensaje claro. */
async function guarded<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) throw new ApiError(403, FORBIDDEN_SETTINGS_MSG, e.body);
    throw e;
  }
}

// ---- Endpoints ----

export const api = {
  status: () => json<Status>('/api/status'),

  tree: (root: Root) => json<TreeResponse>(`/api/tree?${qs({ root })}`),

  readFile: (root: Root, path: string) => json<FileResponse>(`/api/file?${qs({ root, path })}`),

  /** Lanza ConflictError en 409. */
  saveFile: (root: Root, path: string, content: string, baseRev: string) =>
    json<SaveResponse>('/api/file', jsonBody('PUT', { root, path, content, baseRev })),

  createFile: (root: Root, path: string, content: string) =>
    json<SaveResponse>('/api/file', jsonBody('POST', { root, path, content })),

  /** v0.7: crea una carpeta (con intermedias). 409 si ya existe. */
  createDir: (root: Root, path: string) => json<{ path: string }>('/api/dir', jsonBody('POST', { root, path })),

  /** v0.7: renombra o mueve un archivo o carpeta. */
  move: (root: Root, from: string, to: string, updateLinks = true) =>
    json<MoveResponse>('/api/move', jsonBody('POST', { root, from, to, updateLinks })),

  /** v0.7: mueve a la papelera. `trashPath` es opaco: solo sirve para restaurar. */
  deleteFile: (root: Root, path: string) =>
    json<{ path: string; trashPath: string }>(`/api/file?${qs({ root, path })}`, { method: 'DELETE' }),

  restoreTrash: (root: Root, path: string, trashPath: string) =>
    json<{ path: string }>('/api/trash/restore', jsonBody('POST', { root, path, trashPath })),

  rawUrl: (root: Root, path: string) => `/api/raw?${qs({ root, path })}`,

  /** `from` = ruta de la nota que contiene el enlace (resuelve enlaces relativos). */
  resolveNote: (target: string, from?: string) => json<{ path: string }>(`/api/notes/resolve?${qs({ target, from })}`),

  backlinks: (path: string) => json<{ items: Backlink[] }>(`/api/notes/backlinks?${qs({ path })}`),

  capture: (form: FormData) => json<{ path: string; title: string }>('/api/capture', { method: 'POST', body: form }),

  resources: () => json<{ items: Resource[] }>('/api/resources'),

  patchResource: (body: { path: string; status?: string; tags?: string[]; baseRev?: string }) =>
    json<Resource & { rev: string; mtime: number }>('/api/resources', jsonBody('PATCH', body)),

  search: (q: string, root: Root | 'all' = 'all', signal?: AbortSignal) =>
    json<{ items: SearchItem[] }>(`/api/search?${qs({ q, root })}`, { signal }),

  compile: () => json<CompileResult>('/api/compile', { method: 'POST' }),

  lastCompile: async (): Promise<CompileResult | null> => {
    try {
      return await json<CompileResult>('/api/compile/last');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  // ---- Autocompletado (v0.8) ----

  memoriaRefs: () => json<RefsResponse>('/api/memoria/refs'),

  // ---- Vista Documento (v0.3) ----

  outline: () => json<OutlineResponse>('/api/memoria/outline'),

  /**
   * Crea un capítulo, sección o anexo. Lanza FieldError (400 con `field`) o
   * ApiError 409 con OUTLINE_CONFLICT_MSG si `tfg.tex` cambió entre lectura y escritura
   * (quien llama debe volver a leer el índice).
   */
  createSection: async (body: NewSectionRequest) => {
    try {
      return await json<NewSectionResponse>('/api/memoria/sections', jsonBody('POST', body));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) throw new ApiError(409, OUTLINE_CONFLICT_MSG, e.body);
      throw e;
    }
  },

  // ---- Datos del trabajo (v0.5) ----

  datos: () => json<DatosResponse>('/api/memoria/datos'),

  /** Lanza DatosConflictError (409), FieldError (400 con `field`) o ApiError. */
  saveDatos: async (changes: DatosChanges, baseRev: { datos?: string; institucion?: string }) => {
    try {
      return await json<DatosResponse>('/api/memoria/datos', jsonBody('PUT', { ...changes, baseRev }));
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { current?: DatosResponse } | null) : null;
      if (e instanceof ApiError && e.status === 409 && b?.current) throw new DatosConflictError(b.current, e.body);
      throw e;
    }
  },

  uploadLogo: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return json<DatosResponse>('/api/memoria/logo', { method: 'POST', body: fd });
  },

  deleteLogo: () => json<DatosResponse>('/api/memoria/logo', { method: 'DELETE' }),

  /** null si el servidor aún no ofrece perfiles (404). */
  perfiles: async (): Promise<Perfil[] | null> => {
    try {
      return (await json<{ perfiles: Perfil[] }>('/api/templates/perfiles')).perfiles;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
      throw e;
    }
  },

  // ---- Actualizar plantilla (v0.6) ----

  /** null si el servidor aún no lo ofrece (404). */
  plantilla: async (perfil?: string): Promise<PlantillaPreview | null> => {
    try {
      return await json<PlantillaPreview>(`/api/memoria/plantilla?${qs({ perfil })}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  /** Lanza PlantillaConflictError (409 con la vista previa actual) o ApiError. */
  actualizarPlantilla: async (perfil: string, cambios: CambioPlantilla[]) => {
    try {
      return await json<PlantillaResultado>('/api/memoria/plantilla/actualizar', jsonBody('POST', { perfil, cambios }));
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { actual?: PlantillaPreview } | null) : null;
      if (e instanceof ApiError && e.status === 409 && b?.actual) throw new PlantillaConflictError(e.message, b.actual, e.body);
      throw e;
    }
  },

  deshacerPlantilla: (id: string) =>
    json<{ restaurados: string[]; commit: string | null }>('/api/memoria/plantilla/deshacer', jsonBody('POST', { id })),

  logUrl: (buildId: string) => `/api/compile/log/${encodeURIComponent(buildId)}`,

  // ---- SyncTeX (v0.4) ----

  synctexForward: (file: string, line: number, build?: string) =>
    json<SynctexForward>(`/api/synctex/forward?${qs({ file, line: String(line), build })}`),
  synctexInverse: (page: number, x: number, y: number, build?: string) =>
    json<SynctexInverse>(`/api/synctex/inverse?${qs({ page: String(page), x: x.toFixed(2), y: y.toFixed(2), build })}`),
  synctexOutline: (build?: string) => json<SynctexOutline>(`/api/synctex/outline?${qs({ build })}`),

  // ---- Ajustes (v0.2) ----

  settings: () => json<SettingsResponse>('/api/settings'),

  /** Lanza FieldError (400 con `field`) o ApiError 403 con mensaje claro. */
  saveSettings: (values: Partial<SettingsValues>) => guarded(json<SettingsResponse>('/api/settings', jsonBody('PUT', values))),

  resetSettings: (keys: SettingsKey[]) =>
    guarded(json<Partial<SettingsResponse>>('/api/settings/reset', jsonBody('POST', { keys }))),

  /** Sin `path` lista las raíces permitidas. */
  fsDirs: (path?: string) => guarded(json<FsDirsResponse>(`/api/fs/dirs?${qs({ path: path || undefined })}`)),

  /** 409 si la carpeta existe y no está vacía. */
  initMemoria: async (dir: string, perfil?: string) => {
    try {
      return await guarded(json<Partial<SettingsResponse>>('/api/settings/init-memoria', jsonBody('POST', perfil ? { dir, perfil } : { dir })));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && !(e instanceof ConflictError)) {
        throw new ApiError(409, e.message && e.message !== 'HTTP 409' ? e.message : 'La carpeta no está vacía', e.body);
      }
      throw e;
    }
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'Sin conexión con el servidor';
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

// ---- Diagramas (v0.8) ----

export type EstadoDiagrama = 'sin-exportar' | 'exportado' | 'desactualizado';

export interface DiagramaEstado {
  estado: EstadoDiagrama;
  pdf: string | null;
  svg: string | null;
  exportadoEn: string | null;
}

/** Elemento de GET /api/diagramas/estado sin `path`. */
export interface DiagramaItem extends DiagramaEstado {
  path: string;
  /** `diagramas/<nombre>` (lo que va en \includegraphics). */
  nombre: string;
  usos: { file: string; line: number }[];
}

export const diagramasApi = {
  estado: (path: string) => json<DiagramaEstado>(`/api/diagramas/estado?${qs({ path })}`),
  lista: () => json<{ items: DiagramaItem[] }>('/api/diagramas/estado'),
  /** ApiError 409 si la fuente cambió desde `rev` (body.rev = la actual). */
  exportar: (path: string, svg: string, rev: string) =>
    json<{ pdf: string; svg: string; exportadoEn: string }>('/api/diagramas/exportar', jsonBody('POST', { path, svg, rev })),
};
