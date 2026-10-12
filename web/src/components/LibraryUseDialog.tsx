import { useEffect, useState } from 'react';
import { api, errorMessage, type ResourceFile, type IntegrationPreview } from '../api';
import { load, remove, save } from '../lib/storage';
import { docKey } from '../lib/paths';
import { editorViews, insertAtCursor, replaceEditorContent } from '../lib/editorInsert';
import { editContent, ensureDoc, isDirty, requestReveal, useDocs } from '../state/docs';
import { flattenTree, useUI } from '../state/ui';
import { openFile } from '../state/workspace';
import { Banner, Button, Modal } from './ui';

export default function LibraryUseDialog({
  file,
  kind,
  onClose,
  replaceCopy,
  updateOnly = false,
}: {
  file: ResourceFile;
  kind: 'reference' | 'figure';
  onClose: () => void;
  replaceCopy?: string;
  updateOnly?: boolean;
}) {
  const [destination] = useState(() => ({
    libraryId: useUI.getState().status!.libraryId!,
    instanceId: useUI.getState().status!.instanceId!,
  }));
  const storageKey = `et:library-use:${destination.instanceId}:${file.item.id}:${kind}`;
  const saved = load<{ preview: IntegrationPreview; target: string } | null>(storageKey, null);
  const tree = useUI((s) => s.trees.memoria),
    paths = flattenTree(tree).filter((p) => p.endsWith('.tex'));
  const [target, setTarget] = useState(() => saved?.target ?? paths.find((p) => p.startsWith('1-capitulos/')) ?? paths[0] ?? '');
  const [attachment, setAttachment] = useState(
    () => file.attachments.find((a) => a.path && /\.(png|jpe?g|pdf)$/i.test(a.path))?.path ?? '',
  );
  const [caption, setCaption] = useState(file.item.title),
    [credit, setCredit] = useState('');
  const [label, setLabel] = useState(`fig:biblioteca-${file.item.id}`),
    [width, setWidth] = useState(80);
  const [preview, setPreview] = useState<IntegrationPreview | null>(saved?.preview ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void useUI.getState().refreshTree('memoria');
  }, []);
  const prepare = async () => {
    setBusy(true);
    setError('');
    try {
      const main = useUI.getState().status!.memoriaMain;
      let mainDraft: undefined | { content: string; baseRev: string };
      if (kind === 'reference') {
        await ensureDoc('memoria', main);
        const d = useDocs.getState().docs[docKey('memoria', main)];
        if (d?.conflict || d?.status !== 'ready')
          throw new Error('Resuelve o recarga el documento principal antes de integrar bibliografía');
        mainDraft = { content: d.content, baseRev: d.rev };
      }
      const p = await api.integrationPreview({
        ...destination,
        operationId: crypto.randomUUID(),
        resourceId: file.item.id!,
        baseRev: file.rev,
        kind,
        attachmentPath: attachment,
        caption,
        credit,
        label,
        width,
        replaceCopy,
        mainDraft,
      });
      if (!save(storageKey, { preview: p, target }))
        throw new Error('No se pudo conservar la vista previa en este navegador; no se ha modificado la memoria');
      setPreview(p);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      if (useUI.getState().status?.instanceId !== destination.instanceId || useUI.getState().status?.libraryId !== destination.libraryId)
        throw new Error('Vuelve a la memoria y Biblioteca originales para aplicar esta integración');
      for (const f of preview.files)
        if (isDirty(useDocs.getState().docs[docKey('memoria', f.path)]))
          throw new Error(`«${f.path}» tiene cambios sin guardar; consérvalos antes de actualizar la copia gestionada`);
      const mainEdit = preview.result.mainEdit;
      if (mainEdit) {
        const d = useDocs.getState().docs[docKey('memoria', mainEdit.path)];
        if (!d || d.conflict || d.content !== mainEdit.before || d.rev !== mainEdit.baseRev)
          throw new Error('El borrador del principal cambió; conserva su edición y prepara otra vista previa');
      }
      if (!updateOnly) {
        if (!target) throw new Error('Selecciona un archivo de destino');
        await ensureDoc('memoria', target);
        const d = useDocs.getState().docs[docKey('memoria', target)];
        if (d?.status !== 'ready' || d.conflict) throw new Error('Resuelve el conflicto del editor de destino antes de insertar');
        openFile('memoria', target);
      }
      const result = await api.integrationApply(preview);
      if (mainEdit) {
        const key = docKey('memoria', mainEdit.path),
          d = useDocs.getState().docs[key];
        if (!d || d.content !== mainEdit.before || d.rev !== mainEdit.baseRev)
          throw new Error(
            'Las copias se conservaron, pero el principal cambió durante la operación; prepara otra vista previa sin perder su borrador',
          );
        if (!replaceEditorContent(key, mainEdit.after)) editContent(key, mainEdit.after);
      }
      if (!updateOnly) {
        const key = docKey('memoria', target),
          text = kind === 'figure' ? '\n\n' + result.result.snippet + '\n\n' : result.result.snippet;
        for (let n = 0; n < 150 && !editorViews.has(key); n++) await new Promise((r) => setTimeout(r, 20));
        if (!insertAtCursor(key, text))
          throw new Error('Las copias están preparadas; abre el editor y reintenta para insertar sin perder su historial');
        requestReveal(key, editorViews.get(key)!.state.doc.lineAt(editorViews.get(key)!.state.selection.main.head).number);
      }
      remove(storageKey);
      await useUI.getState().refreshTree('memoria');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const input = 'w-full rounded border border-line-strong bg-bg px-2 py-1.5 text-[12px]';
  return (
    <Modal
      open
      title={
        updateOnly
          ? 'Actualizar copia en la memoria'
          : kind === 'reference'
            ? 'Insertar cita en la memoria'
            : 'Insertar figura en la memoria'
      }
      width={800}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" disabled={busy || (!updateOnly && !target)} onClick={() => void (preview ? apply() : prepare())}>
            {busy ? 'Preparando…' : preview ? 'Aplicar vista previa' : 'Revisar antes de aplicar'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-4">
        {error && <Banner kind="danger">{error}</Banner>}
        {!preview ? (
          <>
            {!updateOnly && (
              <label className="block text-[12px]">
                Archivo de destino
                <select className={input} value={target} onChange={(e) => setTarget(e.target.value)}>
                  {!paths.length && <option value="">Cargando archivos…</option>}
                  {paths.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'figure' && (
              <>
                <label className="block text-[12px]">
                  Imagen o PDF (primera página)
                  <select className={input} value={attachment} onChange={(e) => setAttachment(e.target.value)}>
                    <option value="">Seleccionar adjunto…</option>
                    {file.attachments
                      .filter((a) => a.path)
                      .map((a) => (
                        <option key={a.path!} value={a.path!}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="text-[12px] text-muted">
                  LaTeX admite PNG, JPG y PDF. Convierte los demás formatos antes de insertarlos. La copia se guarda dentro de la memoria.
                </p>
                <label className="block text-[12px]">
                  Pie de figura
                  <input className={input} value={caption} onChange={(e) => setCaption(e.target.value)} />
                </label>
                <label className="block text-[12px]">
                  Procedencia / atribución
                  <input
                    className={input}
                    value={credit}
                    onChange={(e) => setCredit(e.target.value)}
                    placeholder="Autor, licencia o fuente"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[12px]">
                    Etiqueta
                    <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} />
                  </label>
                  <label className="text-[12px]">
                    Ancho (% del texto)
                    <input
                      className={input}
                      type="number"
                      min={5}
                      max={100}
                      value={width}
                      onChange={(e) => setWidth(Number(e.target.value))}
                    />
                  </label>
                </div>
              </>
            )}
            <p className="text-[12px] text-muted">
              Se conserva el borrador. La inserción se hace en el cursor del editor y se puede deshacer; compilar guardará los cambios.
              Actualizar una copia conserva las citas y figuras ya incorporadas.
            </p>
          </>
        ) : (
          <>
            {preview.warnings.map((w, i) => (
              <Banner kind="warn" key={i}>
                {w}
              </Banner>
            ))}
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(null);
                remove(storageKey);
              }}
            >
              Preparar otra vista previa
            </Button>
            <p className="text-[12px]">
              {preview.result.key ? `Clave estable en esta memoria: ${preview.result.key}` : preview.result.figurePath}
            </p>
            {preview.result.mainEdit && (
              <Banner kind="info">
                La conexión bibliográfica se añadirá al borrador del principal, conservando sus cambios sin guardar.
              </Banner>
            )}
            <pre className="overflow-auto whitespace-pre-wrap rounded bg-soft p-3 text-[12px]">{preview.result.snippet}</pre>
            {preview.files.map((f) => (
              <details key={f.path} className="rounded border border-line p-2">
                <summary>
                  {f.path} · {f.baseRev ? 'actualizar con revisión' : 'crear copia'}
                </summary>
                {f.after !== undefined && (
                  <>
                    <p className="text-[12px]">Contenido propuesto</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">{f.after}</pre>
                    {f.before && (
                      <>
                        <p className="text-[12px]">Versión actual</p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">{f.before}</pre>
                      </>
                    )}
                  </>
                )}
              </details>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
