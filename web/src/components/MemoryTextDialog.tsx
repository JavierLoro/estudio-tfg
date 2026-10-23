import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { docKey } from '../lib/paths';
import { editorViews, insertAtCursor } from '../lib/editorInsert';
import { ensureDoc, useDocs } from '../state/docs';
import { flattenTree, useUI } from '../state/ui';
import { openFile } from '../state/workspace';
import { Banner, Button, Modal, Spinner } from './ui';

export function MemoryTextDialog({ title, snippet, onClose }: { title: string; snippet: string; onClose: () => void }) {
  const [destination] = useState(() => useUI.getState().status);
  const tree = useUI(s => s.trees.memoria), paths = flattenTree(tree).filter(p => p.endsWith('.tex'));
  const [target, setTarget] = useState(paths.find(p => p.startsWith('1-capitulos/')) ?? paths[0] ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void useUI.getState().refreshTree('memoria'); }, []);
  const insert = async () => {
    setBusy(true); setError('');
    try {
      const check = async () => {
        const status = await api.status();
        if (!destination?.instanceId || status.instanceId !== destination.instanceId || status.libraryId !== destination.libraryId) throw new Error('Vuelve a la memoria y Biblioteca originales para insertar.');
      };
      await check();
      await ensureDoc('memoria', target);
      const key = docKey('memoria', target), before = useDocs.getState().docs[key];
      if (before?.status !== 'ready' || before.conflict || before.deleted) throw new Error('Resuelve o recarga el documento de destino antes de insertar.');
      openFile('memoria', target);
      for (let n = 0; n < 150 && !editorViews.has(key); n++) await new Promise(r => setTimeout(r, 20));
      await check();
      const current = useDocs.getState().docs[key];
      if (!current || current.content !== before.content || current.rev !== before.rev || current.conflict || current.deleted) throw new Error('El documento cambió; revisa el borrador y vuelve a insertar.');
      if (!insertAtCursor(key, `\n\n${snippet}\n\n`)) throw new Error('Abre el editor de destino y vuelve a insertar.');
      onClose();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <Modal open title={title} width={640} onClose={() => !busy && onClose()} footer={<>
    <Button disabled={busy} onClick={onClose}>Cancelar</Button>
    <Button variant="primary" disabled={busy || !target} onClick={() => void insert()}>{busy && <Spinner size={12} />}Insertar en el borrador</Button>
  </>}><div className="space-y-3 p-4 text-[13px]">
    {error && <Banner kind="danger">{error}</Banner>}
    <label className="block">Archivo de destino<select aria-label="Archivo de destino" className="mt-1 w-full rounded border border-line bg-bg p-2" disabled={busy} value={target} onChange={e => setTarget(e.target.value)}>
      {!target && <option value="">Seleccionar archivo…</option>}{paths.map(p => <option key={p}>{p}</option>)}
    </select></label>
    <p>Se incorpora en el cursor del editor. Conserva el borrador, queda sin guardar y permite Deshacer.</p>
    <pre aria-label="Contenido que se insertará" className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line bg-soft p-3 text-[12px]">{snippet}</pre>
    <p className="text-[12px] text-muted">{snippet.startsWith('\\href') ? 'Los enlaces utilizan hyperref, incluido en las plantillas de la memoria.' : 'Las notas se incorporan como texto plano.'}</p>
  </div></Modal>;
}
