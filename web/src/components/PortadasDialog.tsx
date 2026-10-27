import { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { ELEMENTOS_PORTADA, ZONAS, type BloquePortada, type PortadasConfig, type ZonaPortada } from '../../../shared/portadas';
import { api, json, errorMessage } from '../api';
import { Button, Modal, Spinner } from './ui';

const LABEL = Object.fromEntries(ELEMENTOS_PORTADA);
const ZONA = { superior: 'Parte superior', central: 'Parte central', inferior: 'Parte inferior' };
const control = 'h-8 rounded border border-line-strong bg-bg px-2 text-xs outline-none focus:border-accent';

export function PortadasDialog({ initial, datos, institucion, onSave, onClose, imagenes = false, saveLabel = 'Guardar portadas' }: {
  initial: PortadasConfig;
  datos: Record<string, string>;
  institucion: Record<string, string>;
  onSave: (config: PortadasConfig) => Promise<void>;
  onClose: () => void;
  saveLabel?: string;
  imagenes?: boolean;
}) {
  const [cfg, setCfg] = useState(initial);
  const [side, setSide] = useState<'exterior' | 'interior'>('interior');
  const [selected, setSelected] = useState('titulo');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blocks = cfg[side];
  const update = (next: BloquePortada[]) => { setCfg((prev) => ({ ...prev, [side]: next })); setError(null); };
  const move = (id: string, zona: ZonaPortada, before?: string) => {
    const block = blocks.find((b) => b.id === id);
    if (!block || before === id) return;
    const rest = blocks.filter((b) => b.id !== id);
    const at = before ? rest.findIndex((b) => b.id === before) : -1;
    rest.splice(at < 0 ? rest.length : at, 0, { ...block, zona });
    update(rest);
  };
  const reorder = (block: BloquePortada, delta: number) => {
    const group = blocks.filter((b) => b.zona === block.zona);
    const peer = group[group.indexOf(block) + delta];
    if (!peer) return;
    const next = [...blocks], a = next.indexOf(block), b = next.indexOf(peer);
    [next[a], next[b]] = [next[b], next[a]];
    update(next);
  };
  const addText = () => {
    if (!custom.trim()) { setError('Escribe el texto que quieras añadir.'); return; }
    if (blocks.length >= 20) { setError('Cada portada admite hasta 20 elementos.'); return; }
    const id = 'texto-' + crypto.randomUUID().replaceAll('-', '');
    update([...blocks, { id, tipo: 'texto', zona: 'central', texto: custom.trim() }]);
    setSelected(id);
    setCustom('');
  };
  const drop = (event: React.DragEvent, zona: ZonaPortada, before?: string) => {
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    const [source, id] = event.dataTransfer.getData('text/x-estudio-tfg-portada').split(':');
    if (source === side) move(id, zona, before);
  };
  const preview = (b: BloquePortada) => {
    if (b.tipo === 'texto') return b.texto!;
    if (b.tipo === 'imagen') return b.recurso?.endsWith('.pdf') ? <object data={api.rawUrl('memoria', b.recurso)} type="application/pdf" className="mx-auto h-24 w-full" aria-label="Imagen de portada">Imagen PDF</object> : <img src={api.rawUrl('memoria', b.recurso!)} alt="Imagen de portada" className="inline-block max-h-24 max-w-full" />;
    if (b.tipo === 'firma') return '________________';
    if (b.tipo === 'fecha') return datos.fechaMes || datos.fechaAnio ? [datos.fechaMes, datos.fechaAnio].filter(Boolean).join(' ') : 'Fecha de entrega';
    if (b.tipo === 'tipo') {
      const en = institucion.idiomaPortadas === 'ingles' || (institucion.idiomaPortadas !== 'espanol' && datos.idioma === 'ingles');
      const types: Record<string, string[]> = { tfg: ['Trabajo Fin de Grado', "Bachelor's Thesis"], tfm: ['Trabajo Fin de Máster', "Master's Thesis"], tesis: ['Tesis Doctoral', 'Doctoral Thesis'] };
      return institucion.nombreTrabajo || types[institucion.tipoTrabajo || 'tfg']?.[en ? 1 : 0] || 'Tipo de trabajo';
    }
    return datos[b.tipo] || institucion[b.tipo] || LABEL[b.tipo] || b.tipo;
  };
  const save = async () => {
    for (const side of ['exterior', 'interior'] as const) {
      if (cfg[side].some((b) => b.tipo === 'texto' && !b.texto?.trim())) { setError('Completa los textos propios o quita los bloques que no necesites.'); return; }
      if (ZONAS.some((z) => cfg[side].filter((b) => b.zona === z).length > 10)) { setError('Coloca como máximo 10 elementos en cada zona.'); return; }
    }
    setBusy(true); setError(null);
    try { await onSave(cfg); onClose(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <Modal open title="Componer portadas" width={1000} onClose={() => { if (!busy) onClose(); }} footer={<>
    {error && <p role="alert" className="mr-auto text-xs text-danger">{error}</p>}
    <Button size="md" disabled={busy} onClick={onClose}>Cancelar</Button>
    <Button size="md" variant="primary" disabled={busy} onClick={() => void save()}>{busy && <Spinner />}{saveLabel}</Button>
  </>}>
    <div className="flex h-[65vh] min-h-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2" aria-label="Portada que estás componiendo">
        <Button size="md" variant={side === 'interior' ? 'primary' : 'default'} aria-pressed={side === 'interior'} onClick={() => setSide('interior')}>Portada con datos</Button>
        <Button size="md" variant={side === 'exterior' ? 'primary' : 'default'} aria-pressed={side === 'exterior'} onClick={() => setSide('exterior')}>Portada exterior</Button>
      </div>
      <fieldset disabled={busy} className="grid min-h-0 min-w-0 flex-1 gap-5 overflow-auto md:grid-cols-[220px_minmax(0,1fr)] md:overflow-hidden">
        <div className="space-y-5 md:overflow-auto">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Elementos de esta portada</legend>
            <div className="space-y-2">
              {ELEMENTOS_PORTADA.filter(([t]) => t !== 'imagen').map(([tipo, label]) => <label className="flex items-center gap-2 text-sm" key={tipo}>
                <input type="checkbox" checked={blocks.some((b) => b.tipo === tipo)} onChange={(e) => {
                  if (!e.target.checked) update(blocks.filter((b) => b.tipo !== tipo));
                  else if (blocks.length < 20) update([...blocks, { id: tipo, tipo, zona: 'central' }]);
                  else setError('Cada portada admite hasta 20 elementos.');
                }} />{label}
              </label>)}
            </div>
          </fieldset>
          {imagenes && <label className="block text-sm">Añadir imagen<input type="file" accept=".png,.jpg,.jpeg,.pdf" className="mt-2 block w-full text-xs" disabled={busy} onChange={e => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
            const data = new FormData(); data.append('baseRev','null'); data.append('file',file); setBusy(true); setError(null);
            void json<{recurso:string}>('/api/memoria/portadas/imagen', {method:'POST',body:data}).then(({recurso}) => update([...blocks, {id:'imagen-' + crypto.randomUUID().replaceAll('-',''), tipo:'imagen', zona:'superior', recurso}])).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
          }} /></label>}
          <div className="space-y-2">
            <label htmlFor="portada-texto" className="block text-sm font-semibold">Añadir un texto propio</label>
            <textarea id="portada-texto" rows={3} maxLength={500} className="w-full resize-y rounded border border-line-strong bg-bg p-2 text-sm outline-none focus:border-accent"
              placeholder="Por ejemplo: convocatoria, curso académico o nombre del programa" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <Button onClick={addText}><Plus size={13} />Añadir texto</Button>
          </div>
        </div>
        <div className="overflow-auto rounded-lg border border-line bg-soft p-3">
          <div className="mb-2 text-center text-xs text-muted">Vista de composición · {side === 'interior' ? 'portada con datos' : 'portada exterior'}</div>
          <div className="mx-auto flex min-h-[620px] max-w-[520px] flex-col gap-3 border border-line-strong bg-bg p-4 shadow-sm">
            {ZONAS.map((zona) => {
              const group = blocks.filter((b) => b.zona === zona);
              return <section key={zona} aria-label={ZONA[zona]} onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, zona)}
                className="min-h-32 flex-1 rounded-md border border-dashed border-line-strong p-2">
                <h3 className="mb-2 text-xs font-medium text-muted">{ZONA[zona]}</h3>
                <div className="space-y-2">
                  {group.map((block, idx) => <div key={block.id} role="group" aria-label={'Elemento ' + (LABEL[block.tipo] || block.texto)} draggable={!busy}
                    onDragStart={(e) => { setSelected(block.id); e.dataTransfer.setData('text/x-estudio-tfg-portada', side + ':' + block.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, zona, block.id)}
                    className={'rounded border p-2 ' + (selected === block.id ? 'border-accent bg-soft' : 'border-line bg-bg')}>
                    <button type="button" aria-pressed={selected === block.id} aria-label={'Seleccionar ' + (LABEL[block.tipo] || block.texto)}
                      className="flex w-full items-start gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => setSelected(block.id)}>
                      <GripVertical size={14} className="mt-1 shrink-0 text-muted" aria-hidden />
                      <span style={{ display: 'block', textAlign: block.alineacion === 'izquierda' ? 'left' : block.alineacion === 'derecha' ? 'right' : 'center', marginBottom: (block.espacio ?? 4) * 2 }} className={'min-w-0 flex-1 whitespace-pre-wrap break-words ' + (block.tipo === 'titulo' ? 'text-lg font-semibold' : 'text-sm')}>{preview(block)}</span>
                    </button>
                    {selected === block.id && block.tipo === 'texto' && <label className="mt-2 block text-xs text-muted">Editar texto
                      <textarea value={block.texto} maxLength={500} rows={2} className="mt-1 w-full rounded border border-line-strong bg-bg p-1.5 text-sm text-fg"
                        onChange={(e) => update(blocks.map((b) => b.id === block.id ? { ...b, texto: e.target.value } : b))} />
                    </label>}
                    {selected === block.id && <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
                      <select aria-label={'Zona de ' + (block.tipo === 'texto' ? block.texto : LABEL[block.tipo])} className={control}
                        value={zona} onChange={(e) => move(block.id, e.target.value as ZonaPortada)}>
                        {ZONAS.map((z) => <option key={z} value={z}>{ZONA[z]}</option>)}
                      </select>
                      <select aria-label="Alineación del elemento" className={control} value={block.alineacion || 'centro'} onChange={e => update(blocks.map(b => b.id === block.id ? { ...b, alineacion: e.target.value as BloquePortada['alineacion'] } : b))}>{[['izquierda', 'Izquierda'], ['centro', 'Centro'], ['derecha', 'Derecha']].map(([v,t]) => <option key={v} value={v}>{t}</option>)}</select>
                      <label className="text-xs">Espacio (mm)<input aria-label="Espacio después del elemento (mm)" className={control + ' w-16'} type="number" min={0} max={50} value={block.espacio ?? 4} onChange={e => update(blocks.map(b => b.id === block.id ? { ...b, espacio: Number(e.target.value) } : b))} /></label>
                      <Button aria-label={'Subir elemento ' + (LABEL[block.tipo] || block.texto)} disabled={idx === 0} onClick={() => reorder(block, -1)}><ArrowUp size={13} /></Button>
                      <Button aria-label={'Bajar elemento ' + (LABEL[block.tipo] || block.texto)} disabled={idx === group.length - 1} onClick={() => reorder(block, 1)}><ArrowDown size={13} /></Button>
                      <Button aria-label={'Quitar elemento ' + (LABEL[block.tipo] || block.texto)} onClick={() => update(blocks.filter((b) => b.id !== block.id))}><Trash2 size={13} /></Button>
                    </div>}
                  </div>)}
                  {group.length === 0 && <p className="py-5 text-center text-xs text-muted">Arrastra un elemento aquí o elige esta zona desde su selector.</p>}
                </div>
              </section>;
            })}
          </div>
        </div>
      </fieldset>
    </div>
  </Modal>;
}
