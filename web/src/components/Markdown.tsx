import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parse as parseYaml } from 'yaml';
import { ChevronDown, ChevronRight, Workflow } from 'lucide-react';
import { api, type Root } from '../api';
import { dirname, ext, join } from '../lib/paths';
import { kbd } from '../lib/kbd';
import { openFile } from '../state/workspace';
import { confirmDialog } from '../state/ui';
import { createNoteAt } from '../state/files';
import { copyFromNote } from '../state/diagramas';
import { renderAppMermaid } from '../lib/mermaid';

// ---------- Frontmatter ----------

export interface Split {
  frontmatter: string | null;
  data: Record<string, unknown> | null;
  body: string;
  error?: string;
}

export function splitFrontmatter(src: string): Split {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { frontmatter: null, data: null, body: src };
  const raw = m[1];
  let data: Record<string, unknown> | null = null;
  let error: string | undefined;
  try {
    const v = parseYaml(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) data = v as Record<string, unknown>;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { frontmatter: raw, data, body: src.slice(m[0].length), error };
}

function FrontmatterBox({ split }: { split: Split }) {
  const [open, setOpen] = useState(false);
  if (split.frontmatter == null) return null;
  const entries = split.data ? Object.entries(split.data) : [];
  return (
    <div className="mx-auto mb-4 max-w-[76ch] rounded-md border border-line bg-soft text-[12px]">
      <button
        type="button"
        className="flex w-full items-center gap-1 px-2 py-1 text-left text-muted hover:text-fg"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Propiedades
        {!open && entries.length > 0 && (
          <span className="ml-2 truncate text-faint">{entries.map(([k]) => k).join(' · ')}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2">
          {split.data ? (
            <table className="w-full">
              <tbody>
                {entries.map(([k, v]) => (
                  <tr key={k} className="align-top">
                    <td className="w-32 py-0.5 pr-3 font-medium text-muted">{k}</td>
                    <td className="py-0.5 break-all">{renderValue(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-[11.5px]">{split.frontmatter}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function renderValue(v: unknown): ReactNode {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (v instanceof Date) return v.toLocaleString('es-ES');
  if (v && typeof v === 'object') return JSON.stringify(v);
  const s = String(v ?? '');
  if (/^https?:\/\//.test(s))
    return (
      <a className="text-accent underline" href={s} target="_blank" rel="noreferrer">
        {s}
      </a>
    );
  return s;
}

// ---------- Wikilinks ----------

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp']);
const WIKI = /(!?)\[\[([^\]|#^\n]+)((?:#|\^)[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g;

function escapeMdText(s: string) {
  return s.replace(/([\\[\]])/g, '\\$1');
}

/** Sustituye [[x]] / [[x|alias]] / ![[img]] por enlaces Markdown, sin tocar el código. */
export function rewriteWikilinks(body: string): string {
  const parts = body.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(WIKI, (_m, bang: string, target: string, _anchor: string | undefined, alias: string | undefined) => {
        const t = target.trim();
        const enc = encodeURIComponent(t);
        if (bang && IMAGE_EXTS.has(ext(t))) return `![${escapeMdText(alias ?? t)}](wikiembed:${enc})`;
        return `[${escapeMdText((alias ?? t).trim())}](wikilink:${enc})`;
      });
    })
    .join('');
}

function urlTransform(url: string) {
  if (url.startsWith('wikilink:') || url.startsWith('wikiembed:')) return url;
  return defaultUrlTransform(url);
}

/** `rooted`: `target` ya es una ruta desde la raíz de las notas (enlace Markdown relativo). */
async function openWikilink(target: string, side: boolean, from?: string, rooted = false) {
  try {
    const r = await api.resolveNote(target, from);
    openFile('notes', r.path, { side });
  } catch {
    // La nota no existe: se ofrece crearla en la carpeta de la nota actual (contrato v0.7).
    const name = /\.md$/i.test(target) ? target : `${target}.md`;
    const path = rooted || !from ? name : join(dirname(from), name);
    const ok = await confirmDialog({
      title: 'La nota no existe',
      text: `No existe la nota «${target}». ¿Crearla en ${dirname(path) ? `«${dirname(path)}/»` : 'la raíz'}?`,
      okLabel: 'Crear nota',
    });
    if (ok) await createNoteAt(path);
  }
}

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

function EmbedImage({ target, alt, notePath }: { target: string; alt: string; notePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .resolveNote(target, notePath)
      .then((r) => alive && setSrc(api.rawUrl('notes', r.path)))
      .catch(() => alive && setSrc(api.rawUrl('notes', join(dirname(notePath), target))));
    return () => {
      alive = false;
    };
  }, [target, notePath]);
  return src ? <img src={src} alt={alt} loading="lazy" /> : <span className="text-faint">[{alt}]</span>;
}

// ---------- Mermaid ----------

let mermaidSeq = 0;
function Mermaid({ code, notePath }: { code: string; notePath?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, '');
  useEffect(() => {
    let alive = true;
    renderAppMermaid(`mmd-${baseId}-${++mermaidSeq}`, code)
      .then(({ svg }) => {
        if (alive && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [code, baseId]);
  // v0.8: copiar el bloque a la memoria como diagrama (copia explícita e independiente).
  const useInMemoria = notePath ? (
    <button
      type="button"
      className="absolute top-1 right-1 hidden items-center gap-1 rounded-md border border-line bg-bg px-1.5 py-0.5 text-[11px] text-muted shadow-sm group-hover/mmd:inline-flex group-focus-within/mmd:inline-flex hover:text-fg"
      title="Copiar este diagrama a diagramas/ de la memoria y abrirlo"
      onClick={() => copyFromNote(code, notePath)}
    >
      <Workflow size={12} /> Usar en la memoria
    </button>
  ) : null;
  if (error)
    return (
      <div className="group/mmd relative">
        <pre className="border-danger/40!">
          <code>{`Error de Mermaid: ${error}\n\n${code}`}</code>
        </pre>
        {useInMemoria}
      </div>
    );
  return (
    <div className="group/mmd relative">
      <div ref={ref} className="et-mermaid my-3 flex justify-center" aria-label="Diagrama Mermaid" />
      {useInMemoria}
    </div>
  );
}

// ---------- Vista ----------

interface Props {
  content: string;
  /** Ruta de la nota (para resolver imágenes y enlaces relativos). */
  path: string;
  root?: Root;
  showFrontmatter?: boolean;
}

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { value?: string; children?: unknown[] };
  if (typeof n.value === 'string') return n.value;
  return (n.children ?? []).map(textOf).join('');
}

export const MarkdownView = memo(function MarkdownView({ content, path, root = 'notes', showFrontmatter = true }: Props) {
  const split = useMemo(() => splitFrontmatter(content), [content]);
  const body = useMemo(() => rewriteWikilinks(split.body), [split.body]);
  const dir = dirname(path);

  const components = useMemo<Components>(
    () => ({
      a: ({ href = '', children, node: _n, ...rest }) => {
        if (href.startsWith('wikilink:')) {
          const target = decodeURIComponent(href.slice('wikilink:'.length));
          return (
            <a
              {...rest}
              href="#"
              className="et-wikilink"
              title={`${target} (${kbd('Alt-clic')}: abrir al lado)`}
              onClick={(e) => {
                e.preventDefault();
                void openWikilink(target, e.altKey, path);
              }}
            >
              {children}
            </a>
          );
        }
        if (href && !isExternal(href) && !href.startsWith('#')) {
          // Enlace relativo dentro del vault.
          const rel = decodeURI(href.split('#')[0]);
          const target = join(dir, rel);
          return (
            <a
              {...rest}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (/\.md$/i.test(target) || !ext(target)) void openWikilink(ext(target) ? target : `${target}.md`, e.altKey, path, true);
                else openFile(root, target, { side: e.altKey });
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <a {...rest} href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      },
      img: ({ src = '', alt = '', node: _n, ...rest }) => {
        const s = typeof src === 'string' ? src : '';
        if (s.startsWith('wikiembed:')) return <EmbedImage target={decodeURIComponent(s.slice(10))} alt={alt} notePath={path} />;
        if (s && !isExternal(s) && !s.startsWith('/')) {
          return <img {...rest} alt={alt} loading="lazy" src={api.rawUrl(root, join(dir, decodeURI(s)))} />;
        }
        return <img {...rest} alt={alt} loading="lazy" src={s} />;
      },
      pre: ({ node, children, ...rest }) => {
        const code = node?.children?.[0] as { tagName?: string; properties?: { className?: unknown } } | undefined;
        const cls = code?.properties?.className;
        const classes = Array.isArray(cls) ? cls.map(String) : typeof cls === 'string' ? [cls] : [];
        if (code?.tagName === 'code' && classes.includes('language-mermaid')) {
          return <Mermaid code={textOf(code).replace(/\n$/, '')} notePath={root === 'notes' ? path : undefined} />;
        }
        return <pre {...rest}>{children}</pre>;
      },
    }),
    [dir, path, root],
  );

  return (
    <>
      {showFrontmatter && <FrontmatterBox split={split} />}
      <div className="et-md">
        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components}>
          {body}
        </ReactMarkdown>
      </div>
    </>
  );
});
