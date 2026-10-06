import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, FolderOpen, FolderPlus, RotateCcw, Save, Settings } from 'lucide-react';
import {
  api,
  errorMessage,
  FieldError,
  SETTINGS_KEYS,
  type SettingsCheck,
  type SettingsKey,
  type SettingsResponse,
  type SettingsSource,
  type SettingsValues,
} from '../api';
import { DirPicker, joinAbs } from '../components/DirPicker';
import { Banner, Button, Spinner, cx } from '../components/ui';
import { notifySettingsChanged, useSettings } from '../state/settings';
import { toast, useUI } from '../state/ui';

const LABELS: Record<SettingsKey, string> = {
  notesDir: 'Carpeta de notas (vault)',
  resourcesSubdir: 'Subcarpeta de recursos',
  memoriaDir: 'Carpeta de la memoria',
  memoriaMain: 'Archivo principal',
};

const HELP: Record<SettingsKey, string> = {
  notesDir: 'Carpeta con tus notas Markdown (puede ser una subcarpeta de un vault de Obsidian).',
  resourcesSubdir: 'Dentro de la carpeta de notas. Se crea si no existe.',
  memoriaDir: 'Carpeta del proyecto LaTeX de la memoria.',
  memoriaMain: 'Archivo .tex que se compila, en la raíz de la memoria.',
};

const SOURCE_LABEL: Record<SettingsSource, string> = {
  settings: 'Ajustes',
  env: '.env',
  default: 'Por defecto',
};

const SOURCE_TITLE: Record<SettingsSource, string> = {
  settings: 'Guardado desde esta pantalla (data/settings.json)',
  env: 'Valor inicial del archivo .env del servidor',
  default: 'Valor por defecto',
};

const inputCls =
  'h-7 min-w-0 flex-1 rounded-md border bg-bg px-2 font-mono text-[12px] outline-none focus:border-accent disabled:opacity-60';

function LevelIcon({ level, size = 13 }: { level: SettingsCheck['level']; size?: number }) {
  if (level === 'ok') return <CheckCircle2 size={size} className="shrink-0 text-ok" />;
  if (level === 'warning') return <AlertTriangle size={size} className="shrink-0 text-warn" />;
  return <AlertCircle size={size} className="shrink-0 text-danger" />;
}

function levelText(level: SettingsCheck['level']) {
  return level === 'ok' ? 'text-muted' : level === 'warning' ? 'text-warn' : 'text-danger';
}

type Picker = { kind: 'dir'; key: 'notesDir' | 'memoriaDir' | 'resourcesSubdir' } | { kind: 'create' } | null;

const isAbs = (p: string) => p.startsWith('/') || p.startsWith('~');
const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

