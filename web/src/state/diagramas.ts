// Diagramas de la memoria (v0.8): estado de las figuras exportadas, crear, exportar e
// insertar la figura en la memoria. El dibujo (Mermaid + fuente) vive en lib/diagram.ts,
// que se carga en diferido.

import { useMemo } from 'react';
import { create } from 'zustand';
import { ApiError, ConflictError, api, diagramasApi, errorMessage, type DiagramaItem, type OutlineItem, type OutlineResponse } from '../api';
import { basename, docKey, stripExt } from '../lib/paths';
import { editContent, ensureDoc, requestReveal, saveDoc, useDocs, isDirty } from './docs';
import { useCursor } from './cursor';
import { onFileChange } from './events';
import { applyMoved, deleteEntry, expandPath, moveEntry } from './files';
import { refreshOutlineSoon, useOutline, walkOutline } from './outline';
import { confirmDialog, toast, useUI } from './ui';
import { getDock, openFile, panelIdFor } from './workspace';
import { saveAndCompile } from '../panels/LatexPanel';

export const DIAGRAMAS_DIR = 'diagramas';

// ---- Estado de las figuras ----

interface DiagramasState {
  items: DiagramaItem[] | null;
  error: string | null;
  refresh: () => Promise<void>;
}

let seq = 0;
export const useDiagramas = create<DiagramasState>((set) => ({
  items: null,
  error: null,
  refresh: async () => {
    const mine = ++seq;
    try {
      const r = await diagramasApi.lista();
      if (mine === seq) set({ items: r.items, error: null });
    } catch (e) {
      // 404 = servidor sin diagramas; 409 = sin configurar: sin marcas, sin ruido.
      if (mine === seq) set({ items: e instanceof ApiError && (e.status === 404 || e.status === 409) ? [] : null, error: errorMessage(e) });
    }
  },
}));

let timer: ReturnType<typeof setTimeout> | null = null;
export function refreshDiagramasSoon(delay = 400) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void useDiagramas.getState().refresh();
  }, delay);
}

// Cambios en disco que afectan al estado: fuentes, figuras exportadas y .tex que las incluyen.
onFileChange((ev) => {
  if (ev.root !== 'memoria') return;
  if (/\.(mmd|tex)$/i.test(ev.path) || ev.path.startsWith('figuras/diagramas/') || ev.kind === 'move') refreshDiagramasSoon();
});

export function useDiagramaItem(path: string): DiagramaItem | null {
  return useDiagramas((s) => s.items?.find((i) => i.path === path) ?? null);
}

/** `diagramas/a/b.mmd` → `a/b` (null si no está en diagramas/). */
export function diagramName(path: string): string | null {
  if (!path.startsWith(DIAGRAMAS_DIR + '/') || !/\.mmd$/i.test(path)) return null;
  return path.slice(DIAGRAMAS_DIR.length + 1).replace(/\.mmd$/i, '');
}

/** Nombre válido para LaTeX y para el sistema de archivos: sin tildes, espacios ni símbolos. */
export function sanitizeDiagramName(raw: string): string {
  return raw
    .trim()
    .replace(/\.mmd$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split('/')
    .map((s) =>
      s
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^A-Za-z0-9_-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, ''),
    )
    .filter(Boolean)
    .join('/');
}

// ---- Vista Documento: apartados con figuras desactualizadas ----

/** id del apartado → nombres de los diagramas desactualizados que incluye (él o sus hijos). */
export function staleOutlineMap(outline: OutlineResponse | null, items: DiagramaItem[] | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!outline || !items?.length) return out;
  const stale = items.filter((i) => i.estado === 'desactualizado' && i.usos.length);
  if (!stale.length) return out;
  const flat: { it: OutlineItem; parent: OutlineItem | null }[] = [];
  const parents = new Map<string, OutlineItem | null>();
  walkOutline(outline.items, (it, _d, parent) => {
    flat.push({ it, parent });
    parents.set(it.id, parent);
  });
  for (const d of stale) {
    const name = d.nombre.slice(DIAGRAMAS_DIR.length + 1);
    for (const u of d.usos) {
      // El apartado más interno del mismo archivo que empieza antes del \includegraphics.
      let owner: OutlineItem | null = null;
      for (const { it } of flat) if (it.file === u.file && it.line <= u.line && (!owner || it.line >= owner.line)) owner = it;
      for (let p: OutlineItem | null = owner; p; p = parents.get(p.id) ?? null) {
        const list = out.get(p.id) ?? [];
        if (!list.includes(name)) list.push(name);
        out.set(p.id, list);
      }
    }
  }
  return out;
}

