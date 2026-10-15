import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { Bot, GripHorizontal, Minus, Square, X } from 'lucide-react';
import { AssistantPanel } from '../panels/AssistantPanel';
import { useAssistant } from '../state/assistant';
import { useDesktop } from '../state/desktop';
import { load, save } from '../lib/storage';
import { IconButton } from './ui';

const positionKey = 'et:assistant:position';
export default function AssistantWindow() {
  const desktop = useDesktop(s => !!s.info), visible = useAssistant(s => s.visible), minimized = useAssistant(s => s.minimized);
  const ref = useRef<HTMLElement>(null), drag = useRef<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState(() => {
    const stored = load<{ x: number; y: number } | null>(positionKey, null);
    return stored && Number.isFinite(stored.x) && Number.isFinite(stored.y) ? stored : { x: window.innerWidth - 404, y: window.innerHeight - 544 };
  });
  const current = useRef(position);
  const move = (x: number, y: number) => {
    const rect = ref.current?.getBoundingClientRect();
    const next = { x: Math.max(12, Math.min(x, window.innerWidth - (rect?.width ?? 380) - 12)), y: Math.max(12, Math.min(y, window.innerHeight - (rect?.height ?? 520) - 12)) };
    current.current = next; setPosition(next);
  };
  useLayoutEffect(() => {
    if (!visible || !desktop) return;
    const fit = () => { move(current.current.x, current.current.y); save(positionKey, current.current); };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [visible, minimized, desktop]);
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => { if (previous?.isConnected && !ref.current?.contains(previous) && (document.activeElement === document.body || ref.current?.contains(document.activeElement))) previous.focus({ preventScroll: true }); };
  }, [visible]);
  useEffect(() => { if (visible && !minimized) ref.current?.focus({ preventScroll: true }); }, [visible, minimized]);
  useEffect(() => () => document.body.classList.remove('et-dragging'), []);
  const endDrag = () => { drag.current = null; document.body.classList.remove('et-dragging'); save(positionKey, current.current); };
  const startDrag = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || ((e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('[data-assistant-drag]'))) return;
    e.preventDefault(); drag.current = { x: e.clientX - current.current.x, y: e.clientY - current.current.y };
    e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('et-dragging');
  };
  if (!desktop) return null;
  return <section ref={ref} role="dialog" aria-modal="false" aria-label="Asistente" tabIndex={-1} hidden={!visible}
    className="fixed z-[850] flex flex-col overflow-hidden rounded-xl border border-line-strong bg-bg text-fg shadow-pop outline-none"
    style={{ display: visible ? undefined : 'none', left: position.x, top: position.y, width: `min(${minimized ? 240 : 380}px, calc(100vw - 24px))`, height: minimized ? 'auto' : 'min(520px, calc(100dvh - 24px))' }}>
    <header className="flex shrink-0 touch-none select-none items-center gap-2 border-b border-line bg-soft px-2 py-1.5 cursor-grab active:cursor-grabbing"
      onPointerDown={startDrag} onPointerMove={e => { if (drag.current) move(e.clientX - drag.current.x, e.clientY - drag.current.y); }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
      <Bot size={15} className="text-accent" /><h1 className="flex-1 text-ui font-semibold">Asistente</h1>
      <IconButton label="Mover asistente" data-assistant-drag title="Arrastra la cabecera · flechas: mover" className="cursor-grab" onKeyDown={e => {
        const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const offset = offsets[e.key]; if (!offset) return;
        e.preventDefault(); e.stopPropagation(); const step = e.shiftKey ? 40 : 10;
        move(current.current.x + offset[0] * step, current.current.y + offset[1] * step); save(positionKey, current.current);
      }}><GripHorizontal size={14} /></IconButton>
      <IconButton label={minimized ? 'Restaurar asistente' : 'Minimizar asistente'} onClick={() => useAssistant.setState({ minimized: !minimized })}>{minimized ? <Square size={12} /> : <Minus size={14} />}</IconButton>
      <IconButton label="Cerrar asistente" onClick={() => useAssistant.setState({ visible: false })}><X size={14} /></IconButton>
    </header>
    <div className="min-h-0 flex-1" style={{ display: minimized ? 'none' : undefined }}><AssistantPanel active={visible && !minimized} /></div>
  </section>;
}
