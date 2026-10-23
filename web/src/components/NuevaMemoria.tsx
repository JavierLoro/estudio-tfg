import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage, type NuevaMemoriaConfig, type SettingsResponse } from '../api';
import { parentAbs } from '../lib/abspath';
import { DirPicker } from './DirPicker';
import { Button, Modal, Spinner, cx } from './ui';
import { configuracionInicial } from '../../../shared/nueva-memoria';
import { PortadasDialog } from './PortadasDialog';
import { Tipografia } from './Tipografia';
import { Paginacion } from './Paginacion';
import { Indices } from './Indices';
import { TIPOS_INDICE, NIVELES_APARTADOS } from '../../../shared/indices';
import { NUMERACION_PAGINAS } from '../../../shared/paginacion';
import { NIVELES_TITULOS, FUENTES_TEXTO } from '../../../shared/tipografia';

const PASOS = ['Datos e idioma', 'Página', 'Texto y títulos', 'Apartados', 'Revisar'];
const SUGERENCIAS = [
  ['Introducción', 'Introduction'], ['Objetivos', 'Objectives'], ['Antecedentes', 'Background'],
  ['Metodología', 'Methodology'], ['Desarrollo', 'Development'], ['Resultados', 'Results'],
  ['Conclusiones', 'Conclusions'], ['Trabajo futuro', 'Future work'],
];
const MARGENES = ['margenInterior', 'margenExterior', 'margenSuperior', 'margenInferior'];
const EXTRA: [string, string, string][] = [
  ['portadaInterior', 'Portada con los datos del trabajo', 'Título, autor, tutores e institución, si los completas.'],
  ['portada', 'Portada exterior adicional', 'Una página anterior, sin los datos de los tutores.'],
  ['derechos', 'Página de créditos', 'Autoría, contacto y licencia del documento.'],
  ['tribunal', 'Hoja de tribunal', 'Una página para los datos de la evaluación.'],
  ['resumen', 'Resumen en español', 'Se crea un apartado vacío para que lo escribas.'],
  ['abstract', 'Resumen en inglés (Abstract)', 'Se crea un apartado vacío en inglés.'],
  ['agradecimientos', 'Agradecimientos', 'Un apartado opcional al principio de la memoria.'],
  ['bibliografia', 'Bibliografía', 'Las referencias aparecerán cuando añadas citas al texto.'],
  ['anexo', 'Un anexo inicial', 'Podrás añadir más anexos desde Documento.'],
];
const input = 'h-9 w-full rounded-md border border-line-strong bg-bg px-2.5 text-sm outline-none focus:border-accent';