export function useStaleFigures(id: string | undefined): string[] | null {
  const outline = useOutline((s) => s.data);
  const items = useDiagramas((s) => s.items);
  const map = useMemo(() => staleOutlineMap(outline, items), [outline, items]);
  return id ? (map.get(id) ?? null) : null;
}

// ---- Crear ----

interface NewDiagramRequest {
  /** Carpeta dentro de diagramas/ donde crearlo ('' = diagramas/). */
  dir: string;
  /** Fuente ya decidida (copiada de una nota): solo se pide el nombre. */
  source?: string;
  /** Nombre sugerido. */
  name?: string;
}

export const useNewDiagram = create<{ req: NewDiagramRequest | null }>(() => ({ req: null }));

/** Abre «Nuevo diagrama». `dir`: carpeta del árbol en la que se pidió (se usa si está en diagramas/). */
export function openNewDiagram(dir = '', source?: string) {
  const inside = dir === DIAGRAMAS_DIR || dir.startsWith(DIAGRAMAS_DIR + '/') ? dir.slice(DIAGRAMAS_DIR.length + 1) : '';
  useNewDiagram.setState({ req: { dir: inside, source } });
}

export async function createDiagram(name: string, source: string): Promise<string | null> {
  const clean = sanitizeDiagramName(name);
  if (!clean) {
    toast({ kind: 'error', text: 'El nombre del diagrama no es válido' });
    return null;
  }
  const path = `${DIAGRAMAS_DIR}/${clean}.mmd`;
  try {
    await api.createFile('memoria', path, source.endsWith('\n') ? source : source + '\n');
  } catch (e) {
    toast({ kind: 'error', text: e instanceof ApiError && e.status === 409 ? `Ya existe «${path}»` : `No se pudo crear «${path}»: ${errorMessage(e)}` });
    return null;
  }
  expandPath('memoria', path.slice(0, path.lastIndexOf('/')), true);
  await useUI.getState().refreshTree('memoria');
  refreshDiagramasSoon(0);
  openFile('memoria', path);
  return path;
}

// ---- Exportar ----

/** Guarda la fuente si hace falta, la dibuja con el aspecto de impresión y la exporta (PDF + SVG). */
export async function exportDiagram(path: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const name = diagramName(path);
  if (!name) {
    toast({ kind: 'error', text: 'Solo se pueden exportar los diagramas de la carpeta diagramas/' });
    return false;
  }
  const key = docKey('memoria', path);
  await ensureDoc('memoria', path);
  let d = useDocs.getState().docs[key];
  if (!d || d.status !== 'ready') {
    toast({ kind: 'error', text: `No se pudo leer «${path}»` });
    return false;
  }
  if (d.conflict) {
    toast({ kind: 'error', text: `«${path}» tiene un conflicto sin resolver` });
    return false;
  }
  if (isDirty(d) && !(await saveDoc(key))) return false;
  d = useDocs.getState().docs[key]!;
  const { renderDiagram } = await import('../lib/diagram');
  const r = await renderDiagram(d.savedContent, name, `diagrama-${name.replace(/[^A-Za-z0-9_-]/g, '-')}`);
  if (!r.ok) {
    toast({ kind: 'error', text: `No se puede exportar: ${r.message.split('\n')[0]}${r.line ? ` (línea ${r.line})` : ''}` });
    return false;
  }
  try {
    const out = await diagramasApi.exportar(path, r.svg, d.rev);
    await useDiagramas.getState().refresh();
    useUI.getState().refreshTree('memoria');
    if (!opts.quiet) toast({ kind: 'ok', text: `Exportado a ${out.pdf}` });
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) toast({ kind: 'warn', text: `«${path}» cambió en disco mientras se exportaba: revisa y vuelve a exportar.` });
    else toast({ kind: 'error', text: `No se pudo exportar «${basename(path)}»: ${errorMessage(e)}` });
    return false;
  }
}

// ---- Insertar en la memoria ----

export function figureBlock(nombre: string, caption: string, label: string, widthPct: number): string {
  const w = Math.min(100, Math.max(5, Math.round(widthPct)));
  const width = w === 100 ? '\\textwidth' : `${w / 100}\\textwidth`;
  return [
    '\\begin{figure}[htbp]',
    '  \\centering',
    `  \\includegraphics[width=${width}]{${nombre}}`,
    `  \\caption{${caption}}`,
    `  \\label{${label}}`,
    '\\end{figure}',
  ].join('\n');
}

