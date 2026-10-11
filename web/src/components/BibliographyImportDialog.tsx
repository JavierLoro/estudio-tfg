import { useEffect, useState } from 'react';
import {
  api,
  errorMessage,
  type BibliographySource,
  type ImportChoice,
  type ImportOperation,
  type ImportPreview,
  type ImportResult,
} from '../api';
import { load, save } from '../lib/storage';
import { BIB_FIELD_LABEL } from '../lib/library';
import { useUI } from '../state/ui';
import { Banner, Button, Modal } from './ui';

interface Draft {
  format: BibliographySource['format'];
  text: string;
  doi: string;
  preview: ImportPreview | null;
  choices: ImportChoice[];
  operationId: string;
  sent?: string;
  results: ImportResult[];
}
const initial: Draft = { format: 'bibtex', text: '', doi: '', preview: null, choices: [], operationId: '', results: [] };

export default function BibliographyImportDialog({ onClose }: { onClose: () => void }) {
  const [storageKey] = useState(() => `et:library-import:${useUI.getState().status?.libraryId ?? 'legacy'}`);
  const [draft, setDraft] = useState<Draft>(() => load(storageKey, initial));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [storageError, setStorageError] = useState(false);
  const [operations, setOperations] = useState<ImportOperation[]>([]);
  const [review, setReview] = useState<{ id: string; title: string; note: string } | null>(null);
  const resources = useUI((s) => s.resources ?? []);
  useEffect(() => {
    setStorageError(!save(storageKey, draft));
  }, [storageKey, draft]);
  useEffect(() => {
    void api
      .importOperations()
      .then((r) =>
        setOperations(
          r.items.filter(
            (op) =>
              op.items.some((c) => !op.results.some((x) => x.index === c.index && x.state !== 'error')) ||
              op.results.some((x) => x.state === 'error'),
          ),
        ),
      )
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const update = (index: number, values: Partial<ImportChoice>) =>
    setDraft((d) => ({ ...d, choices: d.choices.map((c) => (c.index === index ? { ...c, ...values } : c)) }));
  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      const p = await api.importPreview(
        draft.format === 'doi' ? { format: 'doi', doi: draft.doi } : { format: draft.format, text: draft.text },
      );
      setDraft((d) => ({
        ...d,
        preview: p,
        operationId: '',
        sent: undefined,
        results: [],
        choices: p.items.map(({ index, title, key, entryType, fields, candidates }) => ({
          index,
          title,
          key,
          entryType,
          fields,
          action: candidates.length ? 'skip' : 'create',
        })),
      }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!draft.preview) return;
    setBusy(true);
    setError('');
    try {
      const items = draft.choices.filter(
        (c) => !draft.results.some((r) => r.index === c.index && (r.state === 'done' || r.state === 'skipped')),
      );
      const body = { libraryId: draft.preview.libraryId, source: draft.preview.source, items };
      const sent = JSON.stringify(body),
        operationId = draft.sent === sent && draft.operationId ? draft.operationId : crypto.randomUUID();
      const next = { ...draft, sent, operationId };
      if (!save(storageKey, next)) throw new Error('No se pudo conservar el lote en este navegador; guarda el original antes de continuar');
      setDraft(next);
      const result = await api.importBibliography({ ...body, operationId });
      setDraft((d) => ({ ...d, results: [...d.results.filter((r) => !items.some((c) => c.index === r.index)), ...result.results] }));
      await useUI.getState().refreshResources();
      const recovered = await api.importOperations();
      setOperations(
        recovered.items.filter(
          (op) =>
            op.items.some((c) => !op.results.some((x) => x.index === c.index && x.state !== 'error')) ||
            op.results.some((x) => x.state === 'error'),
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const recover = (op: ImportOperation) => {
    const sent = JSON.stringify({ libraryId: op.libraryId ?? useUI.getState().status?.libraryId, source: op.source, items: op.items });
    setDraft({
      ...initial,
      format: op.source.format,
      text: op.source.text,
      preview: {
        libraryId: op.libraryId ?? useUI.getState().status!.libraryId!,
        source: op.source,
        items: op.items.map((c) => ({ ...c, candidates: [] })),
      },
      choices: op.items,
      operationId: op.operationId,
      sent,
      results: op.results,
    });
  };
  const readFile = async (file: File) => {
    try {
      if (file.size > 1024 * 1024) throw new Error('El archivo supera 1 MiB');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      setDraft({ ...initial, text, format: file.name.toLowerCase().endsWith('.ris') ? 'ris' : 'bibtex' });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const reviewTarget = async (c: ImportChoice) => {
    const target = resources.find((r) => r.id === c.targetId);
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      const file = await api.resourceFile(target.path);
      setReview({ id: target.id!, title: file.item.title, note: file.item.note ?? '' });
      update(c.index, { baseRev: file.rev });
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
      title="Importar bibliografía"
      width={850}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cerrar
          </Button>
          {draft.preview ? (
            <Button
              variant="primary"
              disabled={busy || !draft.choices.some((c) => !draft.results.some((r) => r.index === c.index && r.state !== 'error'))}
              onClick={() => void apply()}
            >
              {busy ? 'Importando…' : 'Aplicar decisiones / Reintentar fallidos'}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void preview()}>
              {busy ? 'Leyendo…' : 'Revisar antes de importar'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 p-4">
        {error && <Banner kind="danger">{error}</Banner>}
        {storageError && (
          <Banner kind="danger">
            No se pudo conservar el borrador local. Copia el texto o conserva el archivo original antes de cerrar.
          </Banner>
        )}
        {operations.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-medium">Lotes recuperables</h2>
            {operations.map((op) => (
              <Button key={op.operationId} disabled={busy} onClick={() => recover(op)}>
                Recuperar lote · {op.items.length} referencia(s)
              </Button>
            ))}
          </section>
        )}
        {!draft.preview ? (
          <>
            <label className="block text-[12px]">
              Origen
              <select
                className={input}
                value={draft.format}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value as Draft['format'] }))}
              >
                <option value="bibtex">BibTeX / BibLaTeX (.bib)</option>
                <option value="ris">RIS (.ris)</option>
                <option value="doi">DOI</option>
              </select>
            </label>
            {draft.format === 'doi' ? (
              <label className="block text-[12px]">
                DOI o enlace DOI
                <input
                  className={input}
                  value={draft.doi}
                  disabled={busy}
                  onChange={(e) => setDraft((d) => ({ ...d, doi: e.target.value }))}
                  placeholder="10.… / https://doi.org/…"
                />
              </label>
            ) : (
              <>
                <label className="block text-[12px]">
                  Seleccionar archivo
                  <input
                    type="file"
                    accept=".bib,.ris,text/plain"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void readFile(f);
                      e.target.value = '';
                    }}
                  />
                </label>
                <label className="block text-[12px]">
                  O pegar el contenido
                  <textarea
                    rows={10}
                    className={input}
                    value={draft.text}
                    disabled={busy}
                    onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                  />
                </label>
              </>
            )}
            <p className="text-[12px] text-muted">
              El original se conserva. Revisar no modifica fichas; un fallo al consultar el DOI permite completar sus datos manualmente.
            </p>
          </>
        ) : (
          <>
            {draft.preview.warning && <Banner kind="warn">{draft.preview.warning}</Banner>}
            <Button disabled={busy} onClick={() => setDraft((d) => ({ ...d, preview: null, choices: [], results: [], sent: undefined }))}>
              Volver al origen
            </Button>
            {!draft.choices.length && <p>No se encontraron referencias. Revisa el formato y el contenido.</p>}
            {draft.choices.map((c) => {
              const result = draft.results.find((r) => r.index === c.index),
                source = draft.preview!.items.find((i) => i.index === c.index),
                done = result?.state === 'done' || result?.state === 'skipped';
              const disabled = busy || done;
              return (
                <fieldset key={c.index} disabled={disabled} className="space-y-3 rounded border border-line p-3">
                  <legend className="px-1 font-medium">
                    Referencia {c.index + 1}
                    {done ? ' · ' + (result.state === 'done' ? 'Guardada' : 'Excluida') : ''}
                  </legend>
                  {source?.error && !done && (
                    <Banner kind="warn">
                      {source.error}. Revisa todos los campos o excluye esta entrada; el original queda conservado.
                    </Banner>
                  )}
                  {result?.error && <Banner kind="danger">{result.error}</Banner>}
                  {!!source?.candidates.length && (
                    <Banner kind="info">
                      Posibles coincidencias:{' '}
                      {source.candidates
                        .map(
                          (r) =>
                            `${r.title} (${r.reason === 'doi' ? 'mismo DOI' : r.exact ? 'mismo original' : 'título parecido'}${r.manual ? ', bibliografía manual' : ''})`,
                        )
                        .join('; ')}
                      . Decide explícitamente; no combinamos automáticamente.
                    </Banner>
                  )}
                  <label className="block text-[12px]">
                    Decisión
                    <select
                      className={input}
                      value={c.action}
                      onChange={(e) => update(c.index, { action: e.target.value as ImportChoice['action'] })}
                    >
                      <option value="create">Conservar como ficha independiente</option>
                      <option value="associate">Asociar a una ficha sin referencia</option>
                      <option value="merge">Combinar metadatos con una ficha</option>
                      <option value="skip">Conservar la actual / No importar</option>
                    </select>
                  </label>
                  {(c.action === 'associate' || c.action === 'merge') && (
                    <>
                      <label className="block text-[12px]">
                        Ficha de destino
                        <select
                          className={input}
                          value={c.targetId ?? ''}
                          onChange={(e) => {
                            const r = resources.find((r) => r.id === e.target.value);
                            update(c.index, { targetId: r?.id ?? undefined, baseRev: r?.rev });
                          }}
                        >
                          <option value="">Seleccionar ficha…</option>
                          {resources
                            .filter((r) => r.id && !r.libraryError && r.bibliography?.authority !== 'manual')
                            .map((r) => (
                              <option key={r.id!} value={r.id!}>
                                {r.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <p className="text-[11px] text-muted">
                        Se conserva la identidad, clave existente, notas y adjuntos. Los campos enviados sustituyen los metadatos
                        coincidentes.
                      </p>
                      <Button disabled={disabled || !c.targetId} onClick={() => void reviewTarget(c)}>
                        Revisar destino y actualizar revisión
                      </Button>
                      {review && review.id === c.targetId && (
                        <p className="whitespace-pre-wrap text-[12px]">
                          {review.title}
                          {'\n'}
                          {review.note || 'Sin notas'}
                        </p>
                      )}
                    </>
                  )}
                  {c.action !== 'skip' && (
                    <>
                      <label className="block text-[12px]">
                        Título
                        <input className={input} value={c.title} onChange={(e) => update(c.index, { title: e.target.value })} />
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-[12px]">
                          Clave de cita
                          <input className={input} value={c.key} onChange={(e) => update(c.index, { key: e.target.value })} />
                        </label>
                        <label className="text-[12px]">
                          Tipo bibliográfico
                          <input className={input} value={c.entryType} onChange={(e) => update(c.index, { entryType: e.target.value })} />
                        </label>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {[...new Set(['author', 'year', 'doi', ...Object.keys(c.fields)])].map((name) => (
                          <label key={name} className="block text-[12px]">
                            {BIB_FIELD_LABEL[name] ?? `Campo: ${name}`}
                            <textarea
                              rows={name === 'abstract' ? 3 : 1}
                              className={input}
                              value={c.fields[name] ?? ''}
                              onChange={(e) => update(c.index, { fields: { ...c.fields, [name]: e.target.value } })}
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </fieldset>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
}
