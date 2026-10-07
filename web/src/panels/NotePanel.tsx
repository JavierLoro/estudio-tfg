import { useCallback, useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { BookOpen, Link2, Pencil, Save } from 'lucide-react';
import { api, type Backlink } from '../api';
import { CodeEditor } from '../components/CodeEditor';
import { DocBanners, SaveIndicator } from '../components/DocBanners';
import { MarkdownView } from '../components/Markdown';
import { IconButton, Spinner } from '../components/ui';
import { kbd } from '../lib/kbd';
import { langFor } from '../lib/editor';
import { docKey, ext, stripExt, basename } from '../lib/paths';
import { ensureDoc, saveDoc, useDocs } from '../state/docs';
import { onFileChange } from '../state/events';
import { openFile, type FileParams } from '../state/workspace';

type Mode = 'read' | 'edit';

export function NotePanel({ params, api: panelApi }: IDockviewPanelProps<FileParams & { mode?: Mode }>) {
  const { root, path } = params;
  const key = docKey(root, path);
  const isMd = ext(path) === 'md';
  const [mode, setModeState] = useState<Mode>(isMd ? (params.mode ?? 'read') : 'edit');
  const setMode = useCallback(
    (m: Mode) => {
      setModeState(m);
      panelApi.updateParameters({ mode: m });
    },
    [panelApi],
  );
  useEffect(() => {
    void ensureDoc(root, path);
  }, [root, path]);

  const status = useDocs((s) => s.docs[key]?.status);
  const content = useDocs((s) => s.docs[key]?.content ?? '');

  // Mod-E alterna lectura/edición; Mod-S guarda también en modo lectura.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!panelApi.isActive) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e' && isMd) {
        e.preventDefault();
        setMode(mode === 'read' ? 'edit' : 'read');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelApi, mode, isMd, setMode]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-2 text-[11.5px] text-muted">
        <span className="min-w-0 flex-1 truncate" title={path}>
          {path}
        </span>
        <SaveIndicator docKey={key} />
        <IconButton label={`Guardar (${kbd('Mod-S')})`} onClick={() => saveDoc(key)} disabled={status !== 'ready'}>
          <Save size={14} />
        </IconButton>
        {isMd && (
          <div className="flex rounded-md border border-line p-px" role="group" aria-label="Modo">
            <IconButton label={`Leer (${kbd('Mod-E')})`} active={mode === 'read'} onClick={() => setMode('read')} aria-pressed={mode === 'read'}>
              <BookOpen size={13} />
            </IconButton>
            <IconButton label={`Editar (${kbd('Mod-E')})`} active={mode === 'edit'} onClick={() => setMode('edit')} aria-pressed={mode === 'edit'}>
              <Pencil size={13} />
            </IconButton>
          </div>
        )}
      </div>
      <DocBanners docKey={key} lang={langFor(path)} />
      {status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner />
        </div>
      )}
      {status === 'ready' && mode === 'edit' && (
        <div className="min-h-0 flex-1">
          <CodeEditor docKey={key} lang={langFor(path)} lineNumbers={false} className="et-prose-editor h-full min-h-0 overflow-hidden" onSave={() => saveDoc(key)} />
        </div>
      )}
      {status === 'ready' && mode === 'read' && (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          <MarkdownView content={content} path={path} root={root} />
          {root === 'notes' && <Backlinks path={path} />}
        </div>
      )}
    </div>
  );
}

function Backlinks({ path }: { path: string }) {
  const [items, setItems] = useState<Backlink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      api
        .backlinks(path)
        .then((r) => alive && (setItems(r.items), setError(null)))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const off = onFileChange((ev) => {
      if (ev.root !== 'notes' || !ev.path.endsWith('.md')) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 800);
    });
    return () => {
      alive = false;
      off();
      if (timer) clearTimeout(timer);
    };
  }, [path]);

  return (
    <section className="mx-auto mt-10 max-w-[76ch] border-t border-line pt-3" aria-label="Enlaces entrantes">
      <h2 className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-muted uppercase">
        <Link2 size={13} /> Enlaces entrantes {items ? `(${items.length})` : ''}
      </h2>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      {items && items.length === 0 && <p className="text-[12px] text-faint">Ninguna nota enlaza a esta.</p>}
      <ul className="space-y-1">
        {items?.map((b) => (
          <li key={b.path}>
            <button
              type="button"
              className="w-full rounded-md px-2 py-1 text-left hover:bg-hover"
              onClick={(e) => openFile('notes', b.path, { side: e.altKey })}
            >
              <div className="text-[13px] font-medium text-accent">{b.title || stripExt(basename(b.path))}</div>
              {b.snippet && <div className="line-clamp-2 text-[12px] text-muted">{b.snippet}</div>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