// Medidas de la plantilla (A4, márgenes 30 + 25 mm): \textwidth ≈ 440 pt, \textheight ≈ 650 pt.
const TEXTWIDTH_PT = 440;
const MAX_FIG_HEIGHT_PT = 330;

/**
 * Ancho sugerido (% del texto) para un SVG de `w`×`h` px (rsvg: 1 px = 0,75 pt): como mucho
 * 80 %, sin ampliar el texto por encima de su tamaño natural y sin pasar de media página de alto.
 */
export function suggestWidth(w: number, h: number): number {
  if (!(w > 0 && h > 0)) return 80;
  const wPt = w * 0.75;
  const hPt = h * 0.75;
  const natural = (wPt / TEXTWIDTH_PT) * 100;
  const byHeight = ((MAX_FIG_HEIGHT_PT * wPt) / hPt / TEXTWIDTH_PT) * 100;
  const pct = Math.min(80, natural, byHeight);
  return Math.min(100, Math.max(30, Math.round(pct / 5) * 5));
}

/** Inserta `block` tras la línea `after` (1-based; 0 = al principio) con una línea en blanco alrededor. */
export function insertAfterLine(content: string, after: number, block: string): { content: string; line: number } {
  const lines = content.split('\n');
  const at = Math.min(Math.max(after, 0), lines.length);
  const before = lines.slice(0, at);
  const rest = lines.slice(at);
  const pre = before.length && before[before.length - 1].trim() !== '' ? [''] : [];
  const post = rest.length && rest[0].trim() !== '' ? [''] : [];
  return { content: [...before, ...pre, ...block.split('\n'), ...post, ...rest].join('\n'), line: at + pre.length + 1 };
}

/**
 * Última línea del apartado `item` dentro de su archivo: antes del siguiente apartado que no es
 * hijo suyo si está en el mismo archivo; si no, al final del archivo (antes de \end{document}).
 * Se retrocede sobre las líneas en blanco.
 */
export function sectionEndLine(outline: OutlineResponse, item: OutlineItem, content: string): number {
  const lines = content.split('\n');
  const flat: { it: OutlineItem; depth: number }[] = [];
  walkOutline(outline.items, (it, depth) => flat.push({ it, depth }));
  const i = flat.findIndex((f) => f.it.id === item.id);
  let end = lines.length;
  if (i >= 0) {
    const next = flat.slice(i + 1).find((f) => f.depth <= flat[i].depth);
    if (next && next.it.file === item.file && next.it.line > item.line) end = next.it.line - 1;
  }
  if (end === lines.length) {
    const doc = lines.findIndex((l, n) => n >= item.line && /^\s*\\end\{document\}/.test(l));
    if (doc >= 0) end = doc;
  }
  while (end > item.line && !lines[end - 1]?.trim()) end--;
  return Math.max(end, 0);
}

export interface InsertRequest {
  path: string;
  target: OutlineItem;
  caption: string;
  label: string;
  width: number;
}

/** ¿Está ese archivo abierto en un editor? (entonces se inserta en el cursor, sin guardar) */
export function openInEditor(file: string): boolean {
  const doc = useDocs.getState().docs[docKey('memoria', file)];
  return !!doc && doc.status === 'ready' && !!getDock()?.getPanel(panelIdFor('latex', file));
}

export async function insertFigure(req: InsertRequest): Promise<boolean> {
  const name = diagramName(req.path);
  if (!name) return false;
  const nombre = `${DIAGRAMAS_DIR}/${name}`;
  // Exportar si hace falta (sin exportar, desactualizada o con cambios sin guardar).
  const item = useDiagramas.getState().items?.find((i) => i.path === req.path);
  const doc = useDocs.getState().docs[docKey('memoria', req.path)];
  if (!item || item.estado !== 'exportado' || isDirty(doc)) {
    if (!(await exportDiagram(req.path, { quiet: true }))) return false;
  }
  const outline = useOutline.getState().data;
  const file = req.target.file;
  const block = figureBlock(nombre, req.caption.trim(), req.label.trim(), req.width);
  const key = docKey('memoria', file);
  let where: string;
  if (openInEditor(file)) {
    const d = useDocs.getState().docs[key]!;
    const cursor = useCursor.getState().lines[key];
    const after = cursor ?? (outline ? sectionEndLine(outline, req.target, d.content) : d.content.split('\n').length);
    const r = insertAfterLine(d.content, after, block);
    editContent(key, r.content);
    openFile('memoria', file, { line: r.line });
    requestReveal(key, r.line);
    where = `${file}:${r.line} (sin guardar)`;
  } else {
    try {
      const f = await api.readFile('memoria', file);
      const after = outline ? sectionEndLine(outline, req.target, f.content) : f.content.split('\n').length;
      const r = insertAfterLine(f.content, after, block);
      await api.saveFile('memoria', file, r.content, f.rev);
      refreshOutlineSoon(500);
      where = `${file}:${r.line}`;
    } catch (e) {
      toast({
        kind: 'error',
        text: e instanceof ConflictError ? `«${file}» cambió mientras se insertaba: vuelve a intentarlo.` : `No se pudo insertar en «${file}»: ${errorMessage(e)}`,
      });
      return false;
    }
  }
  refreshDiagramasSoon();
  toast({
    kind: 'ok',
    text: `Figura «${req.label}» insertada en ${where}`,
    timeout: 10000,
    action: {
      label: 'Compilar',
      run: () => void saveAndCompile(),
    },
  });
  return true;
}

