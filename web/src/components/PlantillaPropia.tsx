import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Upload } from 'lucide-react';
import { api, errorMessage, type ProyectoPropio, type SettingsResponse } from '../api';
import { Button, Modal, Spinner } from './ui';
import { DirPicker } from './DirPicker';
import { parentAbs } from '../lib/abspath';

export function PlantillaPropia({ settings, onClose, onUsed }: {
  settings: SettingsResponse;
  onClose: () => void;
  onUsed: (result: SettingsResponse) => Promise<void>;
}) {
  const [preview, setPreview] = useState<ProyectoPropio | null>(null);
  const [dir, setDir] = useState('');
  const [zip, setZip] = useState('');
  const [main, setMain] = useState('');
  const [destino, setDestino] = useState('');
  const [picker, setPicker] = useState<'origen' | 'destino' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const pending = useRef<string | undefined>(undefined);
  useEffect(() => () => { if (pending.current) void api.descartarPlantilla(pending.current).catch(() => undefined); }, []);
  const accept = async (result: ProyectoPropio) => {
    if (pending.current) await api.descartarPlantilla(pending.current);
    pending.current = result.id;
    setPreview(result); setMain(result.principal ?? ''); setDestino('');
  };
  const inspect = async (folder: string) => {
    setBusy(true); setError(null);
    try {
      const result = await api.inspeccionarProyecto(folder);
      await accept(result); setDir(folder); setZip(''); setPicker(null);
    } catch (e) { setPicker(null); setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const receive = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const result = await api.subirPlantilla(file);
      await accept(result); setDir(''); setZip(file.name);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); if (upload.current) upload.current.value = ''; }
  };
  const use = async () => {
    if (!main || !preview || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await api.usarPlantilla({ main, dir: preview.id ? destino : dir, id: preview.id });
      pending.current = undefined;
      await onUsed(result);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const selected = preview?.archivos.find((file) => file.path === main);
  return <>
    <Modal open title="Usar una plantilla propia" width={640} onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <Button size="md" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button size="md" variant="primary" disabled={busy || !main || (!!preview?.id && !destino)} onClick={() => void use()}>
          {busy && <Spinner />} {preview?.id ? 'Importar y abrir' : 'Abrir proyecto'}
        </Button>
      </>}>
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap gap-3">
          <Button size="md" disabled={busy} onClick={() => { setError(null); setPicker('origen'); }}><FolderOpen size={15} />Elegir carpeta…</Button>
          <Button size="md" disabled={busy} onClick={() => upload.current?.click()}><Upload size={15} />Elegir ZIP…</Button>
          <input ref={upload} type="file" accept=".zip,application/zip" className="hidden" aria-label="Archivo ZIP de la plantilla"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void receive(file); }} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {preview && <>
          <dl className="space-y-2 rounded-md border border-line p-3 text-sm">
            <dt className="font-medium">{zip ? 'ZIP' : 'Carpeta del proyecto'}</dt>
            <dd className="break-all">{zip || dir}</dd>
          </dl>
          <div className="space-y-2">
            <label htmlFor="plantilla-principal" className="block text-sm font-medium">Archivo principal</label>
            <select id="plantilla-principal" value={main} disabled={busy} onChange={(e) => setMain(e.target.value)}
              className="h-9 w-full min-w-0 rounded-md border border-line-strong bg-bg px-2 text-sm outline-none focus:border-accent">
              <option value="">Selecciona un archivo .tex</option>
              {preview.archivos.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
            </select>
          </div>
          {selected && <dl className="space-y-1 text-sm">
            <dt className="font-medium">Edición del formato</dt>
            <dd>{selected.compatible ? 'Visual' : 'Código LaTeX'}</dd>
          </dl>}
          {preview.id && <div className="space-y-2">
            <h3 className="text-sm font-medium">Nueva carpeta de la memoria</h3>
            {destino && <p className="break-all rounded-md border border-line p-3 text-sm">{destino}</p>}
            <Button size="md" disabled={busy} onClick={() => setPicker('destino')}>Elegir ubicación…</Button>
          </div>}
        </>}
      </div>
    </Modal>
    {picker && <DirPicker open onClose={() => { if (!busy) setPicker(null); }} title={picker === 'origen' ? 'Carpeta de la plantilla' : 'Guardar la plantilla importada'}
      mode={picker === 'origen' ? 'select' : 'create'} allowedRoots={settings.allowedRoots} pathSep={settings.pathSep}
      selectLabel={picker === 'origen' ? 'Usar esta carpeta' : 'Usar esta ubicación'}
      initialPath={parentAbs(settings.values.memoriaDir, settings.pathSep) || undefined} defaultName="mi-memoria"
      busy={busy} onSelect={picker === 'origen' ? inspect : (folder) => { setDestino(folder); setPicker(null); }} />}
  </>;
}
