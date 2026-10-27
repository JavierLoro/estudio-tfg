import '../lib/excalidrawAssets';
import { useEffect, useRef, useState } from 'react';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { IDockviewPanelProps } from 'dockview-react';
import { api, errorMessage } from '../api';
import { DocBanners, SaveIndicator } from '../components/DocBanners';
import { Banner, Button, Spinner } from '../components/ui';
import { parseExcalidraw } from '../lib/excalidraw';
import { sceneFingerprint } from '../../../shared/excalidraw';
import { basename, docKey } from '../lib/paths';
import { copyFromNote, diagramName, exportDiagram, openInsertFigure } from '../state/diagramas';
import { ensureDoc, saveDoc, setContent, useDocs } from '../state/docs';
import type { FileParams } from '../state/workspace';

export default function ExcalidrawPanel({ params, api: panel }: IDockviewPanelProps<FileParams>) {
  const { root, path } = params, key = docKey(root, path);
  const doc = useDocs(s => s.docs[key]);
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);
  const [initial, setInitial] = useState<any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const applied = useRef<string | null>(null);
  const baseline = useRef<string | null>(null);
  const theme = useTheme();
  useEffect(() => { void ensureDoc(root, path); panel.setTitle(basename(path)); }, [root, path, panel]);
  useEffect(() => {
    if (doc?.status !== 'ready' || doc.content === applied.current) return;
    try {
      const scene = parseExcalidraw(doc.content);
      applied.current = doc.content;
      baseline.current = null;
      if (editor.current) { editor.current.updateScene({ elements: scene.elements as ExcalidrawElement[], appState: scene.appState as AppState }); editor.current.addFiles(Object.values(scene.files) as any); editor.current.history.clear(); }
      else setInitial({ ...scene, scrollToContent: true });
      setError('');
    } catch (e) { setError(errorMessage(e)); }
    // Solo las sustituciones externas vuelven al lienzo; devolver sus emisiones borraría Deshacer.
  }, [key, doc?.extVersion, doc?.status]);
  const changed = (elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) => {
    if (!editor.current || root !== 'memoria') return;
    // Persistir el dibujo, sin convertir la selección o el desplazamiento en ediciones.
    const content = serializeAsJSON(elements, { viewBackgroundColor: state.viewBackgroundColor }, files, 'local');
    const current = useDocs.getState().docs[key];
    if (!current || current.status !== 'ready') return;
    const next = JSON.parse(content);
    const fingerprint = sceneFingerprint(next);
    // Abrir normaliza anclajes y medidas: esa primera emisión no es una edición del usuario.
    if (baseline.current === null) { baseline.current = fingerprint; return; }
    if (baseline.current === fingerprint) return;
    baseline.current = fingerprint;
    applied.current = content; setContent(key, content);
    try { parseExcalidraw(content); setError(''); } catch (e) { setError(errorMessage(e)); }
  };
  const managed = root === 'memoria' && !!diagramName(path);
  return <div className="flex h-full flex-col overflow-hidden bg-bg" onKeyDownCapture={e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); if (!error && root === 'memoria') void saveDoc(key); }
  }}>
    <div className="flex min-h-9 items-center gap-2 border-b border-line px-3 py-1">
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{basename(path)}</span>
      <SaveIndicator docKey={key} compact />
      {root === 'memoria' && <Button disabled={!!error || busy} onClick={() => void saveDoc(key)}>Guardar</Button>}
      {managed ? <><Button disabled={!!error || busy} onClick={async () => { setBusy(true); try { await exportDiagram(path); } finally { setBusy(false); } }}>Exportar</Button><Button disabled={!!error || busy} onClick={() => openInsertFigure(path)}>Insertar en la memoria</Button></> : <Button disabled={!doc || !!error} onClick={() => doc && copyFromNote(doc.content, path)}>Crear diagrama en Memoria</Button>}
      {doc?.status === 'ready' ? <Button onClick={async () => { const { downloadBlob } = await import('../lib/diagram'); downloadBlob(new Blob([useDocs.getState().docs[key].content], { type: 'application/json' }), basename(path)); }}>Descargar copia</Button>
        : <a href={api.rawUrl(root, path)} download={basename(path)} className="text-[12px] text-accent">Descargar original</a>}
    </div>
    <DocBanners docKey={key} lang="plain" />
    {error && <Banner kind="danger">{error}</Banner>}
    <div className="et-excalidraw min-h-0 flex-1" aria-label="Editor Excalidraw" role="region">
      {initial ? <Excalidraw key={key} initialData={initial} excalidrawAPI={api => { editor.current = api; }} onChange={changed} langCode="es-ES" theme={theme}
        viewModeEnabled={root !== 'memoria'} aiEnabled={false} validateEmbeddable={() => false} handleKeyboardGlobally={false}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }} /> : !error && <Spinner />}
    </div>
  </div>;
}

function useTheme(): 'light' | 'dark' {
  const read = () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' as const : 'light' as const;
  const [theme, setTheme] = useState(read);
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'), update = () => setTheme(read()); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  return theme;
}
