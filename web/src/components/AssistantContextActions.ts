import type { AssistantContext } from '../state/assistant';
import { useAssistant } from '../state/assistant';
import { useDesktop } from '../state/desktop';
import { openAssistant } from '../state/workspace';
import { toast } from '../state/ui';
import type { MenuItem } from './ContextMenu';

export function copyContextText(text: string) {
  if (!navigator.clipboard) { toast({ kind: 'error', text: 'No se pudo copiar. Usa el atajo de copiar del sistema.' }); return; }
  void navigator.clipboard.writeText(text).catch(() => toast({ kind: 'error', text: 'No se pudo copiar. Usa el atajo de copiar del sistema.' }));
}

/** Las acciones solo preparan el mensaje: los permisos y el envío se revisan en el asistente. */
export function assistantContextActions(context: AssistantContext, subject: string, improve = false, menuSubject = subject): MenuItem[] {
  if (!useDesktop.getState().info) return [];
  const prepare = (prompt: string) => {
    const draft = useAssistant.getState().draft;
    openAssistant(context);
    useAssistant.setState({ draft: draft.trim() ? draft + '\n\n' + prompt : prompt });
  };
  return [
    { label: `Asistente: explicar ${menuSubject}`, run: () => prepare(`Explica ${subject} del contenido adjunto de forma sencilla. No modifiques archivos.`) },
    { label: `Asistente: resumir ${menuSubject}`, run: () => prepare(`Resume ${subject} del contenido adjunto. Distingue lo que dice la fuente de tus inferencias. No modifiques archivos.`) },
    ...(improve ? [{ label: 'Asistente: mejorar redacción', run: () => prepare(`Propón una redacción más clara de ${subject} del contenido adjunto. Conserva significado, comandos y referencias. Si tienes permiso, prepara una propuesta para revisar; no apliques cambios.`) }] : []),
  ];
}
