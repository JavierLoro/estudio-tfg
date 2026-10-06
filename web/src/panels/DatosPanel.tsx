// Panel «Datos del trabajo» (v0.5): edita datos.tex y estilo/institucion.tex sin tocar el código.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ClipboardList, ImagePlus, Play, Trash2 } from 'lucide-react';
import {
  api,
  DatosConflictError,
  errorMessage,
  FieldError,
  type DatosChanges,
  type DatosResponse,
} from '../api';
import { indicatorColor } from '../components/DocBanners';
import { Banner, Button, MOD, Spinner, cx } from '../components/ui';
import { useCompile, isPdfOutdated } from '../state/compile';
import { onFileChange } from '../state/events';
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

const inputCls =
  'h-7 min-w-0 w-full rounded-md border bg-bg px-2 text-[12.5px] outline-none focus:border-accent disabled:opacity-60';

type Phase = 'ok' | 'dirty' | 'saving' | 'error';
const PHASE_LABEL: Record<Phase, string> = { ok: 'Guardado', dirty: 'Sin guardar', saving: 'Guardando…', error: 'Error' };
const PHASE_IND = { ok: 'guardado', dirty: 'sin guardar', saving: 'guardando', error: 'error' } as const;

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-bg">
      <header className="flex h-8 items-center border-b border-line px-3 text-[12px] font-semibold">{title}</header>
      {note}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 px-3 py-3 sm:grid-cols-2">{children}</div>
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

  useEffect(() => {
    void load();
  }, [load]);

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
        <select
          id={id}
          value={value}
          onChange={(e) => setValue(f.key, e.target.value, true)}
          className={cx(inputCls, err ? 'border-danger' : 'border-line-strong')}
          aria-invalid={!!err}
        >
          {opts.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      );
    } else {
      control = (
        <>
          <input
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
            className={cx(inputCls, f.mono && 'font-mono text-[12px]', err ? 'border-danger' : 'border-line-strong')}
            aria-invalid={!!err}
          />
          {f.list && (
            <datalist id={`${id}-list`}>
              {f.list.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
        </>
      );
    }
    return (
      <div key={f.key} className={cx('min-w-0', f.wide && 'sm:col-span-2')}>
        <label htmlFor={id} className="mb-1 block text-[12px] font-medium">
          {f.label}
        </label>
        {control}
        {err && (
          <p className="mt-1 text-[12px] text-danger" role="alert">
            {err}
          </p>
        )}
        {f.help && !err && <p className="mt-1 text-[11px] text-faint">{f.help}</p>}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-soft" onKeyDown={onKeyDown}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-bg px-3">
        <ClipboardList size={15} className="text-muted" />
        <h1 className="text-[13px] font-semibold">Datos del trabajo</h1>
        <div className="flex-1" />
        {data && (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-muted"
            title={`${PHASE_LABEL[phase]} · ${MOD}S guarda ahora`}
            aria-label={`Estado: ${PHASE_LABEL[phase]}`}
          >
            {phase === 'saving' ? <Spinner size={9} /> : <span className={cx('inline-block h-2 w-2 rounded-full', indicatorColor(PHASE_IND[phase]))} />}
            <span>{PHASE_LABEL[phase]}</span>
          </span>
        )}
        <Button variant="ghost" onClick={() => openFile('memoria', 'datos.tex')} title="Editar el código de datos.tex">
          Abrir datos.tex
        </Button>
      </div>

      {conflict && (
        <Banner
          kind="danger"
          actions={<Button onClick={() => setConflict(null)}>Entendido</Button>}
        >
          <span className="inline-flex items-start gap-1.5">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
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
      {general && <Banner kind="danger">{general}</Banner>}
      {loadError && (
        <Banner kind="danger" actions={<Button onClick={() => void load()}>Reintentar</Button>}>
          No se pudieron leer los datos: {loadError}
        </Banner>
      )}
      {touched && outdated && !saving && (
        <Banner
          kind="info"
          actions={
            <Button variant="primary" onClick={() => void saveAndCompile()} disabled={compiling}>
              {compiling ? <Spinner size={11} /> : <Play size={12} />} Compilar
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
                !hasInst && (
                  <p className="border-b border-line bg-warn-bg px-3 py-2 text-[12px] text-warn">
                    Esta memoria usa la plantilla anterior; podrás actualizarla más adelante.
                  </p>
                )
              }
            >
              {hasInst ? (
                <>
                  {INSTITUCION.slice(0, 2).map(renderField)}
                  <div className="min-w-0 sm:col-span-2">
                    <div className="mb-1 text-[12px] font-medium">Logo</div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-white">
                        {!logo ? (
                          <span className="text-[11px] text-faint">Sin logo</span>
                        ) : logoExt === 'pdf' ? (
                          <object
                            data={`${api.rawUrl('memoria', `estilo/${logo}`)}&v=${data.rev.institucion}#toolbar=0&navpanes=0&view=Fit`}
                            type="application/pdf"
                            className="h-full w-full"
                            aria-label="Vista previa del logo"
                          >
                            <span className="text-[11px] text-faint">{logo}</span>
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
                        <p className="truncate font-mono text-[11.5px] text-muted">{logo ? `estilo/${logo}` : 'Sin logo'}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Button onClick={() => fileInput.current?.click()} disabled={logoBusy}>
                            {logoBusy ? <Spinner size={11} /> : <ImagePlus size={12} />} {logo ? 'Cambiar logo…' : 'Subir logo…'}
                          </Button>
                          {logo && (
                            <Button variant="ghost" onClick={() => void logoAction(() => api.deleteLogo())} disabled={logoBusy}>
                              <Trash2 size={12} /> Quitar
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
                      <p className="mt-1 text-[12px] text-danger" role="alert">
                        {errors.logo}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-faint">PDF, PNG o JPG, máximo 5 MB.</p>
                  </div>
                  {INSTITUCION.slice(2).map(renderField)}
                  <div className="min-w-0 sm:col-span-2">
                    <div className="mb-1 text-[12px] font-medium">Márgenes</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {MARGENES.map((m) => (
                        <div key={m.key}>
                          <label htmlFor={`datos-${m.key}`} className="mb-0.5 block text-[11px] text-muted">
                            {m.label}
                          </label>
                          <input
                            id={`datos-${m.key}`}
                            value={form[m.key] ?? ''}
                            placeholder={m.placeholder}
                            spellCheck={false}
                            onChange={(e) => setValue(m.key, e.target.value)}
                            onBlur={queueSave}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                            className={cx(inputCls, 'font-mono text-[12px]', errors[m.key] ? 'border-danger' : 'border-line-strong')}
                            aria-invalid={!!errors[m.key]}
                          />
                          {errors[m.key] && (
                            <p className="mt-1 text-[12px] text-danger" role="alert">
                              {errors[m.key]}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-faint">Longitudes de LaTeX, p. ej. 35mm o 2.5cm.</p>
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-faint sm:col-span-2">Estos datos no se pueden editar en una memoria creada con la plantilla anterior.</p>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function dirtyKeysFor(d: DatosResponse, form: Record<string, string>): boolean {
  const base = flat(d);
  return ALL_KEYS.some((k) => !(INST_KEYS.has(k) && d.rev.institucion === null) && (form[k] ?? '') !== (base[k] ?? ''));
}
