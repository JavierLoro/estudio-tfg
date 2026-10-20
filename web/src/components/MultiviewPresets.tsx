import { getInstance } from '../lib/instance';
import { useState } from 'react';
import { RotateCcw, Save, Trash2 } from 'lucide-react';
import { load, save } from '../lib/storage';
import { spacesKey, validPreset, type ViewPreset } from '../lib/spaces';
import { useUI, confirmDialog } from '../state/ui';
import { applyPreset, snapshotLayouts } from '../state/workspace';
import { Button, IconButton } from './ui';

export function MultiviewPresets() {
  const key = spacesKey('presets', getInstance());
  const [presets, setPresets] = useState<ViewPreset[]>(() => {
    const stored = load<unknown>(key, []);
    return Array.isArray(stored) ? stored.filter(validPreset) : [];
  });
  const [selected, setSelected] = useState('');
  const persist = (next: ViewPreset[]) => {
    if (!save(key, next)) { useUI.getState().toast({ kind: 'error', text: 'No se pudo guardar la vista en este navegador. Revisa el espacio disponible.' }); return false; }
    setPresets(next);
    return true;
  };
  const store = async () => {
    const ui = useUI.getState();
    const name = (await ui.ask({ title: 'Guardar vista', label: 'Nombre de la vista', initial: presets.find(p => p.id === selected)?.name ?? '', okLabel: 'Guardar vista' }))?.trim();
    if (!name) return;
    const existing = presets.find(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing && !await confirmDialog({ title: 'Actualizar vista', text: `¿Sustituir la configuración de «${existing.name}»?`, okLabel: 'Actualizar' })) return;
    const state = useUI.getState();
    const layouts = snapshotLayouts();
    const preset: ViewPreset = { id: existing?.id ?? crypto.randomUUID(), name, pair: [...state.viewPair], ratio: state.viewRatio, sidebars: structuredClone(state.sidebars), layouts: Object.fromEntries(state.viewPair.map(s => [s, layouts[s]])), libraryView: state.libraryView };
    if (persist([...presets.filter(p => p.id !== preset.id), preset])) {
      setSelected(preset.id);
      state.toast({ kind: 'ok', text: `Vista «${name}» guardada` });
    }
  };
  const remove = async () => {
    const preset = presets.find(p => p.id === selected);
    if (!preset || !await confirmDialog({ title: 'Eliminar vista guardada', text: `¿Eliminar «${preset.name}»? Los documentos se conservan.`, okLabel: 'Eliminar', danger: true })) return;
    if (persist(presets.filter(p => p.id !== selected))) setSelected('');
  };
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-soft px-3 py-1.5" role="group" aria-label="Vistas guardadas">
    <span className="text-[12px] font-semibold">Multivista</span>
    <select aria-label="Vista guardada" value={selected} className="h-7 min-w-0 max-w-64 rounded border border-line bg-bg px-2 text-[12px]" onChange={e => {
      const preset = presets.find(p => p.id === e.target.value);
      if (preset && applyPreset(preset)) setSelected(preset.id);
    }}>
      <option value="">Elegir vista guardada…</option>
      {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
    <Button onClick={() => void store()}><Save size={13} /> Guardar vista</Button>
    <IconButton label="Restaurar vista guardada" disabled={!selected} onClick={() => { const preset = presets.find(p => p.id === selected); if (preset) applyPreset(preset); }}><RotateCcw size={14} /></IconButton>
    <IconButton label="Eliminar vista guardada" disabled={!selected} onClick={() => void remove()}><Trash2 size={14} /></IconButton>
  </div>;
}
