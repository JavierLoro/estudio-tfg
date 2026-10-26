import { useId } from 'react';
import { INDICES_DEFAULTS, NIVELES_APARTADOS, TIPOS_INDICE } from '../../../shared/indices';

export function Indices({ values, onChange, errors = {} }: {
  values: Record<string, string>;
  onChange: (key: string, value: string, saveNow: boolean) => void;
  errors?: Record<string, string>;
}) {
  const id = useId();
  const get = (key: string) => values[key] || INDICES_DEFAULTS[key];
  const profundidad = (key: string) => NIVELES_APARTADOS.findIndex(([value]) => value === get(key));
  const ejemplos = ['Introducción', 'Contexto', 'Alcance'];
  const titulo = (nivel: number) => (nivel <= profundidad('numerarHasta') ? ['1. ', '1.1. ', '1.1.1. '][nivel] : '') + ejemplos[nivel];
  return <div className="space-y-4">
    <fieldset>
      <legend className="sr-only">Índices disponibles</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {TIPOS_INDICE.map(([key, label]) => <div key={key}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={get(key) === 'si'} onChange={(e) => onChange(key, e.target.checked ? 'si' : 'no', true)}
              aria-invalid={!!errors[key]} aria-describedby={errors[key] ? id + key + 'error' : undefined} />{label}
          </label>
          {errors[key] && <p id={id + key + 'error'} role="alert" className="mt-1 text-xs text-danger">{errors[key]}</p>}
        </div>)}
      </div>
    </fieldset>
    <details className="rounded-md border border-line p-3">
      <summary className="cursor-pointer text-sm font-medium">Más opciones de índices y numeración</summary>
      <div className="mt-4 space-y-4">
        {(['numerarHasta', 'indiceHasta'] as const).map((key) => <div key={key} className="space-y-1.5">
          <label htmlFor={id + key} className="block text-sm font-medium">{key === 'numerarHasta' ? 'Numerar los títulos hasta' : 'Mostrar en el índice general hasta'}</label>
          <select id={id + key} value={get(key)} onChange={(e) => onChange(key, e.target.value, true)}
            className="h-9 w-full min-w-0 rounded-md border border-line-strong bg-bg px-2 text-sm outline-none focus:border-accent"
            aria-invalid={!!errors[key]} aria-describedby={errors[key] ? id + key + 'error' : undefined}>
            {!NIVELES_APARTADOS.some(([value]) => value === get(key)) && <option value={get(key)}>{get(key)} (personalizado)</option>}
            {NIVELES_APARTADOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {errors[key] && <p role="alert" id={id + key + 'error'} className="text-xs text-danger">{errors[key]}</p>}
        </div>)}
        <figure aria-label="Vista previa de títulos e índice" className="rounded-md border border-line bg-soft p-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div aria-label="Ejemplo de títulos numerados">
              <p className="mb-2 text-sm font-medium">Documento</p>
              {ejemplos.map((_, n) => <p key={n} className="break-words text-sm" style={{ paddingLeft: n * 8 }}>{titulo(n)}</p>)}
            </div>
            <div aria-label="Ejemplo de índice general">
              <p className="mb-2 text-sm font-medium">Índice general</p>
              {get('indiceGeneral') !== 'si' ? <p className="text-sm text-muted">Desactivado</p>
                : ejemplos.slice(0, profundidad('indiceHasta') + 1).map((_, n) => <p key={n} className="break-words text-sm" style={{ paddingLeft: n * 8 }}>{titulo(n)}</p>)}
            </div>
          </div>
        </figure>
      </div>
    </details>
  </div>;
}
