import { useEffect, useState } from 'react';
import { api, errorMessage, type Perfil } from '../api';
import { useDesktop } from '../state/desktop';
import { notifySettingsChanged, useSettings } from '../state/settings';
import { useUI } from '../state/ui';
import { useCompile } from '../state/compile';
import { openSettings, openPdf } from '../state/workspace';
import { parentAbs } from '../lib/abspath';
import { DirPicker } from './DirPicker';
import { Banner, Button, Modal, Spinner } from './ui';

type Picker = { root: 'notes' | 'memoria'; create: boolean };
const phases = { idle: 'Por preparar', copying: 'Leyendo el paquete incluido…', downloading: 'Descargando TeX…',
  extracting: 'Preparando archivos…', publishing: 'Activando el motor…', ready: 'TeX preparado', cancelled: 'Preparación cancelada', error: 'No se pudo preparar TeX' };

export default function DesktopSetup() {
  const info = useDesktop(s => s.info);
  const open = useDesktop(s => s.open);
  const ready = useSettings(s => s.ready);
  const settings = useSettings(s => s.data);
  const configured = useUI(s => s.status?.configured);
  const [step, setStep] = useState(0);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [perfil, setPerfil] = useState('generico');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compiled, setCompiled] = useState(false);

  useEffect(() => {
    if (!ready) return;
    void useDesktop.getState().refresh().then(value => {
      if (value?.needsSetup) useDesktop.getState().setOpen(true);
    }).catch(() => {});
  }, [ready]);
  useEffect(() => {
    if (!open) return;
    useUI.setState({ settingsOpen: false });
    setStep(0); setCompiled(false); setError(null);
    void useSettings.getState().load();
    void api.perfiles().then(value => setPerfiles(value ?? [])).catch(error => setError(errorMessage(error)));
    const interval = setInterval(() => void useDesktop.getState().refresh().catch(() => {}), 500);
    return () => clearInterval(interval);
  }, [open]);
  if (!info || !settings) return null;

  const engine = info.engine;
  const preparing = ['copying', 'downloading', 'extracting', 'publishing'].includes(engine.phase);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await useDesktop.getState().refresh(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const close = () => { if (!busy && !preparing) useDesktop.getState().setOpen(false); };
  const select = async (dir: string) => {
    if (!picker) return;
    await act(async () => {
      const result = picker.create
        ? await (picker.root === 'notes' ? api.initNotes(dir) : api.initMemoria(dir, perfil))
        : await api.saveSettings({ [picker.root === 'notes' ? 'notesDir' : 'memoriaDir']: dir });
      await notifySettingsChanged(result as Parameters<typeof notifySettingsChanged>[0]);
      setCompiled(false); setPicker(null);
    });
  };
  const compile = () => act(async () => {
    await api.saveSettings({ compileEngine: 'local' });
    const result = await useCompile.getState().compile();
    if (!result?.ok) throw new Error(useCompile.getState().error ?? result?.diagnostics.map(d => d.message).join('\n') ?? 'No se pudo compilar la memoria');
    setCompiled(true);
    openPdf();
  });

  return <>
    <Modal open={open} title="Preparar Estudio TFG" onClose={close} width={620} footer={<>
      <Button onClick={close} disabled={busy || preparing}>Más tarde</Button>
      {step > 0 && <Button onClick={() => setStep(step - 1)} disabled={busy || preparing}>Atrás</Button>}
      {step < 2 ? <Button variant="primary" onClick={() => setStep(step + 1)} disabled={busy || preparing || (step === 0 ? !configured : !engine.current)}>Continuar</Button>
        : <Button variant="primary" disabled={!compiled || busy} onClick={() => void act(async () => {
          await api.completeDesktopSetup(); useDesktop.getState().setOpen(false);
        })}>Terminar</Button>}
    </>}>
      <div className="space-y-4 p-4 text-[13px]">
        <p className="text-muted" aria-live="polite">Paso {step + 1} de 3 · {['Tus carpetas', 'Motor de compilación', 'Primer PDF'][step]}</p>
        {error && <Banner kind="danger">{error}</Banner>}
        {step === 0 && <>
          <p>Elige tus notas de Obsidian y la memoria. Si empiezas de cero, crea carpetas nuevas desde aquí.</p>
          {(['notes', 'memoria'] as const).map(root => <section key={root} className="space-y-2 rounded-lg border border-line p-3">
            <h2 className="font-semibold">{root === 'notes' ? 'Notas y biblioteca' : 'Memoria LaTeX'}</h2>
            <p className="break-all text-muted">{settings.values[root === 'notes' ? 'notesDir' : 'memoriaDir']}</p>
            {root === 'memoria' && <label className="flex items-center gap-2">Plantilla
              <select aria-label="Perfil de institución" value={perfil} onChange={e => setPerfil(e.target.value)} className="rounded border border-line bg-bg px-2 py-1">
                {perfiles.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>}
            <div className="flex gap-2"><Button onClick={() => setPicker({ root, create: false })}>Elegir carpeta de {root === 'notes' ? 'notas' : 'memoria'}</Button>
              <Button onClick={() => setPicker({ root, create: true })}>{root === 'notes' ? 'Crear carpeta de notas' : 'Crear memoria'}</Button></div>
          </section>)}
        </>}
        {step === 1 && <>
          <p>{engine.variant === 'offline' ? 'Esta versión incluye TeX. Lo prepararemos en la carpeta privada de la app, sin descargar nada.'
            : `Esta versión descargará TeX (${Math.ceil(engine.total / 1_000_000)} MB) una sola vez. Después podrás compilar sin conexión.`}</p>
          <p>La memoria se compila en tu equipo. No se envía a un servicio remoto ni necesitas instalar TeX, Perl o Docker.</p>
          <p role="status">{phases[engine.phase]}{engine.current && ' ✓'}</p>
          {preparing && <progress aria-label="Preparación de TeX" className="w-full" max={engine.total || 1} value={engine.received} />}
          {engine.message && <Banner kind="warn">{engine.message}</Banner>}
          {!engine.available && <Banner kind="warn">Esta ejecución de desarrollo no incluye el paquete. Puedes configurar un motor externo en Ajustes.</Banner>}
          {preparing ? <Button onClick={() => void act(api.cancelDesktopEngine)} disabled={busy}>Cancelar preparación</Button>
            : <Button variant="primary" onClick={() => void act(api.prepareDesktopEngine)} disabled={!engine.available || engine.current || busy}>{engine.phase === 'error' || engine.phase === 'cancelled' ? 'Reintentar' : 'Preparar TeX'}</Button>}
          <Button variant="ghost" onClick={() => { close(); openSettings(); }} disabled={busy || preparing}>Opciones avanzadas: Docker o TeX externo</Button>
        </>}
        {step === 2 && <>
          <p>Comprueba que todo está listo generando el primer PDF. Puedes volver a este asistente desde Ajustes.</p>
          <Button variant="primary" onClick={() => void compile()} disabled={busy}>{busy && <Spinner />}Compilar primera memoria</Button>
          {compiled && <Banner kind="info">PDF generado. Ya puedes empezar a escribir.</Banner>}
        </>}
      </div>
    </Modal>
    {picker && <DirPicker open title={picker.root === 'notes' ? 'Carpeta de notas' : 'Carpeta de la memoria'}
      allowedRoots={settings.allowedRoots} pathSep={settings.pathSep} mode={picker.create ? 'create' : 'select'}
      selectLabel={picker.create && picker.root === 'notes' ? 'Crear notas aquí' : undefined}
      initialPath={parentAbs(settings.values[picker.root === 'notes' ? 'notesDir' : 'memoriaDir'], settings.pathSep) ?? undefined}
      defaultName={picker.root === 'notes' ? 'Notas' : 'Memoria'} busy={busy} onClose={() => !busy && setPicker(null)} onSelect={select} />}
  </>;
}
