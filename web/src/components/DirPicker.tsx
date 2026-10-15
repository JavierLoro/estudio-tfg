import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, BookMarked, ChevronRight, FileCode2, Folder, GitBranch, HardDrive } from 'lucide-react';
import { absCrumbs, isAbsPath, joinAbs, relUnder, type PathSep } from '../lib/abspath';
import { api, errorMessage, type FsDirsResponse } from '../api';
import { Banner, Button, Empty, IconButton, Input, Modal, Spinner, cx } from './ui';

function Badge({ children, title, icon }: { children: React.ReactNode; title: string; icon: React.ReactNode }) {
  return (
    <span title={title} className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-soft px-1.5 py-px text-xs text-muted">
      {icon}
      {children}
    </span>
  );
}

export interface DirPickerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Carpeta inicial (absoluta). Si no existe o no se puede listar, se empieza en las raíces. */
  initialPath?: string;
  allowedRoots: string[];
  pathSep: PathSep;
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
  pathSep,
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
  const initialConfig = useRef<string | null>(null);

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
    if (!open) { initialConfig.current = null; return; }
    const config = JSON.stringify([initialPath, defaultName, allowedRoots]);
    // Recargar ajustes con las mismas raíces no debe borrar el formulario.
    if (initialConfig.current === config) return;
    initialConfig.current = config;
    setName(defaultName);
    setError(null);
    setListing(null);
    const start = initialPath?.trim();
    // El padre de una raíz permitida (p. ej. /data/memoria) no es navegable.
    const allowed = start && isAbsPath(start) && allowedRoots.some((r) => relUnder(r, start) !== null);
    void go(allowed ? start : null, true);
  }, [open, initialPath, defaultName, allowedRoots, go]);

  const target = cur && mode === 'create' && name.trim() ? joinAbs(cur, name.trim(), pathSep) : cur;
  const invalidName = mode === 'create' && /[/\\]|^\.\.?$/.test(name.trim());
  const validation = target && validate ? validate(target) : null;
  const crumbs = cur ? absCrumbs(cur, allowedRoots, pathSep) : [];

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
          <div className="mr-auto min-w-0 truncate text-sm text-muted" title={target ?? ''}>
            {target ? (
              <>
                {mode === 'create' ? 'Se creará: ' : 'Seleccionada: '}
                <span className="font-mono text-fg">{target}</span>
              </>
            ) : (
              'Elige una carpeta de la lista'
            )}
          </div>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!target || busy || loading || !!validation || invalidName}
            onClick={() => target && void onSelect(target)}
          >
            {busy && <Spinner size={14} />}
            {selectLabel ?? (mode === 'create' ? 'Crear memoria aquí' : 'Seleccionar esta carpeta')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        <div className="flex min-h-(--et-toolbar) items-center gap-1 border-b border-line px-2 py-1">
          <IconButton label="Carpeta superior" onClick={up} disabled={!cur || loading}>
            <ArrowUp size={16} />
          </IconButton>
          <nav aria-label="Ruta" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-ui">
            <button
              type="button"
              className={cx('flex min-h-(--et-control-sm) items-center gap-1 rounded-md px-1.5 hover:bg-hover', !cur ? 'font-bold text-fg' : 'text-muted')}
              onClick={() => void go(null)}
              title="Carpetas permitidas"
            >
              <HardDrive size={14} aria-hidden /> Raíces
            </button>
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />
                <button
                  type="button"
                  className={cx('min-h-(--et-control-sm) truncate rounded-md px-1.5 hover:bg-hover', i === crumbs.length - 1 ? 'font-bold text-fg' : 'text-muted')}
                  onClick={() => void go(c.path)}
                  title={c.path}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
          {loading && <Spinner size={14} />}
        </div>
        {error && <Banner kind="danger">{error}</Banner>}
        {hint && <Banner kind="info">{hint}</Banner>}
        <div className="h-[320px] overflow-auto py-1">
          {listing && listing.dirs.length === 0 && <Empty>{cur ? 'No hay subcarpetas.' : 'No hay carpetas permitidas.'}</Empty>}
          <ul>
            {listing?.dirs.map((d) => (
              <li key={d.path}>
                <button
                  type="button"
                  className="et-focus-inset flex min-h-(--et-row) w-full items-center gap-2 px-3 py-1 text-left text-ui hover:bg-hover"
                  onClick={() => void go(d.path)}
                  title={d.path}
                >
                  <Folder size={16} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{cur ? d.name : d.path}</span>
                  {d.isObsidianVault && (
                    <Badge title="Vault de Obsidian" icon={<BookMarked size={12} aria-hidden />}>
                      Obsidian
                    </Badge>
                  )}
                  {d.hasMainTex && (
                    <Badge title="Contiene un documento LaTeX principal (tfg.tex o main.tex)" icon={<FileCode2 size={12} aria-hidden />}>
                      LaTeX
                    </Badge>
                  )}
                  {d.isGitRepo && (
                    <Badge title="Repositorio git" icon={<GitBranch size={12} aria-hidden />}>
                      git
                    </Badge>
                  )}
                  <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
        {mode === 'create' && (
          <div className="flex items-center gap-2 border-t border-line px-3 py-2">
            <label htmlFor="dirpicker-name" className="shrink-0 text-ui text-muted">
              Nueva carpeta
            </label>
            <Input
              id="dirpicker-name"
              inputSize="sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={invalidName || undefined}
              placeholder="vacío = usar la carpeta actual (debe estar vacía)"
              className="flex-1"
            />
          </div>
        )}
        {(validation || invalidName) && (
          <Banner kind="danger" className="border-t border-b-0!">{invalidName ? 'Nombre de carpeta no válido' : validation}</Banner>
        )}
      </div>
    </Modal>
  );
}
