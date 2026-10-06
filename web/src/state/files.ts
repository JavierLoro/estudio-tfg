// Operaciones de archivo (contrato v0.7): crear, renombrar, mover y eliminar,
// y lo que hay que ajustar en la interfaz cuando una ruta cambia.

import { create } from 'zustand';
import { api, errorMessage, type Entry, type Root } from '../api';
import { basename, dirname, docKey, ext, join, stripExt } from '../lib/paths';
import { load, save } from '../lib/storage';
import { docsUnder, dropDoc, handleExternalChange, isDirty, rekeyDoc, saveDoc, useDocs } from './docs';
import { refreshOutlineSoon } from './outline';
import { confirmDialog, flattenTree, toast, useUI } from './ui';
import { closePanelsUnder, openFile, rekeyPanels } from './workspace';

// ---- Carpetas desplegadas del árbol (por raíz) ----

const expKey = (root: Root) => `et:tree-expanded:${root}`;

export const useExpanded = create<{ sets: Record<Root, Set<string>> }>(() => ({
  sets: {
    notes: new Set(load<string[]>(expKey('notes'), [])),
    memoria: new Set(load<string[]>(expKey('memoria'), [])),
  },
}));

function setExpanded(root: Root, next: Set<string>) {
  useExpanded.setState({ sets: { ...useExpanded.getState().sets, [root]: next } });
  save(expKey(root), [...next]);
}

export function toggleExpanded(root: Root, path: string) {
  const next = new Set(useExpanded.getState().sets[root]);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  setExpanded(root, next);
}

/** Despliega una carpeta (y, con `ancestors`, las que la contienen). */
export function expandPath(root: Root, path: string, ancestors = false) {
  const cur = useExpanded.getState().sets[root];
  const next = new Set(cur);
  for (let p = path; p; p = dirname(p)) {
    next.add(p);
    if (!ancestors) break;
  }
  if (next.size !== cur.size) setExpanded(root, next);
}

function rekeyExpanded(root: Root, pairs: { from: string; to: string }[]) {
  const cur = useExpanded.getState().sets[root];
  let changed = false;
  const next = new Set<string>();
  for (const p of cur) {
    const pair = pairs.find((x) => p === x.from || p.startsWith(x.from + '/'));
    if (pair) {
      next.add(pair.to + p.slice(pair.from.length));
      changed = true;
    } else next.add(p);
  }
  if (changed) setExpanded(root, next);
}

// ---- Árbol ----

export function findEntry(entries: Entry[] | undefined, path: string): Entry | null {
  for (const e of entries ?? []) {
    if (e.path === path) return e;
    if (e.type === 'dir' && path.startsWith(e.path + '/')) {
      const r = findEntry(e.children, path);
      if (r) return r;
    }
  }
  return null;
}

/** Rutas de todas las carpetas de un árbol. */
export function listDirs(entries: Entry[] | undefined, out: string[] = []): string[] {
  for (const e of entries ?? []) {
    if (e.type === 'dir') {
      out.push(e.path);
      listDirs(e.children, out);
    }
  }
  return out;
}

async function refreshAfter(root: Root) {
  await useUI.getState().refreshTree(root);
  if (root === 'memoria') refreshOutlineSoon(300);
  if (root === 'notes') void useUI.getState().refreshResources();
}

// ---- Re-clasificar lo abierto tras mover ----

/**
 * Pasa a la ruta nueva todo lo que dependía de la antigua: documentos (y su borrador y cursor),
 * pestañas, recientes y carpetas desplegadas. Es idempotente: se llama al terminar `POST /api/move`
 * y al recibir el evento SSE `move` (de este cliente o de otro).
 */
export function applyMoved(root: Root, files: { from: string; to: string }[], dirs: { from: string; to: string }[] = []) {
  if (!files.length && !dirs.length) return;
  for (const f of files) rekeyDoc(root, f.from, f.to);
  rekeyPanels(root, files);
  useUI.getState().renameRecents(root, files);
  rekeyExpanded(root, dirs);
}

