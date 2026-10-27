import { useId } from 'react';
import { CONTENIDOS_PAGINA, NUMERACION_PAGINAS, PAGINACION_DEFAULTS, POSICIONES_PAGINA } from '../../../shared/paginacion';

const input = 'h-9 w-full min-w-0 rounded-md border border-line-strong bg-bg px-2 text-sm outline-none focus:border-accent';
export function Paginacion({ values, onChange, onBlur, errors = {} }: {
  values: Record<string, string>;
  onChange: (key: string, value: string, saveNow: boolean) => void;
  onBlur?: () => void;
  errors?: Record<string, string>;
}) {
  const id = useId();
  const get = (key: string) => values[key] ?? PAGINACION_DEFAULTS[key] ?? '';
  const caras = get('caras') || 'automatico';
  const doble = caras === 'dos' || (caras === 'automatico' && get('formato') !== 'pantalla');
  const personalizado = get('estiloPagina') === 'personalizado';
  const select = (key: string, label: string, options: readonly (readonly [string, string])[]) => <div key={key} className="min-w-0 space-y-1.5">
    <label htmlFor={id + key} className="block text-sm font-medium">{label}</label>
    <select id={id + key} value={get(key)} className={input} onChange={(e) => onChange(key, e.target.value, true)}
      aria-invalid={!!errors[key]} aria-describedby={errors[key] ? id + key + 'error' : undefined}>
      {!options.some(([value]) => value === get(key)) && <option value={get(key)}>{get(key)} (personalizado)</option>}
      {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>
    {errors[key] && <p role="alert" id={id + key + 'error'} className="text-xs text-danger">{errors[key]}</p>}
  </div>;
  const content = (key: string, page: number) => {
    const tipo = get(key);
    if (tipo === 'pagina') return String(page);
    if (tipo === 'capitulo') return '1. Introducción';
    if (tipo === 'seccion') return 'Contexto';
    return tipo === 'texto' ? get(key + 'Texto') : '';
  };
  const row = (zona: 'cabecera' | 'pie', page: number) => {
    let texts: string[];
    if (personalizado) {
      texts = POSICIONES_PAGINA.filter(([key]) => key.startsWith(zona)).map(([key]) => content(key, page));
      if (doble && page % 2 === 0 && get('reflejarCabeceras') === 'si') texts.reverse();
    } else {
      texts = zona === 'pie' ? ['', String(page), '']
        : doble ? page % 2 === 0 ? ['1. Introducción', '', ''] : ['', '', 'Contexto']
        : ['1. Introducción', '', 'Contexto'];
    }
    return <div className="grid grid-cols-3 gap-2 text-[10px] text-muted">
      {texts.map((text, idx) => <span key={idx} className={idx === 1 ? 'break-words text-center' : idx === 2 ? 'break-words text-right' : 'break-words'}>{text || '—'}</span>)}
    </div>;
  };
  return <div className="space-y-4">
    {select('numeracionPaginas', 'Numeración de páginas', NUMERACION_PAGINAS)}
    <p className="text-xs text-muted">Las portadas y las hojas de cortesía cuentan, pero no muestran número. En el modo continuo, el cuerpo sigue la cuenta sin volver a 1.</p>
    {select('estiloPagina', 'Diseño de cabeceras y pies', [['actual', 'Conservar el diseño de la plantilla'], ['personalizado', 'Personalizar las posiciones']])}
    {personalizado && <>
      <p className="text-xs text-muted">Elige qué aparece en cada posición. Usa textos breves: en el PDF se reducen si superan el espacio de su zona.</p>
      {(['cabecera', 'pie'] as const).map((zona) => <fieldset key={zona} className="rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-medium">{zona === 'cabecera' ? 'Cabecera · parte superior' : 'Pie · parte inferior'}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {POSICIONES_PAGINA.filter(([key]) => key.startsWith(zona)).map(([key, label]) => <div key={key} className="min-w-0 space-y-2">
            {select(key, label, CONTENIDOS_PAGINA)}
            {get(key) === 'texto' && <div className="space-y-1.5">
              <label htmlFor={id + key + 'Texto'} className="block text-xs">Texto de {label.toLowerCase()}</label>
              <input id={id + key + 'Texto'} className={input} value={get(key + 'Texto')} maxLength={500}
                onChange={(e) => onChange(key + 'Texto', e.target.value, false)} onBlur={onBlur}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                aria-invalid={!!errors[key + 'Texto']} aria-describedby={errors[key + 'Texto'] ? id + key + 'Textoerror' : undefined} />
              {errors[key + 'Texto'] && <p role="alert" id={id + key + 'Textoerror'} className="text-xs text-danger">{errors[key + 'Texto']}</p>}
            </div>}
          </div>)}
        </div>
      </fieldset>)}
      <div className="grid gap-4 sm:grid-cols-2">
        {select('reflejarCabeceras', 'Posiciones en páginas pares', [['si', 'Reflejar izquierda y derecha'], ['no', 'Mantener las posiciones']])}
        {select('cabeceraInicioCapitulo', 'Cabecera al empezar un capítulo', [['no', 'Ocultar en la primera página'], ['si', 'Mostrar también en la primera página']])}
      </div>
      {!doble && <p className="text-xs text-muted">El reflejo solo se aplica si preparas el documento a dos caras.</p>}
      <p className="text-xs text-muted">El pie elegido se muestra también al empezar un capítulo. Las portadas y las hojas de cortesía quedan vacías.</p>
    </>}
    <figure className="space-y-2 rounded-md border border-line bg-soft p-3">
      <figcaption className="text-xs text-muted">Ejemplo de distribución{doble ? ' · página par e impar' : ''}</figcaption>
      <div className={doble ? 'grid grid-cols-2 gap-3' : ''}>
        {(doble ? [4, 5] : [5]).map((page) => <div key={page} className="flex min-h-36 min-w-0 flex-col justify-between rounded border border-line bg-bg p-2">
          {row('cabecera', page)}
          <div aria-hidden="true" className="space-y-2 py-5">{[1, 2, 3].map((n) => <div key={n} className="h-1 rounded bg-line" />)}</div>
          {row('pie', page)}
        </div>)}
      </div>
      <p className="text-xs text-muted">Vista orientativa de una página del cuerpo. Compila para comprobar el resultado definitivo.</p>
    </figure>
  </div>;
}
