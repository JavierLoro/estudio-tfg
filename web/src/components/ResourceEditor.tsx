import { useEffect, useState } from 'react';
import type { ResourceChanges, ResourceFile, ResourceKind } from '../api';
import { KIND_LABEL, kinds, resourceKind } from '../lib/library';
import { updateResource, useResourceEdit } from '../state/resources';
import { Banner, Button, Field, Input, Modal, Select, Spinner, Textarea } from './ui';
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
            {busy && <Spinner size={14} />} Guardar cambios
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
        <Field label="Título">
          <Input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <Select
              value={kind}
              disabled={busy || item.schemaVersion !== 1}
              onChange={(e) => setKind(e.target.value as ResourceKind)}
            >
              {kinds.map((value) => (
                <option value={value} key={value}>
                  {KIND_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Revisión">
            <Select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value)}>
              <option value="inbox">Sin revisar</option>
              <option value="revisado">Revisado</option>
              <option value="descartado">Descartado</option>
              {!['inbox', 'revisado', 'descartado'].includes(status) && <option>{status}</option>}
            </Select>
          </Field>
          <Field label="Etiquetas">
            <Input value={tags} disabled={busy} onChange={(e) => setTags(e.target.value)} placeholder="Separadas por coma" />
          </Field>
          <Field label="Colecciones">
            <Input
              value={collections}
              disabled={busy || item.schemaVersion !== 1}
              onChange={(e) => setCollections(e.target.value)}
              placeholder="Separadas por coma"
            />
          </Field>
        </div>
        <Field label="URLs (una por línea)">
          <Textarea value={urls} rows={2} disabled={busy || item.schemaVersion !== 1} onChange={(e) => setUrls(e.target.value)} />
        </Field>
        {item.schemaVersion !== 1 && (
          <p className="text-ui text-muted">
            Actualiza el formato de la ficha para organizar colecciones, varios enlaces y bibliografía.
          </p>
        )}
        {item.bibliography?.authority === 'manual' ? (
          <p className="text-ui text-muted">
            Bibliografía manual: {item.bibliography.path} · {item.bibliography.key}. Sus datos se editan en el archivo .bib.
          </p>
        ) : (
          item.schemaVersion === 1 && (
            <fieldset className="rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-bold">Datos bibliográficos opcionales</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Autor/es">
                  <Input value={author} disabled={busy} onChange={(e) => setAuthor(e.target.value)} />
                </Field>
                <Field label="Año">
                  <Input value={year} disabled={busy} onChange={(e) => setYear(e.target.value)} />
                </Field>
                <Field label="DOI">
                  <Input value={doi} disabled={busy} onChange={(e) => setDoi(e.target.value)} />
                </Field>
              </div>
              <p className="mt-2 text-sm text-muted">
                Puedes completarlos después o importar bibliografía desde Biblioteca.
              </p>
            </fieldset>
          )
        )}
        <Field label="Notas">
          <Textarea value={note} disabled={busy} rows={7} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {(error || globalError) && (
          <Banner kind="danger" inline>
            {error || globalError}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
