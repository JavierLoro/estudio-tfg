import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, BookMarked, ChevronRight, FileCode2, Folder, GitBranch, HardDrive } from 'lucide-react';
import { api, errorMessage, type FsDirsResponse } from '../api';
import { Button, Empty, IconButton, Modal, Spinner, cx } from './ui';

function Badge({ children, title, icon }: { children: React.ReactNode; title: string; icon: React.ReactNode }) {
  return (
    <span title={title} className="inline-flex shrink-0 items-center gap-0.5 rounded border border-line bg-soft px-1 text-[10.5px] leading-4 text-muted">
      {icon}
      {children}
    </span>
  );
}

/** Une una carpeta absoluta y un nombre (rutas POSIX). */
export function joinAbs(dir: string, name: string) {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}

/** Migas: raíz permitida que contiene `path` + segmentos restantes. */
function crumbsFor(path: string, roots: string[]): { label: string; path: string }[] {
  const root = roots
    .filter((r) => path === r || path.startsWith(r.endsWith('/') ? r : r + '/'))
    .sort((a, b) => b.length - a.length)[0];
  const out: { label: string; path: string }[] = [];
  let acc = root ?? '';
  if (root) out.push({ label: root, path: root });
  const rest = root ? path.slice(root.length) : path;
  for (const seg of rest.split('/').filter(Boolean)) {
    acc = acc ? joinAbs(acc, seg) : '/' + seg;
    out.push({ label: seg, path: acc });
  }
  return out;
}

export interface DirPickerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Carpeta inicial (absoluta). Si no existe o no se puede listar, se empieza en las raíces. */
  initialPath?: string;
  allowedRoots: string[];
  /** 'select' = elegir carpeta; 'create' = elegir carpeta padre + nombre de carpeta nueva. */
  mode?: 'select' | 'create';
  selectLabel?: string;
  /** Devuelve un mensaje de error para impedir la selección (o null). */
  validate?: (path: string) => string | null;
  /** Para 'create', recibe la ruta final (padre + nombre, o el padre si el nombre está vacío). */
  onSelect: (path: string) => void | Promise<void>;
  busy?: boolean;
  defaultName?: string;
  hint?: React.ReactNode;
}

export function DirPicker({
  open,
  onClose,
  title,
  initialPath,
  allowedRoots,
  mode = 'select',
  selectLabel,
  validate,
  onSelect,
  busy,
  defaultName = '',
  hint,
}: DirPickerProps) {
  const [listing, setListing] = useState<FsDirsResponse | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);

  const go = useCallback(async (path: string | null, fallback = false) => {
    setLoading(true);
    try {
      const r = await api.fsDirs(path ?? undefined);
      setListing(r);
      setCur(path ? (r.path ?? path) : null);
      setError(null);
    } catch (e) {
      if (fallback && path) {
        // La carpeta inicial no se puede listar: empezar en las raíces.
        setError(`No se pudo abrir ${path}: ${errorMessage(e)}`);
        try {
          const r = await api.fsDirs();
          setListing(r);
          setCur(null);
        } catch (e2) {
          setError(errorMessage(e2));
        }
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setError(null);
    setListing(null);
    const start = initialPath?.trim();
    void go(start && (start.startsWith('/') || start.startsWith('~')) ? start : null, true);
  }, [open, initialPath, defaultName, go]);

  const target = cur && mode === 'create' && name.trim() ? joinAbs(cur, name.trim()) : cur;
  const invalidName = mode === 'create' && /[/\\]|^\.\.?$/.test(name.trim());
  const validation = target && validate ? validate(target) : null;
  const crumbs = cur ? crumbsFor(cur, allowedRoots) : [];

  const up = () => {
    if (!cur) return;
    void go(listing?.parent ?? null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={600}
      footer={
        <>
          <div className="mr-auto min-w-0 truncate text-[11.5px] text-muted" title={target ?? ''}>
            {target ? (
              <>
                {mode === 'create' ? 'Se creará: ' : 'Seleccionada: '}
                <span className="font-mono text-fg">{target}</span>
              </>
            ) : (
              'Elige una carpeta de la lista'
            )}
          </div>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!target || busy || loading || !!validation || invalidName}
            onClick={() => target && void onSelect(target)}
          >
            {busy && <Spinner size={11} />}
            {selectLabel ?? (mode === 'create' ? 'Crear memoria aquí' : 'Seleccionar esta carpeta')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        <div className="flex min-h-9 items-center gap-1 border-b border-line px-2 py-1">
          <IconButton label="Carpeta superior" onClick={up} disabled={!cur || loading}>
            <ArrowUp size={14} />
          </IconButton>
          <nav aria-label="Ruta" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-[12px]">
            <button
              type="button"
              className={cx('flex items-center gap-1 rounded px-1 hover:bg-hover', !cur ? 'font-semibold text-fg' : 'text-muted')}
              onClick={() => void go(null)}
              title="Carpetas permitidas"
            >
              <HardDrive size={12} /> Raíces
            </button>
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight size={11} className="shrink-0 text-faint" />
                <button
                  type="button"
                  className={cx('truncate rounded px-1 hover:bg-hover', i === crumbs.length - 1 ? 'font-semibold text-fg' : 'text-muted')}
                  onClick={() => void go(c.path)}
                  title={c.path}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
          {loading && <Spinner size={12} />}
        </div>
        {error && <div className="border-b border-line bg-danger-bg px-3 py-1.5 text-[12px] text-danger">{error}</div>}
        {hint && <div className="border-b border-line bg-soft px-3 py-1.5 text-[11.5px] text-muted">{hint}</div>}
        <div className="h-[320px] overflow-auto py-1">
          {listing && listing.dirs.length === 0 && <Empty>{cur ? 'No hay subcarpetas.' : 'No hay carpetas permitidas.'}</Empty>}
          <ul>
            {listing?.dirs.map((d) => (
              <li key={d.path}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12.5px] hover:bg-hover"
                  onClick={() => void go(d.path)}
                  title={d.path}
                >
                  <Folder size={14} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{cur ? d.name : d.path}</span>
                  {d.isObsidianVault && (
                    <Badge title="Vault de Obsidian" icon={<BookMarked size={10} />}>
                      Obsidian
                    </Badge>
                  )}
                  {d.hasMainTex && (
                    <Badge title="Contiene un documento LaTeX principal (tfg.tex o main.tex)" icon={<FileCode2 size={10} />}>
                      LaTeX
                    </Badge>
                  )}
                  {d.isGitRepo && (
                    <Badge title="Repositorio git" icon={<GitBranch size={10} />}>
                      git
                    </Badge>
                  )}
                  <ChevronRight size={12} className="shrink-0 text-faint" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        {mode === 'create' && (
          <div className="flex items-center gap-2 border-t border-line px-3 py-2">
            <label htmlFor="dirpicker-name" className="shrink-0 text-[12px] text-muted">
              Nueva carpeta
            </label>
            <input
              id="dirpicker-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vacío = usar la carpeta actual (debe estar vacía)"
              className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-bg px-2 text-[12.5px] outline-none focus:border-accent"
            />
          </div>
        )}
        {(validation || invalidName) && (
          <div className="border-t border-line px-3 py-1.5 text-[12px] text-danger">{invalidName ? 'Nombre de carpeta no válido' : validation}</div>
        )}
      </div>
    </Modal>
  );
}
