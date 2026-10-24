export const MAX_SCENE_BYTES = 10 * 1024 * 1024;
export interface ExcalidrawScene {
  type: 'excalidraw';
  version: 2;
  source?: string;
  elements: Record<string, any>[];
  appState: Record<string, any>;
  files: Record<string, any>;
}

/** Validación compartida: conservar los campos nativos sin ejecutar contenido incrustado. */
export function parseExcalidraw(content: string): ExcalidrawScene {
  if (new TextEncoder().encode(content).byteLength > MAX_SCENE_BYTES) throw new Error('El dibujo supera 10 MiB; reduce las imágenes antes de guardarlo');
  let scene: any;
  try { scene = JSON.parse(content); } catch { throw new Error('El archivo no contiene un dibujo Excalidraw válido'); }
  const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
  if (!object(scene) || scene.type !== 'excalidraw' || scene.version !== 2 || !Array.isArray(scene.elements)
    || !object(scene.appState) || !object(scene.files)) throw new Error('Formato Excalidraw no compatible; conserva el archivo original');
  const ids = new Set<string>();
  for (const e of scene.elements) {
    if (!object(e) || typeof e.id !== 'string' || !e.id || ids.has(e.id) || typeof e.type !== 'string'
      || !['rectangle', 'diamond', 'ellipse', 'text', 'line', 'arrow', 'freedraw', 'image', 'frame', 'magicframe', 'embeddable', 'iframe'].includes(e.type)
      || ['x', 'y', 'width', 'height', 'angle', 'opacity'].some(k => !Number.isFinite(e[k]))
      || ((!['line', 'arrow', 'freedraw'].includes(e.type)) && (e.width < 0 || e.height < 0)) || (e.type === 'text' && typeof e.text !== 'string')) throw new Error('El dibujo contiene un elemento no válido');
    if (['embeddable', 'iframe', 'magicframe'].includes(e.type)) throw new Error('Los dibujos con contenido web incrustado no están admitidos');
    if ((e.groupIds !== undefined && (!Array.isArray(e.groupIds) || e.groupIds.some((id: any) => typeof id !== 'string')))
      || (e.boundElements != null && (!Array.isArray(e.boundElements) || e.boundElements.some((b: any) => !object(b) || typeof b.id !== 'string' || !['text', 'arrow'].includes(b.type))))
      || ['frameId', 'containerId'].some(k => e[k] != null && typeof e[k] !== 'string')) throw new Error('El dibujo contiene agrupaciones o vínculos dañados');
    if (['line', 'arrow', 'freedraw'].includes(e.type) && (!Array.isArray(e.points) || e.points.some((p: any) => !Array.isArray(p) || p.length !== 2 || p.some((v: any) => !Number.isFinite(v))))) throw new Error('El dibujo contiene un trazo no válido');
    if (e.type === 'text' && (!Number.isFinite(e.fontSize) || e.fontSize <= 0 || !Number.isFinite(e.fontFamily))) throw new Error('El dibujo contiene un texto no válido');
    if (e.link != null && (typeof e.link !== 'string' || !/^https?:\/\//i.test(e.link))) throw new Error('El dibujo contiene un enlace no compatible');
    ids.add(e.id);
  }
  for (const [id, file] of Object.entries<any>(scene.files)) {
    if (!object(file) || file.id !== id || typeof file.dataURL !== 'string'
      || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(file.dataURL))
      throw new Error('Las imágenes deben estar incrustadas como PNG, JPG, WebP o GIF; convierte los SVG antes de incorporarlos');
  }
  for (const e of scene.elements) if (e.type === 'image' && !e.isDeleted && (!e.fileId || !scene.files[e.fileId])) throw new Error('Falta una imagen del dibujo; conserva el original');
  return scene;
}

/** La revisión interna y el orden de las propiedades no son cambios del dibujo. */
export function sceneFingerprint(scene: ExcalidrawScene): string {
  const elements = scene.elements.map(({ version: _version, versionNonce: _nonce, updated: _updated, index: _index, ...element }) => element);
  const files = Object.fromEntries(Object.entries(scene.files).map(([id, { lastRetrieved: _retrieved, ...file }]) => [id, file]));
  return JSON.stringify({ elements, files, background: scene.appState.viewBackgroundColor }, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}