/** Evento SSE `move`: otro cliente (o este) ha movido un archivo. */
export function handleMoveEvent(root: Root, from: string, to: string) {
  applyMoved(root, [{ from, to }]);
  if (root === 'memoria') refreshOutlineSoon(1200);
}

/** Recarga lo que el servidor haya reescrito para mantener enlaces (sin avisos si el documento está limpio). */
function reloadDocs(root: Root, paths: string[]) {
  const docs = useDocs.getState().docs;
  for (const p of new Set(paths)) {
    if (docs[docKey(root, p)]) void handleExternalChange({ root, path: p, kind: 'change' });
  }
}

// ---- Mover / renombrar ----

export async function moveEntry(root: Root, from: string, to: string, opts: { rename?: boolean; isDir?: boolean } = {}): Promise<boolean> {
  if (from === to) return false;
  const isDir = opts.isDir ?? findEntry(useUI.getState().trees[root], from)?.type === 'dir';
  // Antes de mover: guardar los documentos afectados con cambios.
  const affected = docsUnder(root, from);
  for (const d of affected) {
    if (d.conflict) {
      toast({ kind: 'error', text: `«${d.path}» tiene un conflicto sin resolver: resuélvelo antes de moverlo.` });
      return false;
    }
    if (isDirty(d) && !(await saveDoc(d.key))) {
      toast({ kind: 'error', text: `No se pudo guardar «${d.path}»: no se ha movido nada.` });
      return false;
    }
  }
  try {
    const r = await api.move(root, from, to, true);
    applyMoved(root, r.moved, isDir ? [{ from, to: r.path }] : []);
    // Archivos reescritos (enlaces) y movidos con enlaces relativos recalculados.
    reloadDocs(root, [...r.updated.map((u) => u.path), ...r.moved.map((m) => m.to)]);
    // Si la carpeta de destino es nueva, se despliega para que se vea lo movido.
    if (dirname(r.path)) expandPath(root, dirname(r.path), true);
    await refreshAfter(root);
    const n = r.updated.length;
    const links = n ? ` · ${n} ${n === 1 ? 'archivo' : 'archivos'} con enlaces actualizados` : '';
    toast({ kind: 'ok', text: opts.rename ? `Renombrada a ${basename(r.path)}${links}` : `Movida a ${r.path}${links}` });
    if (r.failed?.length) {
      toast({ kind: 'warn', text: `No se pudieron actualizar los enlaces de ${r.failed.map((f) => f.path).join(', ')}.` });
    }
    return true;
  } catch (e) {
    toast({ kind: 'error', text: `No se pudo ${opts.rename ? 'renombrar' : 'mover'} «${from}»: ${errorMessage(e)}` });
    return false;
  }
}

/** Mueve a la carpeta `dir` ('' = raíz) conservando el nombre. */
export const moveInto = (root: Root, from: string, dir: string) => moveEntry(root, from, join(dir, basename(from)));

/** ¿Se puede soltar `from` en la carpeta `dir`? (no en sí misma, sus descendientes ni donde ya está) */
export function canMoveInto(from: string, dir: string): boolean {
  if (dirname(from) === dir) return false;
  if (dir === from || dir.startsWith(from + '/')) return false;
  return true;
}

// ---- Eliminar (a la papelera) ----

