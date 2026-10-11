import { useEffect, useState } from 'react';
import type { ResourceChanges, ResourceFile, ResourceKind } from '../api';
import { KIND_LABEL, kinds, resourceKind } from '../lib/library';
import { updateResource, useResourceEdit } from '../state/resources';
import { Button, Modal, Spinner } from './ui';
import { useUI } from '../state/ui';

export function ResourceEditor({ file, onClose }: { file: ResourceFile; onClose: () => void }) {
  const item = file.item;
  const [destination] = useState(() => useUI.getState().status?.libraryId);
  const bib = item.bibliography?.authority === 'library' ? item.bibliography : null;
  const [title, setTitle] = useState(item.title),
    [kind, setKind] = useState(resourceKind(item));
  const [urls, setUrls] = useState((item.urls ?? (item.url ? [item.url] : [])).join('\n'));
  const [collections, setCollections] = useState((item.collections ?? []).join(', ')),
    [tags, setTags] = useState(item.tags.join(', '));
  const [note, setNote] = useState(item.note ?? ''),
    [status, setStatus] = useState(item.status);
  const [author, setAuthor] = useState(bib?.fields.author ?? ''),
    [year, setYear] = useState(bib?.fields.year ?? ''),
    [doi, setDoi] = useState(bib?.fields.doi ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const globalError = useResourceEdit((s) => s.error);
  const split = (value: string) => [
    ...new Set(
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  const changes: ResourceChanges = {};
  if (title !== item.title) changes.title = title;
  if (status !== item.status) changes.status = status;
  if (note !== (item.note ?? '')) changes.note = note;
  if (JSON.stringify(split(tags)) !== JSON.stringify(item.tags)) changes.tags = split(tags);
  if (item.schemaVersion === 1) {
    if (kind !== resourceKind(item)) changes.kind = kind;
    const nextUrls = urls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);
    if (JSON.stringify(nextUrls) !== JSON.stringify(item.urls ?? [])) changes.urls = nextUrls;
    if (JSON.stringify(split(collections)) !== JSON.stringify(item.collections ?? [])) changes.collections = split(collections);
    if (item.bibliography?.authority !== 'manual') {
      const fields: Record<string, string> = {};
      if (author !== (bib?.fields.author ?? '')) fields.author = author;
      if (year !== (bib?.fields.year ?? '')) fields.year = year;
      if (doi !== (bib?.fields.doi ?? '')) fields.doi = doi;
      if (Object.keys(fields).length)
        changes.bibliography = { authority: 'library', entryType: bib?.entryType ?? (kind === 'book' ? 'book' : 'article'), fields };
    }
  }
  const dirty = !!Object.keys(changes).length;
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const save = async () => {
    if (!dirty || busy) return;
    if (!title.trim()) {
      setError('Indica un título para la ficha');
      return;
    }
    setBusy(true);
    setError('');
    const ok = await updateResource(file.path, changes, file.rev, false, destination);
    setBusy(false);
    if (ok || useResourceEdit.getState().pending?.path === file.path) onClose();
  };
  const input = 'w-full rounded border border-line-strong bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent';
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Editar ficha"
      width={720}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancelar cambios
          </Button>
          <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
            {busy && <Spinner size={12} />} Guardar cambios
          </Button>
        </>
      }
    >
      <div
        className="space-y-3 p-4"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            void save();
          }
        }}
      >
        <label className="block text-[12px]">
          Título
          <input value={title} disabled={busy} className={input} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px]">
            Tipo
            <select
              value={kind}
              disabled={busy || item.schemaVersion !== 1}
              className={input}
              onChange={(e) => setKind(e.target.value as ResourceKind)}
            >
              {kinds.map((value) => (
                <option value={value} key={value}>
                  {KIND_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px]">
            Revisión
            <select value={status} disabled={busy} className={input} onChange={(e) => setStatus(e.target.value)}>
              <option value="inbox">Sin revisar</option>
              <option value="revisado">Revisado</option>
              <option value="descartado">Descartado</option>
              {!['inbox', 'revisado', 'descartado'].includes(status) && <option>{status}</option>}
            </select>
          </label>
          <label className="text-[12px]">
            Etiquetas
            <input
              value={tags}
              disabled={busy}
              className={input}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Separadas por coma"
            />
          </label>
          <label className="text-[12px]">
            Colecciones
            <input
              value={collections}
              disabled={busy || item.schemaVersion !== 1}
              className={input}
              onChange={(e) => setCollections(e.target.value)}
              placeholder="Separadas por coma"
            />
          </label>
        </div>
        <label className="block text-[12px]">
          URLs (una por línea)
          <textarea
            value={urls}
            rows={2}
            disabled={busy || item.schemaVersion !== 1}
            className={input}
            onChange={(e) => setUrls(e.target.value)}
          />
        </label>
        {item.schemaVersion !== 1 && (
          <p className="text-[12px] text-muted">
            Actualiza el formato de la ficha para organizar colecciones, varios enlaces y bibliografía.
          </p>
        )}
        {item.bibliography?.authority === 'manual' ? (
          <p className="text-[12px] text-muted">
            Bibliografía manual: {item.bibliography.path} · {item.bibliography.key}. Sus datos se editan en el archivo .bib.
          </p>
        ) : (
          item.schemaVersion === 1 && (
            <fieldset className="rounded border border-line p-3">
              <legend className="px-1 text-[12px] font-medium">Datos bibliográficos opcionales</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-[12px]">
                  Autor/es
                  <input className={input} value={author} disabled={busy} onChange={(e) => setAuthor(e.target.value)} />
                </label>
                <label className="text-[12px]">
                  Año
                  <input className={input} value={year} disabled={busy} onChange={(e) => setYear(e.target.value)} />
                </label>
                <label className="text-[12px]">
                  DOI
                  <input className={input} value={doi} disabled={busy} onChange={(e) => setDoi(e.target.value)} />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-faint">
                Puedes completarlos después. Importar bibliografía e insertar citas llegará en el siguiente bloque.
              </p>
            </fieldset>
          )
        )}
        <label className="block text-[12px]">
          Notas
          <textarea value={note} disabled={busy} rows={7} className={input} onChange={(e) => setNote(e.target.value)} />
        </label>
        {(error || globalError) && (
          <p role="alert" className="text-[12px] text-danger">
            {error || globalError}
          </p>
        )}
      </div>
    </Modal>
  );
}
