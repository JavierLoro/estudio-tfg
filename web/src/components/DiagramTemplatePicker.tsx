import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DIAGRAM_TEMPLATES, type DiagramTemplate } from '../lib/diagramTemplates';
import { renderAppMermaid } from '../lib/mermaid';
import { IconButton, Spinner } from './ui';

function Example({ template }: { template: DiagramTemplate }) {
  const id = `et-template-${useId().replace(/[^\w-]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const sandbox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    // Evitar dibujos que ya no se van a mostrar al recorrer varios tipos con las flechas.
    const timer = setTimeout(() => {
      void renderAppMermaid(id, template.example ?? template.source, sandbox.current ?? undefined)
        .then(result => { if (alive) setSvg(result.svg); })
        .catch(() => { if (alive) setError(true); });
    }, 100);
    return () => { alive = false; clearTimeout(timer); };
  }, [id, template]);
  return <div className="relative flex h-52 items-center justify-center overflow-hidden rounded-md border border-line bg-soft p-3">
    {/* Mermaid mide el ejemplo dentro de su ancho real, sin alterar los nodos que controla React. */}
    <div ref={sandbox} aria-hidden="true" className="pointer-events-none invisible absolute inset-3" />
    {error ? <p role="alert" className="text-[12px] text-muted">No se pudo dibujar el ejemplo. Puedes crear el diagrama igualmente.</p>
      : svg ? <div role="img" aria-label={`Ejemplo de ${template.label}`} className="h-full w-full [&_svg]:h-full! [&_svg]:w-full! [&_svg]:max-w-none!"
        dangerouslySetInnerHTML={{ __html: svg }} />
        : <span role="status" className="flex items-center gap-2 text-[12px] text-muted"><Spinner />Dibujando ejemplo…</span>}
  </div>;
}

const previews = import.meta.glob('../assets/excalidraw/*.svg', { query: '?url', import: 'default', eager: true });
export function DiagramTemplatePicker({ value, onChange, format = 'mermaid' }: { value: string; onChange: (id: string) => void; format?: 'mermaid' | 'excalidraw' }) {
  const templates = format === 'excalidraw' ? [{ id: 'vacio', label: 'En blanco', description: '', source: '' }, ...DIAGRAM_TEMPLATES.slice(0, 6)] : DIAGRAM_TEMPLATES;
  const index = Math.max(0, templates.findIndex(t => t.id === value));
  const template = templates[index];
  const move = (step: number) => onChange(templates[(index + step + templates.length) % templates.length].id);
  return <div role="group" aria-roledescription="carrusel" aria-label="Tipo de diagrama"
    tabIndex={0} className="rounded-lg border border-line p-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
    onKeyDown={e => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'Home') onChange(templates[0].id);
      else if (e.key === 'End') onChange(templates.at(-1)!.id);
      else move(e.key === 'ArrowLeft' ? -1 : 1);
    }}>
    <div className="flex items-center gap-2 pb-2">
      <IconButton label="Tipo anterior" onClick={() => move(-1)} className="h-9 w-9 border border-line-strong"><ChevronLeft size={18} /></IconButton>
      <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1 text-center">
        <h3 className="text-[14px] font-semibold">{template.label}</h3>
      </div>
      <IconButton label="Tipo siguiente" onClick={() => move(1)} className="h-9 w-9 border border-line-strong"><ChevronRight size={18} /></IconButton>
    </div>
    {format === 'mermaid' ? <Example key={template.id} template={template} /> : <div className="flex h-52 items-center justify-center rounded-md border border-line bg-white p-3">{template.id === 'vacio' ? <div role="img" aria-label="Lienzo en blanco" className="h-full w-full" /> : <img alt={`Ejemplo de ${template.label}`} src={previews[`../assets/excalidraw/${template.id}.svg`] as string} className="h-full w-full object-contain" />}</div>}
  </div>;
}
