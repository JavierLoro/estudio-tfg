import { useEffect, useState } from 'react';
import { api, errorMessage, type ResourceFile, type IntegrationPreview } from '../api';
import { load, remove, save } from '../lib/storage';
import { docKey } from '../lib/paths';
import { editorViews, insertAtCursor, replaceEditorContent } from '../lib/editorInsert';
import { editContent, ensureDoc, isDirty, requestReveal, useDocs } from '../state/docs';
import { flattenTree, useUI } from '../state/ui';
import { openFile } from '../state/workspace';
import { Banner, Button, Field, Input, Modal, Select } from './ui';

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
  // Las vistas antiguas de figura podían mezclar inserción y actualización.
  const storageKey = `et:library-use:${destination.instanceId}:${file.item.id}:${kind}${kind === 'figure' ? ':v2' : ''}${replaceCopy ? `:actualizar:${replaceCopy}` : ''}`;
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
        {error && <Banner kind="danger" inline>{error}</Banner>}
        {!preview ? (
          <>
            {!updateOnly && (
              <Field label="Archivo de destino">
                <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {!paths.length && <option value="">Cargando archivos…</option>}
                  {paths.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
            )}
            {kind === 'figure' && (
              <>
                <Field label="Imagen o PDF (primera página)">
                  <Select value={attachment} onChange={(e) => setAttachment(e.target.value)}>
                    <option value="">Seleccionar adjunto…</option>
                    {file.attachments
                      .filter((a) => a.path)
                      .map((a) => (
                        <option key={a.path!} value={a.path!}>
                          {a.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <p className="text-ui text-muted">
                  LaTeX admite PNG, JPG y PDF. Convierte los demás formatos antes de insertarlos. La copia se guarda dentro de la memoria.
                </p>
                {!updateOnly && (
                  <>
                    <Field label="Pie de figura">
                      <Input value={caption} onChange={(e) => setCaption(e.target.value)} />
                    </Field>
                    <Field label="Procedencia / atribución">
                      <Input value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Autor, licencia o fuente" />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Etiqueta">
                        <Input value={label} onChange={(e) => setLabel(e.target.value)} />
                      </Field>
                      <Field label="Ancho (% del texto)">
                        <Input
                          type="number"
                          min={5}
                          max={100}
                          value={width}
                          onChange={(e) => setWidth(Number(e.target.value))}
                        />
                      </Field>
                    </div>
                  </>
                )}
              </>
            )}
            <p className="text-ui text-muted">
              {updateOnly
                ? kind === 'figure'
                  ? 'Solo se actualiza el archivo de imagen. Se conservan el texto LaTeX, el pie, la atribución, la etiqueta y el ancho existentes.'
                  : 'Actualizar una copia conserva las citas ya incorporadas.'
                : 'Se conserva el borrador. La inserción se hace en el cursor del editor y se puede deshacer; compilar guardará los cambios.'}
            </p>
          </>
        ) : (
          <>
            {preview.warnings.map((w, i) => (
              <Banner kind="warn" inline key={i}>
                {w}
              </Banner>
            ))}
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                remove(storageKey);
              }}
            >
              Preparar otra vista previa
            </Button>
            <p className="text-ui">
              {preview.result.key ? `Clave estable en esta memoria: ${preview.result.key}` : preview.result.figurePath}
            </p>
            {preview.result.mainEdit && (
              <Banner kind="info" inline>
                La conexión bibliográfica se añadirá al borrador del principal, conservando sus cambios sin guardar.
              </Banner>
            )}
            {updateOnly && kind === 'figure' ? (
              <Banner kind="info" inline>Solo se actualiza el archivo de imagen; el texto LaTeX y los metadatos de la figura se conservan.</Banner>
            ) : (
              <pre className="overflow-auto rounded-md bg-soft p-3 font-mono text-sm whitespace-pre-wrap">{preview.result.snippet}</pre>
            )}
            {preview.files.map((f) => (
              <details key={f.path} className="rounded-md border border-line px-3 py-1 text-ui">
                <summary className="flex min-h-(--et-row) cursor-pointer items-center">
                  {f.path} · {f.baseRev ? 'actualizar con revisión' : 'crear copia'}
                </summary>
                {f.after !== undefined && (
                  <>
                    <p className="font-bold">Contenido propuesto</p>
                    <pre className="max-h-64 overflow-auto font-mono text-sm whitespace-pre-wrap">{f.after}</pre>
                    {f.before && (
                      <>
                        <p className="font-bold">Versión actual</p>
                        <pre className="max-h-64 overflow-auto font-mono text-sm whitespace-pre-wrap">{f.before}</pre>
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
