import { useEffect, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import { create } from 'zustand';
import { api, errorMessage, type ImportedFile, type Root } from '../api';
import { editorViews, insertAtCursor } from '../lib/editorInsert';
import { canInsertFile, hasDroppedFiles, importedFileText } from '../lib/fileImport';
import { dirname, docKey, ext, parseDocKey } from '../lib/paths';
import { useDocs } from '../state/docs';
import { expandPath, listDirs } from '../state/files';
import { toast, useUI } from '../state/ui';
import { activeFile } from '../state/workspace';
import { Banner, Button, Modal, Spinner } from './ui';

interface ImportLocation {
  root?: Root;
  directory?: string;
  editorKey?: string;
  position?: number;
}
interface ImportTarget {
  id: string;
  files: File[];
  instanceId: string;
  libraryId?: string;
  destination: Root | 'library';
  directory: string;
  editor?: { key: string; view: EditorView; doc: Text; at: number; root: Root; path: string };
  insert: boolean;
}
const useFileImport = create<{ target: ImportTarget | null }>(() => ({ target: null }));
const close = () => useFileImport.setState({ target: null });

export function openFileImport(files: File[], location: ImportLocation = {}) {
  if (!files.length) return;
  const status = useUI.getState().status;
  if (!status?.instanceId) { toast({ kind: 'error', text: 'Conecta con el servidor antes de importar archivos.' }); return; }
  if (files.length > 20 || files.some(f => f.size > 50 * 1024 * 1024) || files.reduce((n, f) => n + f.size, 0) > 200 * 1024 * 1024) {
    toast({ kind: 'error', text: 'Máximo 20 archivos, 50 MB por archivo y 200 MB por lote.' }); return;
  }
  const active = activeFile(), key = location.editorKey ?? (!location.root && active ? docKey(active.root, active.path) : undefined);
  const view = key ? editorViews.get(key) : undefined, file = key ? parseDocKey(key) : undefined;
  const editor = key && view && file && ['tex', 'md'].includes(ext(file.path))
    ? { key, view, doc: view.state.doc, at: ext(file.path) === 'tex' ? view.state.doc.lineAt(location.position ?? view.state.selection.main.head).to : location.position ?? view.state.selection.main.head, ...file }
    : undefined;
  const section = useUI.getState().section;
  const destination = location.root ?? editor?.root ?? (section === 'memoria' || section === 'notes' ? section : 'library');
  const directory = location.directory ?? (editor?.root === destination
    ? destination === 'memoria' ? 'figuras' : [dirname(editor.path), 'adjuntos'].filter(Boolean).join('/') : '');
  useFileImport.setState({ target: { id: crypto.randomUUID(), files, instanceId: status.instanceId, libraryId: status.libraryId, destination, directory, editor, insert: !!location.editorKey } });
}

export function openDroppedFiles(transfer: DataTransfer | null, location: ImportLocation = {}) {
  if (!transfer) return;
  if (Array.from(transfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
    toast({ kind: 'error', text: 'Selecciona los archivos de la carpeta; no se importan carpetas completas.' }); return;
  }
  openFileImport(Array.from(transfer.files), location);
}

export function FileImportDialog() {
  const target = useFileImport(s => s.target);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!hasDroppedFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDrag(!(event.target as Element)?.closest?.('dialog'));
    };
    const off = () => setDrag(false);
    const leave = (event: DragEvent) => { if (!event.relatedTarget) off(); };
    const drop = (event: DragEvent) => {
      if (!hasDroppedFiles(event.dataTransfer)) return;
      const handled = event.defaultPrevented;
      event.preventDefault();
      if (!handled && !(event.target as Element)?.closest?.('dialog')) openDroppedFiles(event.dataTransfer);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragend', off);
    window.addEventListener('drop', off, true);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragend', off);
      window.removeEventListener('drop', off, true);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return <>
    {drag && <div className="pointer-events-none fixed inset-3 z-[950] flex items-end justify-center rounded-xl border-2 border-accent p-6"><p role="status" className="rounded-lg border border-line bg-bg px-5 py-3 text-[14px] shadow-pop">Suelta para elegir dónde guardar. En el editor, también puedes insertar.</p></div>}
    {target && <ImportFiles key={target.id} target={target} />}
  </>;
}

function ImportFiles({ target }: { target: ImportTarget }) {
  const trees = useUI(s => s.trees);
  const [destination, setDestination] = useState(target.destination), [directory, setDirectory] = useState(target.directory);
  const [insert, setInsert] = useState(target.insert), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [results, setResults] = useState<(ImportedFile | null)[]>(target.files.map(() => null));
  const [errors, setErrors] = useState<string[]>(target.files.map(() => ''));
  const editor = target.editor;
  const insertable = !!editor && destination === editor.root && target.files.some(f => canInsertFile(editor.path, f.name));
  const wantsInsert = insert && insertable;
  const saved = results.filter(Boolean).length, allSaved = saved === target.files.length, locked = busy || saved > 0;
  const input = 'w-full rounded border border-line-strong bg-bg px-2 py-1.5 text-[13px]';
  useEffect(() => {
    if (destination !== 'library') void useUI.getState().refreshTree(destination);
  }, [destination]);
  const checkEditor = () => {
    const current = editor && useDocs.getState().docs[editor.key];
    if (!editor || !current || current.status !== 'ready' || current.deleted || current.conflict || editorViews.get(editor.key) !== editor.view || !editor.view.state.doc.eq(editor.doc) || current.content !== editor.view.state.sliceDoc())
      throw new Error('El editor cambió. Los archivos guardados se conservan; desmarca Insertar y vuelve a soltarlos sobre el texto actualizado.');
  };
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const status = await api.status();
      if (status.instanceId !== target.instanceId) throw new Error('Vuelve al proyecto original antes de importar estos archivos.');
      if (destination === 'library') {
        if (!target.libraryId || status.libraryId !== target.libraryId) throw new Error('La Biblioteca cambió; vuelve al destino original antes de continuar.');
        useUI.setState({ captureFiles: target.files, captureOpen: true }); close(); return;
      }
      if (wantsInsert) {
        checkEditor();
        if (ext(editor!.path) === 'tex' && /[{}%\\^\r\n]/.test(directory))
          throw new Error('Elige una carpeta sin llaves, %, ^ ni barras invertidas para insertar figuras.');
      }
      const next = [...results], failures = target.files.map(() => '');
      for (const [i, file] of target.files.entries()) {
        if (next[i]) continue;
        try { next[i] = await api.importFile(destination, directory.trim(), target.instanceId, file); }
        catch (e) { failures[i] = errorMessage(e); }
        setResults([...next]); setErrors([...failures]);
      }
      await useUI.getState().refreshTree(destination);
      if (next.some(r => !r)) return;
      if (wantsInsert) {
        if ((await api.status()).instanceId !== target.instanceId) throw new Error('El proyecto cambió. Las copias se conservan en su destino original; vuelve a él para insertar.');
        checkEditor();
        const text = next.map((r, i) => importedFileText(editor!.path, r!.path, `${target.id}-${i}`)).filter(Boolean).join('\n\n');
        if (!insertAtCursor(editor!.key, `\n\n${text}\n\n`, editor!.at)) throw new Error('Abre de nuevo el editor para insertar; los archivos ya están guardados.');
      }
      expandPath(destination, directory.trim(), true);
      toast({ kind: 'ok', text: `${next.length} archivo${next.length === 1 ? '' : 's'} guardado${next.length === 1 ? '' : 's'}.${wantsInsert ? ' Inserción añadida al borrador.' : ''}` });
      close();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <Modal open title="Importar archivos" width={620} onClose={() => !busy && close()} footer={<>
    <Button disabled={busy} onClick={close}>Cancelar</Button>
    <Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy && <Spinner size={12} />}{destination === 'library' ? 'Continuar en Biblioteca' : allSaved ? wantsInsert ? 'Insertar en el editor' : 'Listo' : saved ? 'Reintentar fallidos' : wantsInsert ? 'Guardar e insertar' : 'Guardar archivos'}</Button>
  </>}>
    <div className="space-y-4 p-4 text-[13px]">
      {error && <Banner kind="danger">{error}</Banner>}
      <label className="block">Guardar en
        <select className={input} value={destination} disabled={locked} onChange={e => { const value = e.target.value as Root | 'library'; setDestination(value); setDirectory(value === target.destination ? target.directory : ''); setInsert(false); }}>
          <option value="library">Biblioteca (crear fichas)</option><option value="memoria">Memoria</option><option value="notes">Notas</option>
        </select>
      </label>
      {destination !== 'library' ? <>
        <label className="block">Carpeta de destino
          <input className={input} list="et-import-folders" value={directory} disabled={locked} onChange={e => setDirectory(e.target.value)} placeholder="Raíz (vacío) o carpeta/nueva" />
          <datalist id="et-import-folders">{listDirs(trees[destination]).map(p => <option key={p} value={p} />)}</datalist>
        </label>
        <p className="text-[12px] text-muted">Puedes elegir una carpeta o escribir una nueva. Los originales se conservan. Un nombre ocupado recibe un sufijo; un archivo idéntico se reutiliza.</p>
        {insertable && <label className="flex items-start gap-2"><input type="checkbox" checked={insert} disabled={busy} onChange={e => setInsert(e.target.checked)} /><span>Insertar en «{editor!.path}»{target.insert ? ', en el punto donde lo soltaste' : ', en el cursor'}</span></label>}
        {editor && ext(editor.path) === 'tex' && <p className="text-[12px] text-muted">PNG, JPG y PDF se insertan como figuras. Los demás formatos se guardan sin insertar; conviértelos antes si quieres usarlos como figuras.</p>}
        {wantsInsert && <p className="text-[12px] text-muted">La inserción queda sin guardar y se puede deshacer. {ext(editor!.path) === 'md' ? 'Las imágenes se muestran y los demás archivos se enlazan.' : 'La figura se añade después de la línea donde lo soltaste; puedes editar su pie y etiqueta.'}</p>}
      </> : <p className="text-muted">Continúa para completar título, notas y organización, y elegir si agrupas los archivos en una ficha.</p>}
      <ul aria-label="Archivos para importar" className="max-h-56 space-y-2 overflow-auto rounded border border-line p-3">
        {target.files.map((f, i) => <li key={i} className="break-words"><p>{f.name} <span className="text-[11px] text-faint">({Math.ceil(f.size / 1024)} KB)</span></p>
          {results[i] && <p className="text-[12px] text-ok">{results[i]!.reused ? 'Reutilizado' : 'Guardado'}: {results[i]!.path}</p>}
          {errors[i] && <p role="alert" className="text-[12px] text-danger">{errors[i]}</p>}
        </li>)}
      </ul>
      {busy && <p role="status">Guardados {saved} de {target.files.length}…</p>}
    </div>
  </Modal>;
}