export const useInsertFigure = create<{ path: string | null }>(() => ({ path: null }));
export const openInsertFigure = (path: string) => useInsertFigure.setState({ path });

// ---- Desde las notas ----

/** «Usar en la memoria» en un bloque ```mermaid: copia el bloque a diagramas/<nombre>.mmd. */
export function copyFromNote(code: string, notePath?: string) {
  const suggested = notePath ? sanitizeDiagramName(stripExt(basename(notePath))) : '';
  useNewDiagram.setState({ req: { dir: '', source: code, name: suggested } });
}

// ---- Renombrar y eliminar (sección Diagramas) ----

/** Figuras exportadas que acompañan a un diagrama (`figuras/diagramas/<nombre>.{pdf,svg}`). */
function figurePaths(item: DiagramaItem): string[] {
  return [item.pdf, item.svg].filter((p): p is string => Boolean(p));
}

/**
 * Renombra la fuente y sus figuras exportadas a la vez; mover con `updateLinks` reescribe
 * los `\includegraphics{diagramas/<nombre>}` de la memoria.
 */
export async function renameDiagram(item: DiagramaItem): Promise<boolean> {
  const current = diagramName(item.path) ?? stripExt(basename(item.path));
  const raw = await useUI.getState().ask({
    title: 'Renombrar diagrama',
    label: 'Nombre nuevo (sin tildes ni espacios; se pueden usar carpetas: tema/nombre)',
    initial: current,
    okLabel: 'Renombrar',
  });
  if (raw == null) return false;
  const clean = sanitizeDiagramName(raw);
  if (!clean) {
    toast({ kind: 'error', text: 'El nombre del diagrama no es válido' });
    return false;
  }
  if (clean === current) return false;
  const to = `${DIAGRAMAS_DIR}/${clean}.mmd`;
  if (!(await moveEntry('memoria', item.path, to, { rename: true }))) return false;
  // Las figuras siguen a la fuente: mismo nombre en figuras/diagramas/.
  for (const fig of figurePaths(item)) {
    const ext = fig.slice(fig.lastIndexOf('.'));
    try {
      const r = await api.move('memoria', fig, `figuras/${DIAGRAMAS_DIR}/${clean}${ext}`, true);
      applyMoved('memoria', r.moved);
    } catch (e) {
      toast({ kind: 'warn', text: `La fuente se renombró, pero no la figura «${fig}»: ${errorMessage(e)}` });
    }
  }
  await useUI.getState().refreshTree('memoria');
  refreshOutlineSoon(300);
  refreshDiagramasSoon(0);
  return true;
}

/**
 * Lleva el diagrama a la papelera. Si la figura se usa en la memoria se conserva para que
 * la compilación no falle; si no, también va a la papelera.
 */
export async function deleteDiagram(item: DiagramaItem): Promise<boolean> {
  const n = item.usos.length;
  const ok = await confirmDialog({
    title: 'Eliminar diagrama',
    text: n
      ? `«${item.nombre}» se usa en ${n} ${n === 1 ? 'sitio' : 'sitios'} de la memoria. Irá a la papelera la fuente; la figura exportada se conserva para que la memoria siga compilando.`
      : `¿Eliminar «${item.nombre}»? La fuente y su figura exportada irán a la papelera.`,
    okLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return false;
  if (!(await deleteEntry('memoria', item.path, false))) return false;
  if (!n) {
    for (const fig of figurePaths(item)) {
      try {
        await api.deleteFile('memoria', fig);
      } catch {
        /* ya no estaba */
      }
    }
  }
  await useUI.getState().refreshTree('memoria');
  refreshDiagramasSoon(0);
  return true;
}
