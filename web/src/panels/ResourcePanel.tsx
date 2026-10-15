import { lazy, Suspense, useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { ArrowLeft, ExternalLink, Paperclip, Pencil } from 'lucide-react';
import { api, errorMessage, type ResourceFile, type LibraryUses } from '../api';
import { MarkdownView } from '../components/Markdown';
import { Banner, Button, Spinner, cx } from '../components/ui';
import { openActions } from '../components/OpenActions';
import { ext, formatDate, basename } from '../lib/paths';
import { ResourceEditor } from '../components/ResourceEditor';
import { LibraryMigrationDialog } from '../components/LibraryMigrationDialog';
import { BIB_FIELD_LABEL, KIND_LABEL, resourceKind, safeUrl } from '../lib/library';
import { onFileChange } from '../state/events';
import { STATUS_LABEL, useResourceEdit } from '../state/resources';
import { useUI } from '../state/ui';
import { openFile, type FileParams } from '../state/workspace';
import LibraryUseDialog from '../components/LibraryUseDialog';
import { AskAssistant } from '../components/AskAssistant';

const PdfViewer = lazy(() => import('../components/PdfViewer'));

export function ResourcePanel({ params }: IDockviewPanelProps<FileParams>) {
  const { path } = params;
  const [file, setFile] = useState<ResourceFile | null>(null),
    [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ResourceFile | null>(null),
    [migration, setMigration] = useState(false);
  const [using, setUsing] = useState<{
    file: ResourceFile;
    kind: 'reference' | 'figure';
    replaceCopy?: string;
    updateOnly?: boolean;
  } | null>(null);
  const [uses, setUses] = useState<LibraryUses | null>(null),
    [usesError, setUsesError] = useState('');
  const listItem = useUI((s) => s.resources?.find((item) => item.path === path));
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api
        .resourceFile(path)
        .then((result) => {
          if (alive) {
            setFile(result);
            setError(null);
          }
        })
        .catch((e) => {
          if (alive) setError(errorMessage(e));
        });
    setFile((previous) => (previous?.path === path ? previous : null));
    setError(null);
    void load();
    const off = onFileChange((event) => {
      if (event.root === 'notes') {
        clearTimeout(timer);
        timer = setTimeout(load, 200);
      }
    });
    return () => {
      alive = false;
      off();
      clearTimeout(timer);
    };
  }, [path, listItem?.rev]);
  useEffect(() => {
    if (!file?.item.id) return;
    let alive = true;
    const refresh = () =>
      api
        .libraryUses(file.item.id!)
        .then((r) => {
          if (alive) {
            setUses(r);
            setUsesError('');
          }
        })
        .catch((e) => {
          if (alive) setUsesError(errorMessage(e));
        });
    void refresh();
    const off = onFileChange((e) => {
      if (e.root === 'memoria') void refresh();
    });
    return () => {
      alive = false;
      off();
    };
  }, [file?.item.id, file?.rev, using]);
  const render = () => {
    if (error)
      return <Banner kind="danger">No se pudo abrir la ficha: {error}. Si cambió fuera de la app, ábrela desde Biblioteca.</Banner>;
    if (!file)
      return (
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      );
    const item = file.item;
    const libraryError = item.libraryError ?? listItem?.libraryError;
    return (
      <div className="h-full overflow-auto bg-bg">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <Button className="mb-4" onClick={() => useUI.getState().showLibrary()}>
            <ArrowLeft size={12} /> Biblioteca
          </Button>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <AskAssistant root="notes" path={path} resource />
            <span>{KIND_LABEL[resourceKind(item)]}</span>
            <StatusPill status={item.status} />
            <span>Añadido {formatDate(item.captured)}</span>
          </div>
          <h1 className="mb-3 text-[23px] font-semibold">{item.title}</h1>
          {libraryError && <Banner kind="warn">{libraryError}</Banner>}
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              disabled={!!libraryError}
              onClick={() => {
                useResourceEdit.setState({ error: null });
                setEditing(file);
              }}
            >
              <Pencil size={12} /> Editar datos y notas
            </Button>
            {!item.schemaVersion && !libraryError && <Button onClick={() => setMigration(true)}>Actualizar formato</Button>}
            <Button variant="ghost" {...openActions((side) => openFile('notes', path, { side }))}>
              Abrir archivo Markdown
            </Button>
          </div>
          <div className="mb-4 flex flex-wrap gap-1 text-[11px]">
            {item.id && !libraryError && (
              <div className="mb-4 flex flex-wrap gap-2">
                {item.bibliography && <Button onClick={() => setUsing({ file, kind: 'reference' })}>Insertar cita</Button>}
                {!!file.attachments.length && <Button onClick={() => setUsing({ file, kind: 'figure' })}>Insertar figura</Button>}
                {uses?.references.some((r) => r.id === item.id) && (
                  <Button onClick={() => setUsing({ file, kind: 'reference', updateOnly: true })}>
                    Actualizar bibliografía de esta ficha
                  </Button>
                )}
              </div>
            )}
            {(item.collections ?? []).map((value) => (
              <span key={value} className="rounded bg-active px-2 py-1 text-accent">
                {value}
              </span>
            ))}
            {item.tags
              .filter((tag) => tag !== 'recurso')
              .map((tag) => (
                <span key={tag} className="rounded bg-soft px-2 py-1 text-muted">
                  #{tag}
                </span>
              ))}
          </div>
          {(item.urls ?? (item.url ? [item.url] : [])).filter(safeUrl).map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mb-2 flex items-center gap-1 break-all text-[12px] text-accent hover:underline"
            >
              <ExternalLink size={12} className="shrink-0" />
              {url}
            </a>
          ))}
          {item.bibliography && (
            <section className="my-4 rounded border border-line bg-soft p-3 text-[12px]">
              <h2 className="mb-1 font-semibold">Referencia bibliográfica</h2>
              {item.bibliography.authority === 'library' && item.bibliography.source && (
                <a
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer"
                  href={api.rawUrl(
                    'notes',
                    `${useUI.getState().status?.resourcesSubdir ?? 'Recursos'}/originales/${item.bibliography.source.hash}.${item.bibliography.source.format === 'bibtex' ? 'bib' : item.bibliography.source.format === 'ris' ? 'ris' : 'json'}`,
                  )}
                >
                  Abrir original bibliográfico
                </a>
              )}
              {item.bibliography.authority === 'manual' ? (
                <p>
                  {item.bibliography.path} · {item.bibliography.key}
                </p>
              ) : (
                <dl className="space-y-1">
                  {Object.entries(item.bibliography.fields)
                    .filter(([, value]) => value)
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt className="inline font-medium">{BIB_FIELD_LABEL[key] ?? `Campo: ${key}`}: </dt>
                        <dd className="inline break-words">{value}</dd>
                      </div>
                    ))}
                </dl>
              )}
            </section>
          )}
          {file.attachments.map((attachment, i) => (
            <section key={i}>
              {attachment.warning && <Banner kind="warn">{attachment.warning}</Banner>}
              {attachment.path && <Attachment path={attachment.path} />}
            </section>
          ))}
          <section className="mt-6">
            <h2 className="mb-2 text-[14px] font-semibold">Notas</h2>
            {item.note?.trim() ? (
              <MarkdownView content={item.note} path={path} showFrontmatter={false} />
            ) : (
              <p className="text-[12px] text-faint">Sin notas. Puedes añadirlas al editar la ficha.</p>
            )}
          </section>
          {item.id && (
            <section className="mt-6 space-y-2">
              <h2 className="text-[14px] font-semibold">Usos en esta memoria</h2>
              {usesError && <Banner kind="warn">No se pudieron consultar los usos: {usesError}</Banner>}
              {uses?.references.some((r) => r.outdated) && (
                <Banner kind="warn">
                  La referencia cambió en Biblioteca. La copia de la memoria se conserva hasta que decidas actualizarla.
                </Banner>
              )}
            {uses?.available===false&&<p className="text-[12px] text-muted">Configura una memoria para consultar sus usos; la Biblioteca sigue disponible.</p>}
            {uses?.available!==false&&!uses?.uses.length && !usesError && (
                <p className="text-[12px] text-muted">
                  Aún no se detectan citas ni figuras guardadas. Los borradores aparecen al guardarlos.
                </p>
              )}
              {uses?.uses.map((u, i) => (
                <Button key={i} onClick={() => openFile('memoria', u.file, { line: u.line })}>
                  {u.kind === 'citation' ? 'Cita' : 'Figura'} · {u.file}:{u.line}
                </Button>
              ))}
              {uses?.figures.map((f) => (
                <div key={f.path} className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span>Copia: {f.path}</span>
                  <Button onClick={() => setUsing({ file, kind: 'figure', replaceCopy: f.path, updateOnly: true })}>
                    Actualizar esta copia de imagen
                  </Button>
                </div>
              ))}
            </section>
          )}
          {item.provenance && (
            <p className="mt-6 text-[11px] text-faint">
              Procedencia:{' '}
              {(
                {
                  file: 'Archivo añadido',
                  url: 'Enlace añadido',
                  manual: 'Ficha manual',
                  legacy: 'Recurso anterior',
                  bibliography: 'Bibliografía importada',
                } as Record<string, string>
              )[String(item.provenance.method)] ?? String(item.provenance.method)}
            </p>
          )}
        </div>
      </div>
    );
  };
  return (
    <>
      {render()}
      {editing && <ResourceEditor file={editing} onClose={() => setEditing(null)} />}
      <LibraryMigrationDialog open={migration} onlyPath={path} onClose={() => setMigration(false)} />
      {using && <LibraryUseDialog {...using} onClose={() => setUsing(null)} />}
    </>
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-semibold',
        status === 'inbox' && 'bg-active text-accent',
        status === 'revisado' && 'bg-ok/15 text-ok',
        status === 'descartado' && 'bg-hover text-faint',
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Attachment({ path }: { path: string }) {
  const url = api.rawUrl('notes', path);
  const e = ext(path);
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(e);
  return (
    <div className="mt-4 rounded-md border border-line">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 border-b border-line px-2 py-1 text-[12px] text-accent hover:underline"
      >
        <Paperclip size={12} /> {basename(path)}
      </a>
      {isImg && <img src={url} alt={basename(path)} className="max-h-[480px] w-full object-contain p-2" />}
      {e === 'pdf' && (
        <div role="region" aria-label={`PDF: ${basename(path)}`} className="relative h-[520px]">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <PdfViewer url={url} synctex={false} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
