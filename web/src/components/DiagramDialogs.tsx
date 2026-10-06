import { useEffect, useMemo, useState } from 'react';
import { Workflow } from 'lucide-react';
import type { OutlineItem } from '../api';
import { DIAGRAM_TEMPLATES } from '../lib/diagramTemplates';
import { basename, docKey } from '../lib/paths';
import {
  DIAGRAMAS_DIR,
  createDiagram,
  diagramName,
  insertFigure,
  openInEditor,
  sanitizeDiagramName,
  suggestWidth,
  useInsertFigure,
  useNewDiagram,
} from '../state/diagramas';
import { outlineLabel, useOutline, walkOutline } from '../state/outline';
import { ensureDoc, useDocs } from '../state/docs';
import { Button, Modal, cx } from './ui';

const input = 'h-8 w-full rounded-md border border-line-strong bg-bg px-2 text-[13px] outline-none focus:border-accent';

/** «Nuevo diagrama»: nombre y plantilla (o solo el nombre si viene de una nota). */
export function NewDiagramDialog() {
  const req = useNewDiagram((s) => s.req);
  const [name, setName] = useState('');
  const [tpl, setTpl] = useState(DIAGRAM_TEMPLATES[0].id);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (req) {
      setName(req.name ?? '');
      setTpl(DIAGRAM_TEMPLATES[0].id);
      setBusy(false);
    }
  }, [req]);
  const close = () => useNewDiagram.setState({ req: null });
  const full = sanitizeDiagramName(req?.dir ? `${req.dir}/${name}` : name);
  const submit = async () => {
    if (!req || !full || busy) return;
    setBusy(true);
    const source = req.source ?? DIAGRAM_TEMPLATES.find((t) => t.id === tpl)!.source;
    const path = await createDiagram(full, source);
    setBusy(false);
    if (path) close();
  };
  return (
    <Modal
      open={!!req}
      onClose={close}
      title={req?.source ? 'Usar el diagrama en la memoria' : 'Nuevo diagrama'}
      width={520}
      labelledBy="et-new-diagram-title"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} disabled={!full || busy}>
            {req?.source ? 'Copiar a la memoria' : 'Crear'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Nombre
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="arquitectura-general" className={input} />
          <span className="text-[11px] text-faint">
            {full ? (
              <>
                Se crea <span className="font-mono">{`${DIAGRAMAS_DIR}/${full}.mmd`}</span> y se exporta a{' '}
                <span className="font-mono">{`figuras/diagramas/${full}.pdf`}</span>
              </>
            ) : (
              'Letras, números, guiones y «/» para subcarpetas (sin tildes ni espacios).'
            )}
          </span>
        </label>
        {req?.source ? (
          <p className="text-[12px] text-muted">
            Se copia el bloque de la nota: la nota y el diagrama quedan independientes.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[12px] text-muted">Plantilla</legend>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Plantilla">
              {DIAGRAM_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={tpl === t.id}
                  onClick={() => setTpl(t.id)}
                  onDoubleClick={() => {
                    setTpl(t.id);
                    void submit();
                  }}
                  className={cx(
                    'flex items-start gap-2 rounded-md border px-2 py-1.5 text-left',
                    tpl === t.id ? 'border-accent bg-active' : 'border-line hover:bg-hover',
                  )}
                >
                  <Workflow size={14} className={cx('mt-0.5 shrink-0', tpl === t.id ? 'text-accent' : 'text-muted')} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium">{t.label}</span>
                    <span className="block text-[11px] text-faint">{t.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        )}
      </form>
    </Modal>
  );
}

const DEST_KINDS = new Set<OutlineItem['kind']>(['chapter', 'section', 'subsection', 'appendix', 'frontmatter']);

/** «Insertar en la memoria»: destino (vista Documento), pie, etiqueta y ancho. */
export function InsertFigureDialog() {
  const path = useInsertFigure((s) => s.path);
  const outline = useOutline((s) => s.data);
  const name = path ? diagramName(path) : null;
  const dests = useMemo(() => {
    const out: { it: OutlineItem; depth: number }[] = [];
    if (outline) walkOutline(outline.items, (it, depth) => it.enabled && DEST_KINDS.has(it.kind) && out.push({ it, depth }));
    return out;
  }, [outline]);
  const [dest, setDest] = useState('');
  const [caption, setCaption] = useState('');
  const [label, setLabel] = useState('');
  const [width, setWidth] = useState(80);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!path) return;
    if (!useOutline.getState().data) void useOutline.getState().refresh();
    setCaption('');
    setLabel(`fig:${(name ?? '').replace(/\//g, '-')}`);
    setWidth(80);
    setBusy(false);
    // Ancho por defecto según las proporciones del diagrama (se dibuja la fuente actual).
    let alive = true;
    void (async () => {
      await ensureDoc('memoria', path);
      const content = useDocs.getState().docs[docKey('memoria', path)]?.content;
      if (!content) return;
      const { renderDiagram } = await import('../lib/diagram');
      const r = await renderDiagram(content, name ?? 'diagrama');
      if (alive && r.ok) setWidth(suggestWidth(r.width, r.height));
    })();
    return () => {
      alive = false;
    };
  }, [path, name]);
  // Por defecto: el apartado del editor activo si lo hay; si no, el primer capítulo.
  useEffect(() => {
    if (!path || !dests.length) return;
    setDest((cur) => (dests.some((d) => d.it.id === cur) ? cur : (dests.find((d) => d.it.kind === 'chapter') ?? dests[0]).it.id));
  }, [path, dests]);
  const target = dests.find((d) => d.it.id === dest)?.it ?? null;
  const atCursor = target ? openInEditor(target.file) : false;
  const close = () => useInsertFigure.setState({ path: null });
  const submit = async () => {
    if (!path || !target || busy || !label.trim()) return;
    setBusy(true);
    const ok = await insertFigure({ path, target, caption: caption.trim() || basename(name ?? ''), label: label.trim(), width });
    setBusy(false);
    if (ok) close();
  };
  return (
    <Modal
      open={!!path}
      onClose={close}
      title="Insertar en la memoria"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} disabled={!target || busy || !label.trim()}>
            {busy ? 'Insertando…' : 'Insertar'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Destino
          <select value={dest} onChange={(e) => setDest(e.target.value)} className={input} aria-label="Capítulo o apartado destino">
            {!dests.length && <option value="">{outline ? 'La memoria no tiene capítulos' : 'Cargando el índice…'}</option>}
            {dests.map(({ it, depth }) => (
              <option key={it.id} value={it.id}>
                {'  '.repeat(depth)}
                {outlineLabel(it) || it.file} — {it.file}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-faint">
            {target
              ? atCursor
                ? `«${target.file}» está abierto: se inserta en el cursor (quedará sin guardar).`
                : 'Se inserta al final del apartado y se guarda.'
              : ''}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Pie de figura
          <input autoFocus value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Arquitectura general del sistema" className={input} />
        </label>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-[12px] text-muted">
            Etiqueta
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={cx(input, 'font-mono text-[12px]')} />
          </label>
          <label className="flex w-32 flex-col gap-1 text-[12px] text-muted">
            Ancho (% del texto)
            <input
              type="number"
              min={10}
              max={100}
              step={5}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value) || 80)}
              className={input}
            />
          </label>
        </div>
        <p className="text-[11px] text-faint">Si la figura no está exportada o está desactualizada, se exporta antes de insertarla.</p>
      </form>
    </Modal>
  );
}