export function NuevaMemoria({ settings, onClose, onCreated, configuracion, crear, titulo = 'Crear memoria desde cero' }: {
  settings: SettingsResponse;
  onClose: () => void;
  onCreated: (result: Partial<SettingsResponse> & { warning?: string }) => Promise<void>;
  configuracion?: NuevaMemoriaConfig;
  crear?: (dir: string, cfg: NuevaMemoriaConfig) => Promise<Partial<SettingsResponse> & { warning?: string }>;
  titulo?: string;
}) {
  const [cfg, setCfg] = useState(() => structuredClone(configuracion ?? configuracionInicial()));
  const [paso, setPaso] = useState(0);
  const [otro, setOtro] = useState('');
  const [destino, setDestino] = useState('');
  const [picker, setPicker] = useState(false);
  const [portadas, setPortadas] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [paso]);
  const ingles = cfg.datos.idioma === 'ingles';
  const dos = cfg.institucion.caras === 'dos';
  const set = (group: 'datos' | 'institucion', key: string, value: string) => {
    setError(null);
    setCfg((prev) => {
      let capitulos = prev.capitulos;
      if (key === 'idioma' && value !== prev.datos.idioma) {
        const old = prev.datos.idioma === 'ingles' ? 1 : 0;
        const next = value === 'ingles' ? 1 : 0;
        capitulos = capitulos.map((title) => SUGERENCIAS.find((pair) => pair[old] === title)?.[next] ?? title);
      }
      return { ...prev, [group]: { ...prev[group], [key]: value }, capitulos };
    });
  };
  const field = (group: 'datos' | 'institucion', key: string, label: string, options?: [string, string][], help?: string) => (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm" key={key}>
      <label htmlFor={'nueva-' + key} className="font-medium">{label}</label>
      {options ? <select id={'nueva-' + key} className={input} value={cfg[group][key]} onChange={(e) => set(group, key, e.target.value)}
        aria-describedby={help ? 'ayuda-' + key : undefined}>
        {options.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
      </select> : <input id={'nueva-' + key} className={input} value={cfg[group][key]} maxLength={200}
        onChange={(e) => set(group, key, e.target.value)} />}
      {help && <span id={'ayuda-' + key} className="text-xs text-muted">{help}</span>}
    </div>
  );
  const move = (index: number, delta: number) => setCfg((prev) => {
    const capitulos = [...prev.capitulos];
    [capitulos[index], capitulos[index + delta]] = [capitulos[index + delta], capitulos[index]];
    return { ...prev, capitulos };
  });
  const add = (title: string) => {
    const text = title.trim();
    if (!text) { setError('Escribe un nombre para el capítulo.'); return; }
    if (cfg.capitulos.some((value) => value.toLocaleLowerCase() === text.toLocaleLowerCase())) { setError('Ese capítulo ya está en la lista.'); return; }
    if (cfg.capitulos.length >= 30) { setError('Puedes crear hasta 30 capítulos iniciales. Después podrás añadir más desde Documento.'); return; }
    setCfg((prev) => ({ ...prev, capitulos: [...prev.capitulos, text] }));
    setOtro('');
    setError(null);
  };
  const advance = () => {
    if (paso === 1 && MARGENES.some((key) => !/^\d+(\.\d+)?mm$/.test(cfg.institucion[key]) || parseFloat(cfg.institucion[key]) > 80)) {
      setError('Completa los cuatro márgenes con valores entre 0 y 80 milímetros.'); return;
    }
    if (paso === 1 && parseFloat(cfg.institucion.margenInterior) + parseFloat(cfg.institucion.margenExterior) > (cfg.institucion.papel === 'carta' ? 215.9 : 210) - 80) {
      setError('Los márgenes dejan demasiado poco ancho para el texto. Reduce el izquierdo y el derecho.'); return;
    }
    if (paso === 2 && NIVELES_TITULOS.some(([nivel]) => {
      const size = cfg.institucion['tamano' + nivel];
      return !/^\d+(\.\d+)?$/.test(size) || Number(size) < 8 || Number(size) > 36 || Number(size) * 2 % 1 !== 0;
    })) { setError('Usa tamaños de título entre 8 y 36 puntos, en pasos de medio punto.'); return; }
    if (paso === 3 && !cfg.capitulos.length) { setError('Selecciona al menos un capítulo o añade uno propio.'); return; }
    setError(null); setPaso((n) => n + 1);
  };
  const create = async () => {
    if (!destino || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await (crear ? crear(destino, cfg) : api.initMemoria(destino, 'generico', cfg));
      await onCreated(result);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <>
    <Modal open title={titulo} onClose={() => { if (!busy) onClose(); }} width={760} footer={<>
      <Button size="md" onClick={onClose} disabled={busy}>Cancelar</Button>
      {paso > 0 && <Button size="md" disabled={busy} onClick={() => { setError(null); setPaso((n) => n - 1); }}>Atrás</Button>}
      {paso < 4 ? <Button size="md" variant="primary" onClick={advance}>Continuar</Button>
        : <Button size="md" variant="primary" disabled={busy || !destino} onClick={() => void create()}>
          {busy && <Spinner />} {busy ? 'Creando…' : 'Crear memoria'}
        </Button>}
    </>}>
      <div className="space-y-5 p-5">
        <ol aria-label="Pasos de creación" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
          {PASOS.map((label, idx) => <li key={label} aria-current={idx === paso ? 'step' : undefined}
            className={cx(idx === paso && 'font-semibold text-accent')}>{idx + 1}. {label}</li>)}
        </ol>
        <div>
          <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{PASOS[paso]}</h2>
          <p className="mt-1 text-sm text-muted">{[
            'Completa lo que sepas. Puedes dejar los datos vacíos y añadirlos después.',
            'Estos valores son un punto de partida editable. Usa los que indique tu normativa.',
            'Elige una fuente y revisa el aspecto de los títulos. Puedes conservar los valores iniciales.',
            'Elige los apartados que necesitas. Puedes añadir capítulos propios y ordenar la lista.',
            'Revisa las opciones y elige dónde guardar tu nueva memoria.',
          ][paso]}</p>
        </div>
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          {paso === 0 && <>
            {field('datos', 'titulo', 'Título del trabajo')}
            <div className="grid gap-4 sm:grid-cols-2">
              {field('datos', 'autor', 'Autor/a')}
              {field('datos', 'tutor', 'Tutor/a (opcional)')}
              {field('datos', 'idioma', 'Idioma del documento', [['espanol', 'Español'], ['ingles', 'Inglés']],
                'Cambia los nombres automáticos y los títulos sugeridos. Tu texto no se traduce.')}
              {field('institucion', 'idiomaPortadas', 'Idioma de la portada', [['documento', 'El del documento'], ['espanol', 'Español'], ['ingles', 'Inglés']])}
            </div>
            <details className="rounded-md border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium">Institución y titulación (opcional)</summary>
              <div className="mt-4 grid gap-4">
                {field('institucion', 'universidad', 'Universidad')}
                {field('institucion', 'escuela', 'Escuela o facultad')}
                {field('institucion', 'titulacion', 'Titulación')}
                <p className="text-xs text-muted">Podrás añadir el logo y otros datos desde Datos del trabajo.</p>
              </div>
            </details>
          </>}
          {paso === 1 && <>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('institucion', 'papel', 'Tamaño de papel', [['a4', 'A4 · 210 × 297 mm'], ['carta', 'Carta · 216 × 279 mm']])}
              {field('institucion', 'caras', 'Preparación de las páginas', [['una', 'Una cara'], ['dos', 'Dos caras']],
                dos ? 'Los márgenes se alternan. Cada capítulo empieza en una página derecha; puede haber páginas en blanco.' : 'Los márgenes izquierdo y derecho se mantienen en todas las páginas.')}
            </div>
            <fieldset className="rounded-md border border-line p-4">
              <legend className="px-1 text-sm font-medium">Márgenes en milímetros</legend>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {MARGENES.map((key, idx) => <label key={key} className="space-y-1.5 text-sm">
                  <span className="block">{[dos ? 'Interior' : 'Izquierdo', dos ? 'Exterior' : 'Derecho', 'Superior', 'Inferior'][idx]}</span>
                  <input type="number" min="0" max="80" step="0.5" className={input}
                    value={cfg.institucion[key].replace(/mm$/, '')} onChange={(e) => set('institucion', key, e.target.value + 'mm')} />
                </label>)}
              </div>
              {dos && <p className="mt-3 text-xs text-muted">Interior es el lado del lomo. La medida incluye todo el margen, sin añadir espacio extra.</p>}
            </fieldset>
          </>}
          {paso === 2 && <>
            <Tipografia values={cfg.institucion} onChange={(key, value) => set('institucion', key, value)} />
            <details className="rounded-md border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium">Numeración, cabeceras y pies</summary>
              <div className="mt-4"><Paginacion values={cfg.institucion} onChange={(key, value) => set('institucion', key, value)} /></div>
            </details>
          </>}
          {paso === 3 && <>
            <div className="rounded-md border border-line bg-soft p-3">
              <p className="mb-2 text-sm">Puedes elegir los elementos de cada portada, añadir textos y colocarlos por zonas.</p>
              <Button size="md" onClick={() => setPortadas(true)}>Componer portadas…</Button>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Capítulos sugeridos</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGERENCIAS.map((pair) => { const title = pair[ingles ? 1 : 0]; return <label key={pair[0]} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={cfg.capitulos.includes(title)} onChange={(e) => e.target.checked ? add(title)
                    : setCfg((prev) => ({ ...prev, capitulos: prev.capitulos.filter((t) => t !== title) }))} />{title}
                </label>; })}
              </div>
            </fieldset>
            <div>
              <label htmlFor="nuevo-capitulo" className="mb-1.5 block text-sm font-medium">Añadir otro capítulo</label>
              <div className="flex gap-2">
                <input id="nuevo-capitulo" className={input} value={otro} maxLength={200} placeholder="Nombre del capítulo"
                  onChange={(e) => setOtro(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(otro); } }} />
                <Button size="md" onClick={() => add(otro)}><Plus size={14} />Añadir</Button>
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Orden de los capítulos · {cfg.capitulos.length}</h3>
              {cfg.capitulos.length === 0 && <p className="text-sm text-muted">Selecciona una sugerencia o añade un capítulo propio.</p>}
              <ol className="divide-y divide-line rounded-md border border-line">
                {cfg.capitulos.map((title, idx) => <li key={title} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="text-muted">{idx + 1}.</span><span className="min-w-0 flex-1 break-words">{title}</span>
                  <Button aria-label={'Subir ' + title} disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp size={14} /></Button>
                  <Button aria-label={'Bajar ' + title} disabled={idx === cfg.capitulos.length - 1} onClick={() => move(idx, 1)}><ArrowDown size={14} /></Button>
                  <Button aria-label={'Quitar ' + title} onClick={() => setCfg((prev) => ({ ...prev, capitulos: prev.capitulos.filter((_, n) => n !== idx) }))}><Trash2 size={14} /></Button>
                </li>)}
              </ol>
            </div>
            <section className="space-y-3 rounded-md border border-line p-3" aria-label="Índices y numeración de apartados">
              <h3 className="text-sm font-medium">Índices y numeración de apartados</h3>
              <Indices values={cfg.institucion} onChange={(key, value) => set('institucion', key, value)} />
            </section>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Portadas y otros apartados</legend>
              <div className="space-y-3">
                {EXTRA.map(([key, label, help]) => <label key={key} className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" className="mt-1" checked={cfg.apartados[key]} onChange={(e) => setCfg((prev) => ({ ...prev, apartados: { ...prev.apartados, [key]: e.target.checked } }))} />
                  <span><span className="block font-medium">{label}</span><span className="block text-xs text-muted">{help}</span></span>
                </label>)}
              </div>
            </fieldset>
            {cfg.apartados.bibliografia && field('datos', 'estiloBibliografia', 'Cómo mostrar las citas', [['numeric', 'Números · [1], [2] · referencias alfabéticas'], ['ieee', 'IEEE · números por orden de cita'], ['apa', 'APA · autor y año'], ['authoryear', 'Autor y año'], ['alphabetic', 'Claves alfabéticas · [Gar26]']])}
          </>}
          {paso === 4 && <>
            <dl className="grid gap-x-4 gap-y-2 rounded-md border border-line bg-soft p-4 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">Trabajo</dt><dd className="break-words">{cfg.datos.titulo || 'Título pendiente'}{cfg.datos.autor && ' · ' + cfg.datos.autor}</dd>
              <dt className="text-muted">Idioma</dt><dd>{ingles ? 'Inglés' : 'Español'}</dd>
              <dt className="text-muted">Página</dt><dd>{cfg.institucion.papel === 'a4' ? 'A4' : 'Carta'} · {dos ? 'dos caras' : 'una cara'} · {cfg.institucion.tamanoLetra.replace('pt', ' puntos')} · interlineado {cfg.institucion.interlineado.replace('.', ',')}</dd>
              <dt className="text-muted">Márgenes</dt><dd>{MARGENES.map((key, idx) => [dos ? 'interior' : 'izquierdo', dos ? 'exterior' : 'derecho', 'superior', 'inferior'][idx] + ' ' + cfg.institucion[key].replace('mm', ' mm')).join(' · ')}</dd>
              <dt className="text-muted">Fuente</dt><dd>{FUENTES_TEXTO.find(([value]) => value === cfg.institucion.fuenteTexto)?.[1]}</dd>
              <dt className="text-muted">Títulos</dt><dd>{NIVELES_TITULOS.map(([nivel, label]) => label + ': ' + cfg.institucion['tamano' + nivel] + ' puntos').join(' · ')}</dd>
              <dt className="text-muted">Numeración</dt><dd>{NUMERACION_PAGINAS.find(([value]) => value === cfg.institucion.numeracionPaginas)?.[1]}</dd>
              <dt className="text-muted">Cabeceras y pies</dt><dd>{cfg.institucion.estiloPagina === 'actual' ? 'Diseño de la plantilla' : 'Posiciones personalizadas'}</dd>
              <dt className="text-muted">Índices</dt><dd>{TIPOS_INDICE.filter(([key]) => cfg.institucion[key] === 'si').map(([, label]) => label).join(', ') || 'Ninguno'}</dd>
              <dt className="text-muted">Títulos numerados</dt><dd>{NIVELES_APARTADOS.find(([value]) => value === cfg.institucion.numerarHasta)?.[1]}</dd>
              <dt className="text-muted">Contenido del índice general</dt><dd>{NIVELES_APARTADOS.find(([value]) => value === cfg.institucion.indiceHasta)?.[1]}</dd>
              <dt className="text-muted">Capítulos</dt><dd>{cfg.capitulos.join(' → ')}</dd>
              <dt className="text-muted">Otros apartados</dt><dd>{EXTRA.filter(([key]) => cfg.apartados[key]).map(([, label]) => label).join(', ') || 'Ninguno'}</dd>
            </dl>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Dónde guardar la memoria</h3>
              {destino ? <p className="break-all rounded-md bg-soft p-3 text-sm">{destino}</p> : <p className="text-sm text-muted">Elige una carpeta nueva o una carpeta vacía.</p>}
              <Button size="md" onClick={() => setPicker(true)}><FolderOpen size={15} />{destino ? 'Cambiar ubicación…' : 'Elegir ubicación…'}</Button>
            </div>
            <p className="text-sm text-muted">Se creará y abrirá una memoria nueva. Los ajustes seguirán disponibles en Datos del trabajo; los capítulos, en Documento.</p>
          </>}
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
    {picker && <DirPicker open title="Guardar la nueva memoria" onClose={() => setPicker(false)} mode="create"
      allowedRoots={settings.allowedRoots} pathSep={settings.pathSep} initialPath={parentAbs(settings.values.memoriaDir, settings.pathSep) || undefined}
      defaultName="mi-memoria" selectLabel="Usar esta ubicación" hint="Todavía no se creará nada. Podrás revisar la ubicación antes de continuar."
      onSelect={(dir) => { setDestino(dir); setPicker(false); setError(null); }} />}
    {portadas && <PortadasDialog initial={cfg.portadas!} datos={cfg.datos} institucion={cfg.institucion}
      onClose={() => setPortadas(false)} saveLabel="Usar composición" onSave={async (value) => setCfg((prev) => ({ ...prev, portadas: value }))} />}
  </>;
}
