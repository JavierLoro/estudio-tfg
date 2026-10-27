import { useId } from 'react';
import { CAMPOS_ESTILO, ESTILO_DEFAULTS } from '../../../shared/estilo';
const control = 'h-9 w-full rounded-md border border-line-strong bg-bg px-2 text-sm';
export function Estilo({ values, onChange, onBlur }: { values: Record<string, string>; onChange: (key: string, value: string, saveNow: boolean) => void; onBlur?: () => void }) {
  const id = useId();
  return <details className="rounded-md border border-line p-3"><summary className="cursor-pointer text-sm font-medium">Párrafos, títulos, listas y leyendas</summary>
    <div className="mt-4 space-y-4">{[...new Set(CAMPOS_ESTILO.map(f => f.grupo))].filter(g => g !== 'Papel personalizado' || values.papel === 'personalizado').map(grupo =>
      <fieldset key={grupo} className="rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium">{grupo}</legend>
        <div className="grid gap-3 sm:grid-cols-2">{CAMPOS_ESTILO.filter(f => f.grupo === grupo).map(f => <div key={f.key} className="space-y-1 text-sm"><label htmlFor={id+f.key} className="block">{f.label}</label>
          {f.opciones ? <select id={id+f.key} className={control} value={values[f.key] || ESTILO_DEFAULTS[f.key]} onChange={e => onChange(f.key, e.target.value, true)}>{f.opciones.map(([v,t]) => <option key={v} value={v}>{t}</option>)}</select>
            : <input id={id+f.key} className={control} type="number" min={f.min} max={f.max} step="0.5" value={(values[f.key] || f.defecto).replace(f.unidad!, '')} onChange={e => onChange(f.key, e.target.value + f.unidad, false)} onBlur={onBlur} />}
        </div>)}</div>
      </fieldset>)}</div>
  </details>;
}