export async function deleteEntry(root: Root, path: string, isDir?: boolean): Promise<boolean> {
  const entry = findEntry(useUI.getState().trees[root], path);
  const dir = isDir ?? entry?.type === 'dir';
  const affected = docsUnder(root, path);
  const unsaved = affected.filter((d) => isDirty(d) || d.conflict);
  const lost = unsaved.length
    ? dir
      ? ` ${unsaved.length === 1 ? 'Un archivo abierto tiene' : `${unsaved.length} archivos abiertos tienen`} cambios sin guardar que se perderán.`
      : ' Tiene cambios sin guardar que se perderán.'
    : '';
  if (dir) {
    const n = flattenTree(entry?.children).length;
    const ok = await confirmDialog({
      title: 'Eliminar carpeta',
      text: `¿Eliminar la carpeta «${path}» con ${n} ${n === 1 ? 'archivo' : 'archivos'}? Irá a la papelera.${lost}`,
      okLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return false;
  } else if (unsaved.length) {
    const ok = await confirmDialog({
      title: 'Eliminar archivo',
      text: `«${path}» tiene cambios sin guardar que se perderán al eliminarlo.`,
      okLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return false;
  }
  try {
    const r = await api.deleteFile(root, path);
    for (const d of affected) dropDoc(root, d.path);
    closePanelsUnder(root, path);
    for (const d of affected) useUI.getState().dropRecent(root, d.path);
    await refreshAfter(root);
    toast({
      kind: 'info',
      text: `«${basename(path)}» movida a la papelera`,
      timeout: 8000,
      action: {
        label: 'Deshacer',
        run: async () => {
          try {
            await api.restoreTrash(root, path, r.trashPath);
            await refreshAfter(root);
            toast({ kind: 'ok', text: `Restaurada «${path}»` });
          } catch (e) {
            toast({ kind: 'error', text: `No se pudo restaurar «${path}»: ${errorMessage(e)}` });
          }
        },
      },
    });
    return true;
  } catch (e) {
    toast({ kind: 'error', text: `No se pudo eliminar «${path}»: ${errorMessage(e)}` });
    return false;
  }
}

// ---- Crear ----

const noteContent = (path: string) => `# ${stripExt(basename(path))}\n\n`;

/** Crea una nota (la ruta puede traer carpetas; se añade `.md`) y la abre en modo edición. */
export async function createNoteAt(rel: string): Promise<string | null> {
  let path = rel.trim().replace(/^\/+/, '');
  if (!path) return null;
  if (!/\.md$/i.test(path)) path += '.md';
  try {
    await api.createFile('notes', path, noteContent(path));
    expandPath('notes', dirname(path), true);
    await refreshAfter('notes');
    openFile('notes', path, { mode: 'edit' });
    return path;
  } catch (e) {
    toast({ kind: 'error', text: `No se pudo crear «${path}»: ${errorMessage(e)}` });
    return null;
  }
}

export async function createFileIn(root: Root, dir: string) {
  const ui = useUI.getState();
  const isNotes = root === 'notes';
  const name = await ui.ask({
    title: isNotes ? 'Nueva nota' : 'Nuevo archivo de la memoria',
    label: dir ? `En «${dir}/»` : 'En la raíz',
    placeholder: isNotes ? 'Nombre de la nota' : 'capitulo.tex',
    okLabel: 'Crear',
  });
  if (!name?.trim()) return;
  if (isNotes) {
    await createNoteAt(join(dir, name.trim()));
    return;
  }
  let rel = name.trim();
  if (!ext(rel)) rel += '.tex';
  const path = join(dir, rel);
  const content = ext(path) === 'tex' ? `% ${basename(path)}\n\n` : '';
  try {
    await api.createFile(root, path, content);
    expandPath(root, dirname(path), true);
    await refreshAfter(root);
    openFile(root, path);
  } catch (e) {
    toast({ kind: 'error', text: `No se pudo crear «${path}»: ${errorMessage(e)}` });
  }
}

/** Crea una carpeta en `dir`; devuelve su ruta (o null si se cancela o falla). */
export async function createFolderIn(root: Root, dir: string): Promise<string | null> {
  const name = await useUI.getState().ask({
    title: 'Nueva carpeta',
    label: dir ? `En «${dir}/»` : 'En la raíz',
    placeholder: 'Nombre de la carpeta',
    okLabel: 'Crear',
  });
  if (!name?.trim()) return null;
  const path = join(dir, name.trim());
  try {
    await api.createDir(root, path);
    expandPath(root, path, true);
    await refreshAfter(root);
    return path;
  } catch (e) {
    toast({ kind: 'error', text: `No se pudo crear la carpeta «${path}»: ${errorMessage(e)}` });
    return null;
  }
}
