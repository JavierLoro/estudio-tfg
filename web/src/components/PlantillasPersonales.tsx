import { useEffect, useState } from 'react';
import { json, errorMessage, type SettingsResponse, type NuevaMemoriaConfig } from '../api';
import { Button, Modal } from './ui';
import { NuevaMemoria } from './NuevaMemoria';
interface Personal { id: string; nombre: string; rev: string }
export function PlantillasPersonales({ settings, onCreated }: { settings: SettingsResponse; onCreated: (result: Partial<SettingsResponse> & {warning?: string}) => Promise<void> }) {
  const [items, setItems] = useState<Personal[]>([]), [save, setSave] = useState(false), [nombre, setNombre] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<(Personal & {config: NuevaMemoriaConfig; fuentes: [string,string][]}) | null>(null);
  const refresh = async () => setItems((await json<{items: Personal[]}>('/api/templates/personal')).items);
  useEffect(() => { void refresh().catch(e => setError(errorMessage(e))); }, []);
  return <div className="space-y-3">
    <Button onClick={() => { setError(''); setSave(true); }}>Guardar como plantilla…</Button>
    {items.length > 0 && <ul className="divide-y divide-line rounded border border-line">{items.map(item => <li key={item.id} className="flex flex-wrap items-center gap-2 p-2"><span className="mr-auto text-sm">{item.nombre}</span>
      <Button onClick={() => void json<NonNullable<typeof selected>>('/api/templates/personal/' + item.id).then(setSelected).catch(e => setError(errorMessage(e)))}>Usar plantilla</Button>
      <a className="rounded px-2 py-1 text-sm text-accent focus-visible:outline" href={'/api/templates/personal/' + item.id + '/export'} download="plantilla.zip">Exportar ZIP</a>
    </li>)}</ul>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {save && <Modal open title="Guardar como plantilla" onClose={() => !busy && setSave(false)} footer={<><Button disabled={busy} onClick={() => setSave(false)}>Cancelar</Button><Button variant="primary" disabled={busy || !nombre.trim()} onClick={() => {
      setBusy(true); setError(''); void (async () => {
        const {baseRev} = await json<{baseRev:string}>('/api/memoria/estilo/revision');
        await json('/api/templates/personal', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({nombre,baseRev})}); await refresh(); setSave(false); setNombre('');
      })().catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
    }}>Guardar plantilla</Button></>}><div className="space-y-3 p-4"><label className="block space-y-2 text-sm"><span>Nombre</span><input autoFocus maxLength={100} value={nombre} onChange={e => setNombre(e.target.value)} className="h-9 w-full rounded border border-line-strong bg-bg px-2" /></label>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</div></Modal>}
    {selected && <NuevaMemoria settings={settings} configuracion={selected.config} fuentes={selected.fuentes} titulo={selected.nombre} onClose={() => setSelected(null)} onCreated={onCreated} crear={async (dir,configuracion) => json('/api/templates/personal/' + selected.id + '/create', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dir,configuracion,baseRev:selected.rev})})} />}
  </div>;
}