export function SettingsPanel() {
  const data = useSettings((s) => s.data);
  const loadError = useSettings((s) => s.error);
  const loading = useSettings((s) => s.loading);
  const status = useUI((s) => s.status);
  const memoriaTree = useUI((s) => s.trees.memoria);
  const memoriaTreeError = useUI((s) => s.treeErrors.memoria);

  const [form, setForm] = useState<SettingsValues | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SettingsKey, string>>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState<SettingsKey | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [creating, setCreating] = useState(false);
  const baseline = useRef<SettingsValues | null>(null);
  /** Ruta real de la carpeta de notas (el selector devuelve rutas reales). */
  const [notesReal, setNotesReal] = useState<string | null>(null);

  useEffect(() => {
    void useSettings.getState().load();
  }, []);

  // Al llegar datos nuevos, actualizar los campos que el usuario no ha tocado.
  useEffect(() => {
    if (!data) return;
    const prev = baseline.current;
    baseline.current = data.values;
    setForm((f) => {
      if (!f || !prev) return { ...data.values };
      const next = { ...f };
      for (const k of SETTINGS_KEYS) if (f[k] === prev[k]) next[k] = data.values[k];
      return next;
    });
  }, [data]);

  const dirtyKeys = useMemo(
    () => (form && data ? SETTINGS_KEYS.filter((k) => form[k].trim() !== data.values[k]) : []),
    [form, data],
  );
  const dirty = dirtyKeys.length > 0;
  const memoriaDirChanged = dirtyKeys.includes('memoriaDir');

  const texFiles = useMemo(
    () => (memoriaTree ?? []).filter((e) => e.type === 'file' && /\.tex$/i.test(e.name)).map((e) => e.path),
    [memoriaTree],
  );

  const setField = (k: SettingsKey, v: string) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setFieldErrors((e) => ({ ...e, [k]: undefined }));
  };

  const save = async () => {
    if (!form || !data || !dirty || saving) return;
    const body: Partial<SettingsValues> = {};
    for (const k of dirtyKeys) body[k] = form[k].trim();
    setSaving(true);
    setGeneralError(null);
    setFieldErrors({});
    try {
      const r = await api.saveSettings(body);
      baseline.current = r.values;
      setForm({ ...r.values });
      await notifySettingsChanged(r);
    } catch (e) {
      if (e instanceof FieldError && (SETTINGS_KEYS as readonly string[]).includes(e.field)) {
        setFieldErrors({ [e.field as SettingsKey]: e.message });
      } else {
        setGeneralError(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = async (k: SettingsKey) => {
    setResetting(k);
    setGeneralError(null);
    try {
      const r = await api.resetSettings([k]);
      // Volver al valor de .env/defecto (de la respuesta: `data` puede estar ya desfasado por SSE).
      setFieldErrors((e) => ({ ...e, [k]: undefined }));
      if (r?.values && r.sources) {
        const v = r.values[k];
        setForm((f) => (f ? { ...f, [k]: v } : f));
        await notifySettingsChanged(r as SettingsResponse);
      } else {
        await useSettings.getState().load();
        const d = useSettings.getState().data;
        if (d) setForm((f) => (f ? { ...f, [k]: d.values[k] } : f));
        await notifySettingsChanged();
      }
    } catch (e) {
      setGeneralError(errorMessage(e));
    } finally {
      setResetting(null);
    }
  };

  const discard = () => {
    if (data) setForm({ ...data.values });
    setFieldErrors({});
    setGeneralError(null);
  };

  const createMemoria = async (dir: string) => {
    setCreating(true);
    try {
      const r = await api.initMemoria(dir);
      setPicker(null);
      setFieldErrors((e) => ({ ...e, memoriaDir: undefined, memoriaMain: undefined }));
      // La memoria nueva sustituye a lo que hubiera en esos campos.
      if (r?.values && r.sources) {
        baseline.current = r.values;
        setForm((f) => (f ? { ...f, memoriaDir: r.values!.memoriaDir, memoriaMain: r.values!.memoriaMain } : f));
        await notifySettingsChanged(r as SettingsResponse);
      } else {
        await useSettings.getState().load();
        const d = useSettings.getState().data;
        if (d) setForm((f) => (f ? { ...f, memoriaDir: d.values.memoriaDir, memoriaMain: d.values.memoriaMain } : f));
        await notifySettingsChanged();
      }
      toast({ kind: 'ok', text: `Memoria creada en ${dir}` });
    } catch (e) {
      toast({ kind: 'error', text: `No se pudo crear la memoria: ${errorMessage(e)}` });
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      void save();
    }
  };

  const checks = data?.checks ?? [];
  const errorChecks = checks.filter((c) => c.level === 'error');
  const allowedRoots = data?.allowedRoots ?? [];

  // ---- Selector de carpetas ----
  const notesBase = form ? trimSlash(form.notesDir.trim()) : '';
  const relToNotes = (p: string): string | null => {
    for (const base of [notesReal, notesBase]) {
      if (base && p.startsWith(base + '/')) return p.slice(base.length + 1);
    }
    return null;
  };
  const openResourcesPicker = async () => {
    setNotesReal(null);
    try {
      const r = await api.fsDirs(notesBase);
      setNotesReal(r.path);
    } catch {
      /* se valida con la ruta escrita */
    }
    setPicker({ kind: 'dir', key: 'resourcesSubdir' });
  };
  const pickerProps = (() => {
    if (!picker || !form) return null;
    if (picker.kind === 'create') {
      return {
        title: 'Crear memoria desde la plantilla',
        mode: 'create' as const,
        initialPath: isAbs(form.memoriaDir) ? form.memoriaDir.replace(/\/[^/]+\/?$/, '') || undefined : undefined,
        defaultName: 'tfg-memoria',
        hint: 'Elige la carpeta donde crearla y escribe el nombre de la carpeta nueva (o déjalo vacío para usar una carpeta vacía existente). Se copiará la plantilla y se iniciará un repositorio git.',
        busy: creating,
        onSelect: (p: string) => createMemoria(p),
      };
    }
    const key = picker.key;
    if (key === 'resourcesSubdir') {
      return {
        title: LABELS.resourcesSubdir,
        mode: 'select' as const,
        initialPath: notesBase && form.resourcesSubdir.trim() ? joinAbs(notesReal ?? notesBase, form.resourcesSubdir.trim()) : notesReal ?? (notesBase || undefined),
        hint: `Debe estar dentro de la carpeta de notas (${notesBase || 'sin definir'}).`,
        validate: (p: string) => (relToNotes(p) ? null : 'Elige una subcarpeta de la carpeta de notas'),
        onSelect: (p: string) => {
          const rel = relToNotes(p);
          if (rel) setField('resourcesSubdir', rel);
          setPicker(null);
        },
      };
    }
    return {
      title: LABELS[key],
      mode: 'select' as const,
      initialPath: form[key].trim() || undefined,
      onSelect: (p: string) => {
        setField(key, p);
        setPicker(null);
      },
    };
  })();

  return (
    <div className="flex h-full flex-col bg-soft" onKeyDown={onKeyDown}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-bg px-3">
        <Settings size={15} className="text-muted" />
        <h1 className="text-[13px] font-semibold">Ajustes</h1>
        {loading && <Spinner size={11} />}
        <div className="flex-1" />
        {dirty && (
          <span className="flex items-center gap-1.5 text-[12px] text-warn">
            <span className="h-2 w-2 rounded-full bg-warn" /> Cambios sin guardar
          </span>
        )}
        <Button variant="ghost" onClick={discard} disabled={!dirty || saving}>
          Descartar
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving} title="Guardar y aplicar (⌘S)">
          {saving ? <Spinner size={11} /> : <Save size={12} />} Guardar
        </Button>
      </div>

      {status?.configured === false && (
        <Banner kind="warn">
          <strong>Falta configurar Estudio TFG.</strong>{' '}
          {errorChecks.length
            ? errorChecks.map((c) => c.message.replace(/[.\s]*$/, '.')).join(' ')
            : 'La carpeta de notas o la de la memoria no existen.'}{' '}
          Elige la carpeta de notas (tu vault) y la de la memoria; si aún no tienes memoria, créala desde la plantilla.
        </Banner>
      )}
      {generalError && <Banner kind="danger">{generalError}</Banner>}
      {loadError && !data && (
        <Banner kind="danger" actions={<Button onClick={() => void useSettings.getState().load()}>Reintentar</Button>}>
          No se pudieron leer los ajustes: {loadError}
        </Banner>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!data || !form ? (
          !loadError && (
            <div className="flex justify-center py-6 text-muted">
              <Spinner />
            </div>
          )
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <section className="rounded-lg border border-line bg-bg">
              <header className="flex h-8 items-center border-b border-line px-3 text-[12px] font-semibold">Carpetas</header>
              <div className="divide-y divide-line">
                {SETTINGS_KEYS.map((k) => {
                  const source = data.sources[k];
                  const changed = dirtyKeys.includes(k);
                  const err = fieldErrors[k];
                  const fieldChecks = checks.filter((c) => c.key === k && c.level !== 'ok');
                  const id = `setting-${k}`;
                  return (
                    <div key={k} className="px-3 py-2.5">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <label htmlFor={id} className="text-[12.5px] font-medium">
                          {LABELS[k]}
                        </label>
                        {source && (
                          <span
                            title={SOURCE_TITLE[source]}
                            className={cx(
                              'rounded border px-1 text-[10.5px] leading-4',
                              source === 'settings' ? 'border-accent/40 bg-active text-accent' : 'border-line bg-soft text-muted',
                            )}
                          >
                            {SOURCE_LABEL[source] ?? source}
                          </span>
                        )}
                        {changed && <span className="text-[11px] text-warn">modificado</span>}
                        <div className="flex-1" />
                        {source === 'settings' && (
                          <Button
                            variant="ghost"
                            onClick={() => void reset(k)}
                            disabled={resetting === k || saving}
                            title="Quitar de los ajustes y volver al valor de .env o por defecto"
                          >
                            {resetting === k ? <Spinner size={11} /> : <RotateCcw size={12} />} Restablecer
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {k === 'memoriaMain' && !memoriaDirChanged && !memoriaTreeError && memoriaTree ? (
                          <select
                            id={id}
                            value={form.memoriaMain}
                            onChange={(e) => setField('memoriaMain', e.target.value)}
                            className={cx(inputCls, err ? 'border-danger' : 'border-line-strong')}
                            aria-invalid={!!err}
                          >
                            {!texFiles.includes(form.memoriaMain) && (
                              <option value={form.memoriaMain}>{form.memoriaMain || '(sin definir)'} — no encontrado</option>
                            )}
                            {texFiles.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={id}
                            value={form[k]}
                            onChange={(e) => setField(k, e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && void save()}
                            spellCheck={false}
                            placeholder={k === 'memoriaMain' ? 'main.tex' : k === 'resourcesSubdir' ? 'Recursos' : '/ruta/absoluta o ~/…'}
                            className={cx(inputCls, err ? 'border-danger' : 'border-line-strong')}
                            aria-invalid={!!err}
                          />
                        )}
                        {k !== 'memoriaMain' && (
                          <Button
                            onClick={() => (k === 'resourcesSubdir' ? void openResourcesPicker() : setPicker({ kind: 'dir', key: k }))}
                            disabled={k === 'resourcesSubdir' && !isAbs(notesBase)}
                            title={k === 'resourcesSubdir' && !isAbs(notesBase) ? 'Define antes la carpeta de notas' : 'Elegir carpeta'}
                          >
                            <FolderOpen size={12} /> Elegir…
                          </Button>
                        )}
                      </div>
                      {err && <p className="mt-1 text-[12px] text-danger" role="alert">{err}</p>}
                      {changed && (
                        <p className="mt-1 truncate text-[11px] text-faint" title={data.values[k]}>
                          Valor actual: <span className="font-mono">{data.values[k] || '(vacío)'}</span>
                        </p>
                      )}
                      {k === 'memoriaMain' && memoriaDirChanged && (
                        <p className="mt-1 text-[11px] text-faint">La carpeta de la memoria ha cambiado: escribe el nombre del archivo principal.</p>
                      )}
                      {!changed &&
                        fieldChecks.map((c, i) => (
                          <p key={i} className={cx('mt-1 flex items-start gap-1 text-[12px]', levelText(c.level))}>
                            <LevelIcon level={c.level} size={12} />
                            <span>{c.message}</span>
                          </p>
                        ))}
                      <p className="mt-1 text-[11px] text-faint">{HELP[k]}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-line bg-bg">
              <header className="flex h-8 items-center gap-2 border-b border-line px-3 text-[12px] font-semibold">
                <span className="flex-1">Memoria nueva</span>
              </header>
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-[12px] text-muted">
                <p className="min-w-0 flex-[1_1_16rem]">
                  Crea una carpeta con la plantilla de la memoria (UCLM-ESI), inicia un repositorio git y la usa como carpeta de la memoria.
                </p>
                <Button onClick={() => setPicker({ kind: 'create' })} disabled={creating}>
                  <FolderPlus size={12} /> Crear memoria desde la plantilla
                </Button>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-bg">
              <header className="flex h-8 items-center border-b border-line px-3 text-[12px] font-semibold">Comprobaciones</header>
              {checks.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-faint">Sin comprobaciones.</p>
              ) : (
                <ul className="py-1">
                  {checks.map((c, i) => (
                    <li key={i} className={cx('flex items-start gap-2 px-3 py-1 text-[12px]', levelText(c.level))}>
                      <LevelIcon level={c.level} />
                      <span className="min-w-0 flex-1">
                        {c.key in LABELS && <span className="font-medium text-fg">{LABELS[c.key as SettingsKey]}: </span>}
                        {c.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {allowedRoots.length > 0 && (
              <p className="px-1 text-[11.5px] text-faint">
                Carpetas permitidas: <span className="font-mono">{allowedRoots.join(' · ')}</span>. Los cambios se aplican al guardar, sin reiniciar el servidor.
              </p>
            )}
          </div>
        )}
      </div>

      {pickerProps && (
        <DirPicker
          open
          onClose={() => !creating && setPicker(null)}
          allowedRoots={allowedRoots}
          {...pickerProps}
        />
      )}
    </div>
  );
}
