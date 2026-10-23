import { useId } from 'react';
import { FUENTES_TEXTO, FUENTES_TITULOS, NIVELES_TITULOS, TIPOGRAFIA_DEFAULTS } from '../../../shared/tipografia';

const input = 'h-9 w-full rounded-md border border-line-strong bg-bg px-2.5 text-sm outline-none focus:border-accent';
const LABELS: Record<string, string> = Object.fromEntries(FUENTES_TEXTO);
const BODY_FONTS: Record<string, string> = {
  times: '"Times New Roman", serif', latinmodern: '"Latin Modern Roman", "Computer Modern", serif',
  palatino: 'Palatino, "Palatino Linotype", serif', heros: 'Helvetica, Arial, sans-serif',
};
export function Tipografia({ values, onChange, onBlur, errors = {} }: {
  values: Record<string, string>;
  onChange: (key: string, value: string, saveNow: boolean) => void;
  onBlur?: () => void;
  errors?: Record<string, string>;
}) {
  const id = useId();
  const get = (key: string) => values[key] ?? TIPOGRAFIA_DEFAULTS[key] ?? '';
  const select = (key: string, label: string, options: readonly (readonly [string, string])[]) => {
    const value = get(key) || (key === 'tamanoLetra' ? '12pt' : key === 'interlineado' ? '1.5' : '');
    const available = options.some(([v]) => v === value) ? options : [...options, [value, value + ' (personalizado)']];
    return <div className="min-w-0 space-y-1.5" key={key}>
      <label htmlFor={id + key} className="block text-sm font-medium">{label}</label>
      <select id={id + key} className={input} value={value} aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? id + key + 'error' : undefined} onChange={(e) => onChange(key, e.target.value, true)}>
        {available.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
      {errors[key] && <p id={id + key + 'error'} role="alert" className="text-xs text-danger">{errors[key]}</p>}
    </div>;
  };
  const family = (nivel: string) => {
    const f = get('fuente' + nivel) === 'heredar' ? get('fuenteTitulos') : get('fuente' + nivel);
    return f === 'sans' ? 'sans-serif' : BODY_FONTS[f === 'texto' ? get('fuenteTexto') : f] || 'serif';
  };
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      {select('fuenteTexto', 'Fuente del texto', FUENTES_TEXTO)}
      {select('fuenteTitulos', 'Fuente de los títulos', FUENTES_TITULOS)}
      {select('tamanoLetra', 'Tamaño del texto', [['10pt', '10 puntos'], ['11pt', '11 puntos'], ['12pt', '12 puntos']])}
      {select('interlineado', 'Espacio entre líneas', [['1', 'Sencillo'], ['1.15', '1,15'], ['1.25', '1,25'], ['1.5', '1,5'], ['2', 'Doble']])}
    </div>
    <figure className="overflow-hidden rounded-md border border-line">
      <img src={'/muestras-tipografia/' + (FUENTES_TEXTO.some(([key]) => key === get('fuenteTexto')) ? get('fuenteTexto') : 'times') + '.png'}
        alt={'Ejemplo de texto compuesto con ' + (LABELS[get('fuenteTexto')] || 'Times')} width={720} height={140}
        loading="lazy" className="block h-auto w-full bg-white" />
      <figcaption className="border-t border-line bg-soft px-3 py-2 text-xs text-muted">Muestra de {LABELS[get('fuenteTexto')] || 'Times'} a 12 puntos.</figcaption>
    </figure>
    <details className="rounded-md border border-line p-3">
      <summary className="cursor-pointer text-sm font-medium">Personalizar títulos</summary>
      <p className="mt-2 text-xs text-muted">Cada nivel puede tener su propio tamaño, fuente, negrita y uso de mayúsculas. Se conserva el texto que escribas en los títulos.</p>
      <div className="mt-4 space-y-4">
        {NIVELES_TITULOS.map(([nivel, label]) => <fieldset key={nivel} className="rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-semibold">{label}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {select('fuente' + nivel, 'Fuente de ' + label.toLowerCase(), [['heredar', 'La fuente general de títulos'], ...FUENTES_TITULOS])}
            <div className="space-y-1.5">
              <label htmlFor={id + 'tamano' + nivel} className="block text-sm font-medium">Tamaño de {label.toLowerCase()} (puntos)</label>
              <input id={id + 'tamano' + nivel} inputMode="decimal" className={input}
                value={get('tamano' + nivel).replace('.', ',')} onChange={(e) => onChange('tamano' + nivel, e.target.value.replace(',', '.'), false)} onBlur={onBlur}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                aria-invalid={!!errors['tamano' + nivel]} aria-describedby={id + 'tamano' + nivel + 'help'} />
              <p id={id + 'tamano' + nivel + 'help'} className="text-xs text-muted">Entre 8 y 36; se admiten medios puntos, como 13,5.</p>
              {errors['tamano' + nivel] && <p role="alert" className="text-xs text-danger">{errors['tamano' + nivel]}</p>}
            </div>
            {select('negrita' + nivel, 'Negrita en ' + label.toLowerCase(), [['si', 'Sí'], ['no', 'No']])}
            {select('mayusculas' + nivel, 'Mayúsculas de ' + label.toLowerCase(), [['si', 'Todo en mayúsculas'], ['no', 'Como lo escribas']])}
          </div>
        </fieldset>)}
      </div>
    </details>
    <div className="space-y-3 rounded-md border border-line bg-soft p-4" aria-label="Ejemplo de jerarquía de títulos">
      <p className="text-xs text-muted">Ejemplo de jerarquía</p>
      {NIVELES_TITULOS.map(([nivel], idx) => {
        const text = ['1. Introducción', '1.1. Contexto del trabajo', '1.1.1. Alcance y objetivos'][idx];
        return <p key={nivel} style={{ fontFamily: family(nivel), fontSize: (Number(get('tamano' + nivel)) || 12) + 'pt',
          fontWeight: get('negrita' + nivel) === 'si' ? 700 : 400, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
          {get('mayusculas' + nivel) === 'si' ? text.toLocaleUpperCase('es') : text}
        </p>;
      })}
      <p className="text-xs text-muted">La jerarquía es orientativa. El PDF compilado muestra las fuentes y medidas definitivas.</p>
    </div>
  </div>;
}
