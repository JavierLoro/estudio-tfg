import { useEffect, useRef, useState } from 'react';
import { json, errorMessage } from '../api';
import { Button } from './ui';
interface Registro { registro: { familias: { id: string; nombre: string }[] }; baseRev: string | null; avisos: string[] }
export function FuentesPropias({ onFamilies }: { onFamilies: (familias: [string, string][]) => void }) {
  const [registro, setRegistro] = useState<Registro | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const receive = (r: Registro) => { setRegistro(r); onFamilies(r.registro.familias.map(f => [f.id, f.nombre])); };
  useEffect(() => { let live = true; void json<Registro>('/api/memoria/fuentes').then(r => { if (live) receive(r); }).catch(e => { if (live) setError(errorMessage(e)); }); return () => { live = false; }; }, []);
  return <div className="space-y-2">
    <input ref={input} type="file" multiple accept=".ttf,.otf" className="hidden" aria-label="Archivos de fuentes" onChange={e => {
      const files = [...(e.target.files ?? [])]; e.target.value = ''; if (!files.length || !registro) return;
      const data = new FormData(); data.append('baseRev', registro.baseRev ?? 'null'); files.forEach(f => data.append('file', f));
      setBusy(true); setError(''); void json<Registro>('/api/memoria/fuentes', { method: 'POST', body: data }).then(receive).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
    }} />
    <Button disabled={busy || !registro} onClick={() => input.current?.click()}>{busy ? 'Importando…' : 'Importar fuentes TTF / OTF'}</Button>
    {registro?.avisos.map(a => <p key={a} role="status" className="text-sm text-muted">{a}</p>)}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}
