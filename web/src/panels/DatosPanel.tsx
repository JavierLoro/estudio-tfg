// Panel «Datos del trabajo» (v0.5): edita datos.tex y estilo/institucion.tex sin tocar el código.
// v0.6: aviso y diálogo para actualizar la memoria a la plantilla actual.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ClipboardList, ImagePlus, Play, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import {
  api,
  DatosConflictError,
  errorMessage,
  FieldError,
  PlantillaConflictError,
  type AccionPlantilla,
  type CambioPlantilla,
  type DatosChanges,
  type DatosResponse,
  type Perfil,
  type PlantillaPreview,
  type PlantillaResultado,
} from '../api';
import { IndicatorMark } from '../components/DocBanners';
import { kbd } from '../lib/kbd';
import { Banner, Button, Field, Input, Modal, Select, Spinner, cx } from '../components/ui';
import { useCompile, isPdfOutdated } from '../state/compile';
import { isDirty, saveAll, useDocs } from '../state/docs';
import { onFileChange } from '../state/events';
import { useOutline } from '../state/outline';
import { openFile } from '../state/workspace';
import { saveAndCompile } from './LatexPanel';

type Option = [value: string, label: string];

interface FieldSpec {
  key: string;
  label: string;
  kind?: 'text' | 'select' | 'month' | 'year';
  options?: Option[];
  /** Valor que aplica la plantilla cuando el comando falta o está vacío (selects). */
  def?: string;
  placeholder?: string;
  help?: string;
  list?: string[];
  /** Ocupa las dos columnas. */
  wide?: boolean;
  mono?: boolean;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const DEPARTAMENTOS = [
  'Tecnologías y Sistemas de Información',
  'Sistemas Informáticos',
  'Matemáticas',
  'Ingeniería Eléctrica, Electrónica, Automática y Comunicaciones',
];
const ESPECIALIDADES = ['Computación', 'Ingeniería de Computadores', 'Ingeniería del Software', 'Sistemas de Información', 'Tecnologías de la Información'];

/** Nombres antiguos de estilo de bibliografía (BibTeX) y su equivalente. */
const BIB_LEGACY: Record<string, string> = { ieeetr: 'ieee', plain: 'numeric', alpha: 'alphabetic', apalike: 'apa' };

const TRABAJO: FieldSpec[] = [
  { key: 'titulo', label: 'Título', wide: true },
  { key: 'autor', label: 'Autor/a' },
  { key: 'email', label: 'Correo electrónico', placeholder: '(opcional)' },
  { key: 'tutor', label: 'Tutor/a' },
  { key: 'cotutor', label: 'Cotutor/a', placeholder: '(opcional)' },
  { key: 'departamento', label: 'Departamento', placeholder: '(opcional)', list: DEPARTAMENTOS },
  { key: 'intensificacion', label: 'Especialidad / tecnología específica', placeholder: '(opcional)', list: ESPECIALIDADES },
  { key: 'fechaMes', label: 'Mes de entrega', kind: 'month', help: 'Si lo dejas vacío se usa la fecha actual.' },
  { key: 'fechaAnio', label: 'Año de entrega', kind: 'year', placeholder: '2026' },
  { key: 'ciudad', label: 'Ciudad', placeholder: '(opcional)' },
];

const RESUMEN: FieldSpec[] = [
  { key: 'palabrasClave', label: 'Palabras clave', wide: true, help: 'Separadas por comas, en el idioma del documento.' },
  { key: 'keywords', label: 'Keywords', wide: true, help: 'Las mismas en inglés, para el Abstract.' },
];

const DOCUMENTO: FieldSpec[] = [
  { key: 'idioma', label: 'Idioma', kind: 'select', def: 'espanol', options: [['espanol', 'Español'], ['ingles', 'Inglés']] },
  {
    key: 'formato',
    label: 'Formato',
    kind: 'select',
    def: 'impresion',
    options: [['impresion', 'Impresión (doble cara, enlaces negros)'], ['pantalla', 'Pantalla (una cara, enlaces en color)']],
  },
  {
    key: 'modo',
    label: 'Modo',
    kind: 'select',
    def: 'borrador',
    options: [['borrador', 'Borrador (marca «BORRADOR» y \\todo visibles)'], ['final', 'Final (un \\todo es un error)']],
  },
  {
    key: 'estiloBibliografia',
    label: 'Estilo de bibliografía',
    kind: 'select',
    def: 'ieee',
    options: [['ieee', 'IEEE'], ['apa', 'APA'], ['numeric', 'Numérico'], ['authoryear', 'Autor-año'], ['alphabetic', 'Alfabético']],
  },
  {
    key: 'licencia',
    label: 'Licencia',
    kind: 'select',
    def: 'reservados',
    options: [
      ['reservados', 'Todos los derechos reservados'],
      ['cc-by', 'CC BY'],
      ['cc-by-sa', 'CC BY-SA'],
      ['cc-by-nc-sa', 'CC BY-NC-SA'],
      ['ninguna', 'Ninguna'],
    ],
  },
  {
    key: 'atribucion',
    label: 'Atribución a la clase de ARCO',
    kind: 'select',
    def: 'si',
    options: [['si', 'Sí (página final)'], ['no', 'No']],
  },
];

const INSTITUCION: FieldSpec[] = [
  { key: 'universidad', label: 'Universidad', placeholder: '(vacío = no se muestra)' },
  { key: 'escuela', label: 'Escuela o facultad', placeholder: '(vacío = no se muestra)' },
  {
    key: 'tipoTrabajo',
    label: 'Tipo de trabajo',
    kind: 'select',
    def: 'tfg',
    options: [['tfg', 'Trabajo Fin de Grado'], ['tfm', 'Trabajo Fin de Máster'], ['tesis', 'Tesis doctoral'], ['otro', 'Otro']],
  },
  { key: 'nombreTrabajo', label: 'Nombre del trabajo', placeholder: '(vacío = el del tipo)', help: 'Sustituye al nombre del tipo en las portadas.' },
  { key: 'titulacion', label: 'Titulación', placeholder: 'Grado en Ingeniería Informática', wide: true },
  { key: 'etiquetaEspecialidad', label: 'Etiqueta de la especialidad', placeholder: 'Tecnología específica', help: 'Vacía: no se muestra la especialidad.' },
  {
    key: 'idiomaPortadas',
    label: 'Idioma de las portadas',
    kind: 'select',
    def: 'documento',
    options: [['documento', 'El del documento'], ['espanol', 'Español'], ['ingles', 'Inglés']],
  },
  { key: 'tamanoLetra', label: 'Tamaño de letra', kind: 'select', def: '12pt', options: [['10pt', '10 pt'], ['11pt', '11 pt'], ['12pt', '12 pt']] },
  {
    key: 'interlineado',
    label: 'Interlineado',
    kind: 'select',
    def: '1.5',
    options: [['1', 'Sencillo (1)'], ['1.15', '1,15'], ['1.25', '1,25'], ['1.5', '1,5'], ['2', 'Doble (2)']],
  },
];

const MARGENES: FieldSpec[] = [
  { key: 'margenInterior', label: 'Interior', placeholder: '30mm', mono: true },
  { key: 'margenExterior', label: 'Exterior', placeholder: '25mm', mono: true },
  { key: 'margenSuperior', label: 'Superior', placeholder: '25mm', mono: true },
  { key: 'margenInferior', label: 'Inferior', placeholder: '25mm', mono: true },
];

const INST_KEYS = new Set([...INSTITUCION, ...MARGENES].map((f) => f.key).concat('logo'));
const ALL_KEYS = [...TRABAJO, ...RESUMEN, ...DOCUMENTO, ...INSTITUCION, ...MARGENES].map((f) => f.key).concat('logo');
const LABEL = Object.fromEntries([...TRABAJO, ...RESUMEN, ...DOCUMENTO, ...INSTITUCION, ...MARGENES].map((f) => [f.key, f.label]));
LABEL.logo = 'Logo';

const flat = (d: DatosResponse): Record<string, string> => ({ ...d.datos, ...d.institucion });

type Phase = 'ok' | 'dirty' | 'saving' | 'error';
const PHASE_LABEL: Record<Phase, string> = { ok: 'Guardado', dirty: 'Sin guardar', saving: 'Guardando…', error: 'Error' };
const PHASE_IND = { ok: 'guardado', dirty: 'sin guardar', saving: 'guardando', error: 'error' } as const;

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-bg">
      <header className="flex min-h-(--et-toolbar) items-center border-b border-line px-4 py-1">
        <h2 className="text-ui font-bold">{title}</h2>
      </header>
      {note}
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 p-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function DatosPanel() {
  const [data, setDataState] = useState<DatosResponse | null>(null);
  const [form, setFormState] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ key: string; mine: string }[] | null>(null);
  const [touched, setTouched] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [plantilla, setPlantilla] = useState<PlantillaPreview | null>(null);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [resultado, setResultado] = useState<
    { kind: 'ok'; res: PlantillaResultado; version: string } | { kind: 'deshecho'; text: string } | null
  >(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const dataRef = useRef<DatosResponse | null>(null);
  const formRef = useRef<Record<string, string>>({});
  const failed = useRef<Record<string, string>>({});
  const chain = useRef<Promise<void>>(Promise.resolve());
  const fileInput = useRef<HTMLInputElement>(null);

  const setData = (d: DatosResponse) => {
    dataRef.current = d;
    setDataState(d);
  };
  const setForm = (f: Record<string, string>) => {
    formRef.current = f;
    setFormState(f);
  };

  const outdated = useCompile((s) => isPdfOutdated(s));
  const compiling = useCompile((s) => s.compiling);

  /** Claves cuyo valor difiere del disco (y no han fallado ya con ese mismo valor). */
  const dirtyKeys = useCallback((): string[] => {
    const d = dataRef.current;
    if (!d) return [];
    const base = flat(d);
    return ALL_KEYS.filter((k) => {
      if (INST_KEYS.has(k) && d.rev.institucion === null) return false;
      return (formRef.current[k] ?? '') !== (base[k] ?? '');
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.datos();
      setLoadError(null);
      setData(r);
      setForm(flat(r));
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, []);

  const loadPlantilla = useCallback(async () => {
    try {
      setPlantilla(await api.plantilla());
    } catch {
      /* sin aviso de plantilla */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadPlantilla();
  }, [load, loadPlantilla]);

  // La clase o institucion.tex cambiaron en disco: el estado de la plantilla puede ser otro.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onFileChange((ev) => {
      if (ev.root !== 'memoria' || !/^(estilo\/[^/]+\.cls|estilo\/institucion\.tex)$/i.test(ev.path)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadPlantilla(), 500);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [loadPlantilla]);

  // Cambios externos (editor de datos.tex, Syncthing…): se recargan si no hay nada pendiente.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onFileChange((ev) => {
      if (ev.root !== 'memoria' || !/^(datos\.tex|estilo\/(institucion\.tex|logo\.[a-z]+))$/i.test(ev.path)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        chain.current = chain.current.then(async () => {
          if (dirtyKeys().length) return;
          try {
            const r = await api.datos();
            const cur = dataRef.current;
            if (cur && cur.rev.datos === r.rev.datos && cur.rev.institucion === r.rev.institucion) return;
            setData(r);
            setForm(flat(r));
          } catch {
            /* se verá al guardar */
          }
        });
      }, 300);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [dirtyKeys]);

  const doSave = useCallback(async () => {
    const d = dataRef.current;
    if (!d) return;
    const base = flat(d);
    const changes: DatosChanges = {};
    const sent: Record<string, string> = {};
    for (const k of dirtyKeys()) {
      const v = formRef.current[k] ?? '';
      if (failed.current[k] === v) continue;
      const bucket = INST_KEYS.has(k) ? (changes.institucion ??= {}) : (changes.datos ??= {});
      bucket[k] = v;
      sent[k] = v;
    }
    if (!changes.datos && !changes.institucion) return;
    const baseRev: { datos?: string; institucion?: string } = {};
    if (changes.datos && d.rev.datos) baseRev.datos = d.rev.datos;
    if (changes.institucion && d.rev.institucion) baseRev.institucion = d.rev.institucion;
    setSaving(true);
    setGeneral(null);
    setErrors((e) => {
      const n = { ...e };
      for (const k of Object.keys(sent)) delete n[k];
      return n;
    });
    try {
      const r = await api.saveDatos(changes, baseRev);
      setData(r);
      const rf = flat(r);
      const nf = { ...formRef.current };
      for (const k of Object.keys(sent)) {
        if (nf[k] === sent[k]) nf[k] = rf[k] ?? '';
      }
      // Lo que no se tocó se mantiene al día con el disco.
      for (const k of ALL_KEYS) if (!(k in sent) && (nf[k] ?? '') === (base[k] ?? '')) nf[k] = rf[k] ?? '';
      failed.current = {};
      setForm(nf);
      setConflict(null);
      setTouched(true);
    } catch (e) {
      if (e instanceof DatosConflictError) {
        const cf = flat(e.current);
        const lost = Object.keys(sent)
          .filter((k) => sent[k] !== (cf[k] ?? ''))
          .map((k) => ({ key: k, mine: sent[k] }));
        failed.current = {};
        setData(e.current);
        setForm(cf);
        setErrors({});
        setConflict(lost);
      } else if (e instanceof FieldError && e.field in sent) {
        failed.current[e.field] = sent[e.field];
        setErrors((x) => ({ ...x, [e.field]: e.message }));
      } else {
        for (const k of Object.keys(sent)) failed.current[k] = sent[k];
        setGeneral(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  }, [dirtyKeys]);

  const queueSave = useCallback(() => {
    chain.current = chain.current.then(doSave).catch(() => undefined);
  }, [doSave]);

  const setValue = (k: string, v: string, saveNow = false) => {
    setForm({ ...formRef.current, [k]: v });
    if (errors[k] && failed.current[k] !== v) setErrors((e) => ({ ...e, [k]: '' }));
    if (saveNow) queueSave();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      queueSave();
    }
  };

  const logoAction = async (fn: () => Promise<DatosResponse>) => {
    setLogoBusy(true);
    setGeneral(null);
    setErrors((e) => ({ ...e, logo: '' }));
    try {
      const r = await fn();
      // Se aplica solo `logo`: lo demás que se esté editando no se pierde.
      const cur = dataRef.current;
      const nf = { ...formRef.current };
      const base = cur ? flat(cur) : {};
      const rf = flat(r);
      for (const k of ALL_KEYS) if ((nf[k] ?? '') === (base[k] ?? '')) nf[k] = rf[k] ?? '';
      setData(r);
      setForm(nf);
      setTouched(true);
    } catch (e) {
      if (e instanceof FieldError) setErrors((x) => ({ ...x, [e.field]: e.message }));
      else setGeneral(errorMessage(e));
    } finally {
      setLogoBusy(false);
    }
  };

  /** Tras actualizar o deshacer: relee datos, plantilla e índice y recompila. */
  const afterTemplateChange = async () => {
    await Promise.all([load(), loadPlantilla()]);
    void useOutline.getState().refresh();
    // Tras los avisos de cambio del watcher, para que el PDF no quede como desactualizado.
    await new Promise((r) => setTimeout(r, 800));
    void saveAndCompile();
  };

  /** Guarda todo, aplica la actualización y recompila. Lanza si no se puede (el diálogo lo muestra). */
  const aplicarPlantilla = async (p: PlantillaPreview) => {
    queueSave();
    await chain.current;
    if (dirtyKeys().length) throw new Error('Hay datos de este panel sin guardar: corrígelos antes de actualizar.');
    await saveAll('memoria');
    const afectados = new Set(p.cambios.map((c) => c.archivo));
    const pendientes = Object.values(useDocs.getState().docs).filter(
      (d) => d.root === 'memoria' && afectados.has(d.path) && (isDirty(d) || !!d.conflict),
    );
    if (pendientes.length) {
      throw new Error(`No se pudo guardar ${pendientes.map((d) => `«${d.path}»`).join(', ')}: resuélvelo antes de actualizar.`);
    }
    const res = await api.actualizarPlantilla(p.perfil, p.cambios);
    setDlgOpen(false);
    setResultado({ kind: 'ok', res, version: p.versionPlantilla });
    await afterTemplateChange();
  };

  const deshacerPlantilla = async () => {
    if (resultado?.kind !== 'ok') return;
    setUndoBusy(true);
    setGeneral(null);
    try {
      await saveAll('memoria');
      const r = await api.deshacerPlantilla(resultado.res.deshacer);
      setResultado({
        kind: 'deshecho',
        text: `Se ha deshecho la actualización: ${r.restaurados.length} archivos restaurados${r.commit ? ` · commit ${r.commit.slice(0, 7)}` : ''}.`,
      });
      await afterTemplateChange();
    } catch (e) {
      setGeneral(`No se pudo deshacer: ${errorMessage(e)}`);
    } finally {
      setUndoBusy(false);
    }
  };

  const desactualizada = plantilla?.estado === 'desactualizada';

  const phase: Phase = saving ? 'saving' : general || Object.values(errors).some(Boolean) ? 'error' : data && dirtyKeysFor(data, form) ? 'dirty' : 'ok';

  const hasInst = data ? data.rev.institucion !== null : false;
  const logo = form.logo ?? '';
  const logoExt = logo.split('.').pop()?.toLowerCase();

  const renderField = (f: FieldSpec) => {
    const id = `datos-${f.key}`;
    const err = errors[f.key];
    const raw = form[f.key] ?? '';
    let control: React.ReactNode;
    if (f.kind === 'select' || f.kind === 'month') {
      let opts: Option[] = f.kind === 'month' ? [['', '(mes actual)'], ...MESES.map((m): Option => [m, m[0].toUpperCase() + m.slice(1)])] : f.options!;
      let value = raw || f.def || '';
      if (f.key === 'estiloBibliografia') value = BIB_LEGACY[value] ?? value;
      if (f.kind === 'month') value = MESES.find((m) => m === raw.toLowerCase()) ?? raw;
      if (value !== '' && !opts.some(([v]) => v === value)) opts = [...opts, [value, `${value} (personalizado)`]];
      control = (
        <Select id={id} value={value} onChange={(e) => setValue(f.key, e.target.value, true)}>
          {opts.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      );
    } else {
      control = (
        <Input
            id={id}
            value={raw}
            list={f.list ? `${id}-list` : undefined}
            maxLength={f.kind === 'year' ? 4 : undefined}
            inputMode={f.kind === 'year' ? 'numeric' : undefined}
            spellCheck={f.mono ? false : undefined}
            placeholder={f.placeholder}
            onChange={(e) => setValue(f.key, e.target.value)}
            onBlur={queueSave}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={cx(f.mono && 'font-mono')}
          />
      );
    }
    return (
      <div key={f.key} className={cx('min-w-0', f.wide && 'sm:col-span-2')}>
        <Field id={id} label={f.label} help={err ? undefined : f.help} error={err}>
          {control as React.ReactElement}
        </Field>
        {f.list && (
          <datalist id={`${id}-list`}>
            {f.list.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-soft" onKeyDown={onKeyDown}>
      <div className="flex h-(--et-toolbar) shrink-0 items-center gap-2 border-b border-line bg-bg px-3">
        <ClipboardList size={16} className="shrink-0 text-muted" aria-hidden />
        <h1 className="text-ui font-semibold">Datos del trabajo</h1>
        <div className="flex-1" />
        {data && (
          <span
            className="inline-flex items-center gap-1.5 text-sm text-muted"
            title={`${PHASE_LABEL[phase]} · ${kbd('Mod-S')} guarda ahora`}
            aria-label={`Estado: ${PHASE_LABEL[phase]}`}
          >
            <IndicatorMark ind={PHASE_IND[phase]} label={false} />
            <span>{PHASE_LABEL[phase]}</span>
          </span>
        )}
        <Button variant="subtle" size="sm" onClick={() => openFile('memoria', 'datos.tex')} title="Editar el código de datos.tex">
          Abrir datos.tex
        </Button>
      </div>

      {conflict && (
        <Banner
          kind="danger"
          actions={<Button size="sm" onClick={() => setConflict(null)}>Entendido</Button>}
        >
          <span>
            <span>
              Los datos cambiaron en disco mientras editabas y se han cargado los valores nuevos.
              {conflict.length > 0 && (
                <>
                  {' '}
                  No se guardó lo tuyo en:{' '}
                  {conflict.map((c, i) => (
                    <span key={c.key}>
                      {i > 0 && ', '}
                      {LABEL[c.key] ?? c.key} (<span className="font-mono">{c.mine || 'vacío'}</span>)
                    </span>
                  ))}
                  .
                </>
              )}
            </span>
          </span>
        </Banner>
      )}
      {desactualizada && (
        <Banner
          kind="warn"
          actions={
            <Button variant="primary" size="sm" onClick={() => setDlgOpen(true)}>
              <RefreshCw size={14} /> Actualizar…
            </Button>
          }
        >
          Hay una versión nueva de la plantilla ({plantilla.versionMemoria} → {plantilla.versionPlantilla}). Lo que has escrito no se toca.
        </Banner>
      )}
      {resultado && (
        <Banner
          kind="info"
          actions={
            <>
              {resultado.kind === 'ok' && (
                <Button size="sm" onClick={() => void deshacerPlantilla()} disabled={undoBusy} title="Restaura los archivos y revierte el commit">
                  {undoBusy ? <Spinner size={14} /> : <Undo2 size={14} />} Deshacer
                </Button>
              )}
              <Button variant="subtle" size="sm" onClick={() => setResultado(null)}>
                Cerrar
              </Button>
            </>
          }
        >
          {resultado.kind === 'ok' ? (
            <div>
              <span className="text-fg">
                Plantilla actualizada a {resultado.version}: {resultado.res.aplicados.length} archivos
                {resultado.res.commit ? ` · commit ${resultado.res.commit.slice(0, 7)}` : ''}.
              </span>{' '}
              El PDF se recompila a continuación.
              {resultado.res.revisar.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {resultado.res.revisar.map((r) => (
                    <li key={r.archivo + r.motivo}>
                      Revisar a mano <span className="font-mono">{r.archivo}</span>: {r.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            resultado.text
          )}
        </Banner>
      )}
      {general && <Banner kind="danger">{general}</Banner>}
      {loadError && (
        <Banner kind="danger" actions={<Button size="sm" onClick={() => void load()}>Reintentar</Button>}>
          No se pudieron leer los datos: {loadError}
        </Banner>
      )}
      {touched && outdated && !saving && (
        <Banner
          kind="info"
          actions={
            <Button variant="primary" size="sm" onClick={() => void saveAndCompile()} disabled={compiling}>
              {compiling ? <Spinner size={14} /> : <Play size={14} />} Compilar
            </Button>
          }
        >
          Los datos han cambiado: el PDF está desactualizado.
        </Banner>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!data ? (
          !loadError && (
            <div className="flex justify-center py-6 text-muted">
              <Spinner />
            </div>
          )
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <Section title="Trabajo">{TRABAJO.map(renderField)}</Section>
            <Section title="Resumen">{RESUMEN.map(renderField)}</Section>
            <Section title="Documento">{DOCUMENTO.map(renderField)}</Section>
            <Section
              title="Institución"
              note={
                !hasInst &&
                (desactualizada ? (
                  <Banner
                    kind="warn"
                    actions={
                      <Button variant="primary" size="sm" onClick={() => setDlgOpen(true)}>
                        <RefreshCw size={14} /> Actualizar…
                      </Button>
                    }
                  >
                    Hay una versión nueva de la plantilla: al actualizar podrás editar aquí los datos de la institución.
                  </Banner>
                ) : (
                  <Banner kind="warn">Esta memoria usa la plantilla anterior; podrás actualizarla más adelante.</Banner>
                ))
              }
            >
              {hasInst ? (
                <>
                  {INSTITUCION.slice(0, 2).map(renderField)}
                  <div className="min-w-0 sm:col-span-2">
                    <div className="mb-1 text-sm font-bold">Logo</div>
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Fondo blanco fijo: el logo se ve como quedará en el papel. */}
                      <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-white">
                        {!logo ? (
                          <span className="text-sm text-muted">Sin logo</span>
                        ) : logoExt === 'pdf' ? (
                          <object
                            data={`${api.rawUrl('memoria', `estilo/${logo}`)}&v=${data.rev.institucion}#toolbar=0&navpanes=0&view=Fit`}
                            type="application/pdf"
                            className="h-full w-full"
                            aria-label="Vista previa del logo"
                          >
                            <span className="text-sm text-muted">{logo}</span>
                          </object>
                        ) : (
                          <img
                            src={`${api.rawUrl('memoria', `estilo/${logo}`)}&v=${data.rev.institucion}`}
                            alt="Vista previa del logo"
                            className="max-h-full max-w-full object-contain"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm text-muted">{logo ? `estilo/${logo}` : 'Sin logo'}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Button onClick={() => fileInput.current?.click()} disabled={logoBusy}>
                            {logoBusy ? <Spinner size={16} /> : <ImagePlus size={16} />} {logo ? 'Cambiar logo…' : 'Subir logo…'}
                          </Button>
                          {logo && (
                            <Button variant="subtle" onClick={() => void logoAction(() => api.deleteLogo())} disabled={logoBusy}>
                              <Trash2 size={16} /> Quitar
                            </Button>
                          )}
                        </div>
                        <input
                          ref={fileInput}
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) void logoAction(() => api.uploadLogo(f));
                          }}
                        />
                      </div>
                    </div>
                    {errors.logo && (
                      <p className="mt-1 flex items-start gap-1 text-sm text-danger" role="alert">
                        <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
                        <span>{errors.logo}</span>
                      </p>
                    )}
                    <p className="mt-1 text-sm text-muted">PDF, PNG o JPG, máximo 5 MB.</p>
                  </div>
                  {INSTITUCION.slice(2).map(renderField)}
                  <div className="min-w-0 sm:col-span-2">
                    <div className="mb-1 text-sm font-bold">Márgenes</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {MARGENES.map((m) => (
                        <Field key={m.key} id={`datos-${m.key}`} label={m.label} error={errors[m.key]}>
                          <Input
                            value={form[m.key] ?? ''}
                            placeholder={m.placeholder}
                            spellCheck={false}
                            onChange={(e) => setValue(m.key, e.target.value)}
                            onBlur={queueSave}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                            className="font-mono"
                          />
                        </Field>
                      ))}
                    </div>
                    <p className="mt-1 text-sm text-muted">Longitudes de LaTeX, p. ej. 35mm o 2.5cm.</p>
                  </div>
                </>
              ) : (
                <p className="text-ui text-muted sm:col-span-2">Estos datos no se pueden editar en una memoria creada con la plantilla anterior.</p>
              )}
            </Section>
          </div>
        )}
      </div>
      {plantilla && (
        <PlantillaDialog
          open={dlgOpen}
          initial={plantilla}
          hasInst={hasInst}
          onClose={() => setDlgOpen(false)}
          onApply={aplicarPlantilla}
        />
      )}
    </div>
  );
}

const GRUPOS: [AccionPlantilla, string][] = [
  ['crear', 'Se crean'],
  ['sustituir', 'Se sustituyen (no tenían cambios tuyos)'],
  ['editar', 'Se editan en el sitio (se conservan tus valores)'],
  ['retirar', 'Se retiran'],
];

/** Diálogo «Actualizar plantilla» (v0.6): vista previa agrupada y aplicar. */
function PlantillaDialog({
  open,
  initial,
  hasInst,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: PlantillaPreview;
  hasInst: boolean;
  onClose: () => void;
  onApply: (p: PlantillaPreview) => Promise<void>;
}) {
  const [prev, setPrev] = useState(initial);
  const [perfiles, setPerfiles] = useState<Perfil[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setAviso(null);
    setPrev(initialRef.current);
    // Vista previa recién calculada al abrir (la del aviso puede ser antigua).
    setLoading(true);
    api
      .plantilla(initialRef.current.perfil)
      .then((p) => p && setPrev(p))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
    if (!hasInst) {
      api
        .perfiles()
        .then(setPerfiles)
        .catch(() => setPerfiles(null));
    }
  }, [open, hasInst]);

  const changePerfil = async (id: string) => {
    setLoading(true);
    setError(null);
    setAviso(null);
    try {
      const p = await api.plantilla(id);
      if (p) setPrev(p);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      await onApply(prev);
    } catch (e) {
      if (e instanceof PlantillaConflictError) {
        setPrev(e.actual);
        setAviso('La memoria ha cambiado desde la vista previa: revisa la lista y vuelve a pulsar «Actualizar».');
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const grupos = GRUPOS.map(([accion, label]) => [label, prev.cambios.filter((c) => c.accion === accion)] as const).filter(
    ([, l]) => l.length > 0,
  );
  const puede = prev.estado === 'desactualizada' && !loading && !busy;

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Actualizar plantilla"
      labelledBy="plantilla-dlg-title"
      width={600}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void apply()} disabled={!puede}>
            {busy ? <Spinner size={16} /> : <RefreshCw size={16} />} Actualizar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-ui">
        <p className="text-muted">
          {prev.estado === 'desactualizada'
            ? `De la plantilla ${prev.versionMemoria} a la ${prev.versionPlantilla}. Lo que has escrito no se toca: solo se sustituyen los archivos que siguen como los dejó la plantilla.`
            : prev.estado === 'actual'
              ? 'La memoria ya usa la plantilla actual.'
              : 'No se reconoce la clase de esta memoria: no se puede actualizar automáticamente.'}
        </p>

        {!hasInst && perfiles && perfiles.length > 1 && (
          <Field id="plantilla-perfil" label="Perfil de institución" help={perfiles.find((p) => p.id === prev.perfil)?.descripcion || undefined}>
            <Select value={prev.perfil} disabled={loading || busy} onChange={(e) => void changePerfil(e.target.value)}>
              {perfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {aviso && (
          <Banner kind="warn" inline>
            {aviso}
          </Banner>
        )}
        {error && (
          <Banner kind="danger" inline>
            {error}
          </Banner>
        )}

        {loading ? (
          <div className="flex justify-center py-4 text-muted">
            <Spinner />
          </div>
        ) : (
          <>
            {grupos.map(([label, items]) => (
              <section key={label}>
                <h3 className="mb-1 text-ui font-semibold">
                  {label} <span className="font-normal text-muted">({items.length})</span>
                </h3>
                <CambiosList items={items} />
              </section>
            ))}
            {prev.revisar.length > 0 && (
              <section>
                <h3 className="mb-1 text-ui font-semibold text-warn">
                  Revisar a mano <span className="font-normal text-muted">({prev.revisar.length})</span>
                </h3>
                <CambiosList items={prev.revisar} />
              </section>
            )}
            {prev.estado === 'desactualizada' && (
              <p className="text-sm text-muted">
                Antes se guarda todo lo abierto. Cada archivo se copia al historial y, si la memoria es un repositorio git, se hace un commit
                solo con estos archivos. Después se recompila el PDF y puedes deshacerlo.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function CambiosList({ items }: { items: { archivo: string; motivo: string }[] | CambioPlantilla[] }) {
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {items.map((c) => (
        <li key={c.archivo + c.motivo} className="flex flex-col gap-0.5 px-2 py-1.5 sm:flex-row sm:gap-3">
          <span className="shrink-0 font-mono text-sm sm:w-56 sm:truncate" title={c.archivo}>
            {c.archivo}
          </span>
          <span className="min-w-0 text-muted">{c.motivo}</span>
        </li>
      ))}
    </ul>
  );
}

function dirtyKeysFor(d: DatosResponse, form: Record<string, string>): boolean {
  const base = flat(d);
  return ALL_KEYS.some((k) => !(INST_KEYS.has(k) && d.rev.institucion === null) && (form[k] ?? '') !== (base[k] ?? ''));
}
