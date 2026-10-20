import { useAssistant, type AssistantContext } from '../state/assistant';
import { getDock, useActivePanel } from '../state/workspace';
import { useUI } from '../state/ui';
import { assistantContext } from './AskAssistant';
import { Button } from './ui';

export function AssistantActions({ disabled, onChoose }: { disabled: boolean; onChoose: (context: AssistantContext, prompt: string) => void }) {
  const context = useAssistant(s => s.context);
  const hasMessages = useAssistant(s => !!s.thread?.messages.length);
  const section = useUI(s => s.section), resources = useUI(s => s.status?.resourcesSubdir);
  useActivePanel(s => s.id);
  const params = getDock(section)?.activePanel?.params;
  const target = context.at(-1) ?? (params && ['notes', 'memoria'].includes(params.root) && typeof params.path === 'string' ? { root: params.root, path: params.path } : null);
  if (!target) return <p className="text-muted">Puedes preguntar sin documentos. Para trabajar sobre uno, ábrelo en Memoria, Notas, Diagramas o Biblioteca.</p>;
  const library = target.root === 'notes' && resources && (target.path === resources || target.path.startsWith(resources + '/'));
  const diagram = /\.mmd$/i.test(target.path);
  const actions = [
    { label: diagram ? 'Explicar diagrama' : 'Explicar documento', prompt: 'Explica de forma sencilla el contenido adjunto, sin modificar archivos.' },
    { label: library ? 'Resumir recurso' : 'Resumir', prompt: 'Resume el contenido adjunto y sus ideas principales. Distingue lo que dice la fuente de tus inferencias.' },
    { label: diagram ? 'Revisar diagrama' : library ? 'Revisar datos bibliográficos' : 'Mejorar redacción', prompt: diagram ? 'Señala ambigüedades y posibles mejoras del diagrama adjunto. No modifiques archivos.' : library ? 'Revisa los datos bibliográficos adjuntos y señala campos incompletos. No inventes referencias ni modifiques archivos.' : 'Propón una redacción más clara del texto adjunto, conservando su significado, comandos y referencias. Si tienes permiso, prepara una propuesta revisable; no apliques cambios.' },
  ];
  return <details open={!hasMessages} className="space-y-2 rounded border border-line p-2">
    <summary className="cursor-pointer break-all font-medium">Acciones para {target.path}</summary>
    <div aria-label="Acciones sugeridas" className="flex flex-wrap gap-2">{actions.map(action => <Button key={action.label} disabled={disabled} onClick={() => onChoose(context.at(-1) ?? assistantContext(target.root, target.path), action.prompt)}>{action.label}</Button>)}</div>
    <p className="text-muted">Prepara el mensaje para que lo revises. Solo se envía al pulsar Enviar.</p>
  </details>;
}
