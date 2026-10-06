import { useEffect, useMemo, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Play, Save } from 'lucide-react';
import { CodeEditor, type LineDiagnostic } from '../components/CodeEditor';
import { DocBanners, SaveIndicator } from '../components/DocBanners';
import { Button, IconButton, MOD, Spinner, cx } from '../components/ui';
import { langFor } from '../lib/editor';
import { docKey } from '../lib/paths';
import { countDiags, diagPath, useCompile } from '../state/compile';
import { ensureDoc, requestReveal, saveDoc, saveAll, useDocs } from '../state/docs';
import { flattenTree, useUI } from '../state/ui';
import { openFile, openPdf, type FileParams } from '../state/workspace';
import type { Diagnostic } from '../api';

export async function saveAndCompile(key?: string) {
  if (key) await saveDoc(key);
  // Guardar el resto de archivos de la memoria con cambios antes de compilar.
  await saveAll('memoria');
  openPdf({ inactive: true });
  await useCompile.getState().compile();
}

export function useMemoriaFiles() {
  const tree = useUI((s) => s.trees.memoria);
  return useMemo(() => flattenTree(tree), [tree]);
}

export interface PlacedDiagnostic extends Diagnostic {
  /** Ruta dentro de la memoria, o null si es un archivo externo (TeX Live). */
  path: string | null;
}

export function usePlacedDiagnostics(): PlacedDiagnostic[] {
  const last = useCompile((s) => s.last);
  const files = useMemoriaFiles();
  return useMemo(() => (last?.diagnostics ?? []).map((d) => ({ ...d, path: diagPath(d.file, files) })), [last, files]);
}

export function goToDiagnostic(d: PlacedDiagnostic, opts: { side?: boolean } = {}) {
  if (d.path) openFile('memoria', d.path, { line: d.line ?? 1, side: opts.side });
}

export function LatexPanel({ params, api }: IDockviewPanelProps<FileParams>) {
  const { root, path } = params;
  const key = docKey(root, path);
  useEffect(() => {
    void ensureDoc(root, path);
  }, [root, path]);
  const compiling = useCompile((s) => s.compiling);
  const status = useDocs((s) => s.docs[key]?.status);
  const all = usePlacedDiagnostics();
  const mine = useMemo<LineDiagnostic[]>(() => all.filter((d) => d.path === path && d.line != null), [all, path]);
  const [showList, setShowList] = useState(true);
  const { errors, warnings } = countDiags(all);

  // Título de la pestaña con el estado.
  useEffect(() => {
    api.setTitle(path.split('/').pop() ?? path);
  }, [api, path]);

  const sorted = useMemo(
    () =>
      [...all].sort((a, b) => {
        const am = a.path === path ? 0 : 1;
        const bm = b.path === path ? 0 : 1;
        if (am !== bm) return am - bm;
        if (!a.path !== !b.path) return a.path ? -1 : 1;
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        return (a.line ?? 0) - (b.line ?? 0);
      }),
    [all, path],
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-2 text-[11.5px] text-muted">
        <span className="min-w-0 flex-1 truncate font-mono" title={path}>
          {path}
        </span>
        <SaveIndicator docKey={key} />
        <IconButton label={`Guardar (${MOD}S)`} onClick={() => saveDoc(key)} disabled={status !== 'ready'}>
          <Save size={14} />
        </IconButton>
        <Button
          variant="primary"
          onClick={() => saveAndCompile(key)}
          disabled={compiling}
          title={`Guardar y compilar (${MOD}↵)`}
          aria-label="Guardar y compilar"
        >
          {compiling ? <Spinner size={11} /> : <Play size={12} />}
          Compilar
        </Button>
      </div>
      <DocBanners docKey={key} lang={langFor(path)} />
      <div className="relative min-h-0 flex-1">
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            <Spinner />
          </div>
        )}
        <CodeEditor
          docKey={key}
          lang={langFor(path)}
          onSave={() => saveDoc(key)}
          onSaveCompile={() => saveAndCompile(key)}
          diagnostics={mine}
        />
      </div>
      {all.length > 0 && (
        <div className="flex max-h-[35%] shrink-0 flex-col border-t border-line bg-soft">
          <button
            type="button"
            className="flex h-6 shrink-0 items-center gap-1.5 px-2 text-left text-[11.5px] text-muted hover:text-fg"
            onClick={() => setShowList((v) => !v)}
            aria-expanded={showList}
          >
            {showList ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Diagnósticos de la última compilación
            <span className="ml-auto flex items-center gap-2">
              {errors > 0 && (
                <span className="flex items-center gap-0.5 text-danger">
                  <AlertCircle size={12} /> {errors}
                </span>
              )}
              {warnings > 0 && (
                <span className="flex items-center gap-0.5 text-warn">
                  <AlertTriangle size={12} /> {warnings}
                </span>
              )}
            </span>
          </button>
          {showList && <DiagnosticList items={sorted} currentPath={path} currentKey={key} />}
        </div>
      )}
    </div>
  );
}

export function DiagnosticList({
  items,
  currentPath,
  currentKey,
}: {
  items: PlacedDiagnostic[];
  currentPath?: string;
  currentKey?: string;
}) {
  return (
    <ul className="min-h-0 overflow-auto pb-1" role="list">
      {items.map((d, i) => (
        <li key={i}>
          <button
            type="button"
            className={cx('flex w-full items-start gap-2 px-2 py-0.5 text-left text-[12px]', d.path ? 'hover:bg-hover' : 'cursor-default opacity-70')}
            disabled={!d.path}
            onClick={(e) => {
              if (d.path === currentPath && currentKey && d.line != null) requestReveal(currentKey, d.line);
              else goToDiagnostic(d, { side: e.altKey });
            }}
            title={`${d.path ?? d.file}${d.line != null ? `:${d.line}` : ''} — ${d.message}`}
          >
            {d.severity === 'error' ? (
              <AlertCircle size={13} className="mt-0.5 shrink-0 text-danger" />
            ) : (
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
            )}
            <span className={cx('shrink-0 font-mono text-[11px]', d.path === currentPath ? 'text-fg' : 'text-muted')}>
              {d.path ?? d.file.split('/').pop()}
              {d.line != null ? `:${d.line}` : ''}
            </span>
            <span className="min-w-0 flex-1 truncate text-fg">{d.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
