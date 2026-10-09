import { useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { Archive, Check, ExternalLink, Inbox, Paperclip, Pencil, X } from 'lucide-react';
import { api, errorMessage } from '../api';
import { MarkdownView, splitFrontmatter } from '../components/Markdown';
import { Banner, Button, Spinner, cx } from '../components/ui';
import { openActions } from '../components/OpenActions';
import { ext, formatDate, hostOf, basename } from '../lib/paths';
import { onFileChange } from '../state/events';
import { STATUS_LABEL, setResourceStatus, setResourceTags } from '../state/resources';
import { useUI } from '../state/ui';
import { openFile, type FileParams } from '../state/workspace';

export function ResourcePanel({ params }: IDockviewPanelProps<FileParams>) {
  const { path } = params;
  const [content, setContent] = useState<string | null>(null);
  const [revision, setRevision] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ path: string | null; warning?: string }>({ path: null });
  const listItem = useUI((s) => s.resources?.find((r) => r.path === path));

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => api.resourceFile(path)
      .then((f) => { if (alive) { setContent(f.content); setRevision(f.rev); setError(null); setAttachment({ path: f.attachmentPath, warning: f.attachmentWarning }); } })
      .catch((e) => { if (alive) setError(errorMessage(e)); });
    setContent(null);
    setError(null);
    void load();
    const off = onFileChange((ev) => {
      if (ev.root !== 'notes') return;
      // Cambiar un adjunto o mover su carpeta también puede cambiar la resolución.
      clearTimeout(timer);
      timer = setTimeout(load, 200);
    });
    return () => {
      alive = false;
      off();
      clearTimeout(timer);
    };
  }, [path]);

  if (error) return <Banner kind="danger">No se pudo abrir el recurso: {error}. Si cambió de ruta fuera de la app, ábrelo desde el listado actualizado.</Banner>;
  if (content == null)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );

  const split = splitFrontmatter(content);
  const fm = split.data ?? {};
  const title = String(fm.title ?? listItem?.title ?? basename(path).replace(/\.md$/, ''));
  const url = (fm.url as string | undefined) ?? listItem?.url;
  const status = String(fm.status ?? listItem?.status ?? 'inbox');
  const tags: string[] = Array.isArray(fm.tags) ? fm.tags.map(String) : listItem?.tags ?? [];
  const captured = (fm.captured as string | undefined) ?? listItem?.captured;
  const att = attachment.path;

  return (
    <div className="h-full overflow-auto bg-bg">
      <div className="mx-auto max-w-[80ch] px-6 py-5">
        <div className="mb-1 flex items-center gap-2 text-[11.5px] text-muted">
          <StatusPill status={status} />
          {captured && <span>Capturado {formatDate(captured)}</span>}
        </div>
        <h1 className="mb-1 text-[20px] leading-tight font-semibold">{title}</h1>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="mb-3 inline-flex max-w-full items-center gap-1 truncate text-[12.5px] text-accent hover:underline">
            <ExternalLink size={12} className="shrink-0" />
            <span className="truncate">{url}</span>
          </a>
        )}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {status !== 'revisado' && (
            <Button onClick={() => setResourceStatus(path, 'revisado', revision)}>
              <Check size={12} /> Revisado
            </Button>
          )}
          {status !== 'descartado' && (
            <Button onClick={() => setResourceStatus(path, 'descartado', revision)}>
              <Archive size={12} /> Descartar
            </Button>
          )}
          {status !== 'inbox' && (
            <Button onClick={() => setResourceStatus(path, 'inbox', revision)}>
              <Inbox size={12} /> A la bandeja
            </Button>
          )}
          <Button variant="ghost" {...openActions((side) => openFile('notes', path, { side }))}>
            <Pencil size={12} /> Editar nota
          </Button>
        </div>
        <TagEditor tags={tags} onChange={(t) => setResourceTags(path, t, revision)} />
        {attachment.warning && <Banner kind="warn">{attachment.warning}</Banner>}
        {att && <Attachment path={att} key={`${att}:${revision}`} />}
        <div className="mt-4">
          {split.body.trim() ? (
            <MarkdownView content={split.body} path={path} showFrontmatter={false} />
          ) : (
            <p className="text-[12px] text-faint">Sin nota.</p>
          )}
        </div>
        {url && <p className="mt-6 text-[11px] text-faint">Fuente: {hostOf(url)}</p>}
      </div>
    </div>
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

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span key={t} className="inline-flex h-5 items-center gap-0.5 rounded bg-soft px-1.5 text-[11px] text-muted">
          #{t}
          {t !== 'recurso' && (
            <button type="button" aria-label={`Quitar etiqueta ${t}`} className="hover:text-danger" onClick={() => onChange(tags.filter((x) => x !== t))}>
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            const add = draft.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean);
            onChange([...new Set([...tags, ...add])]);
            setDraft('');
          }
        }}
        placeholder="+ etiqueta"
        aria-label="Añadir etiqueta"
        className="h-5 w-24 rounded border border-transparent bg-transparent px-1 text-[11px] outline-none focus:border-line"
      />
    </div>
  );
}

function Attachment({ path }: { path: string }) {
  const url = api.rawUrl('notes', path);
  const e = ext(path);
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(e);
  return (
    <div className="mt-4 rounded-md border border-line">
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 border-b border-line px-2 py-1 text-[12px] text-accent hover:underline">
        <Paperclip size={12} /> {basename(path)}
      </a>
      {isImg && <img src={url} alt={basename(path)} className="max-h-[480px] w-full object-contain p-2" />}
      {e === 'pdf' && <iframe title={basename(path)} src={url} className="h-[520px] w-full border-0" />}
    </div>
  );
}
