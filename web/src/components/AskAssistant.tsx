import { Bot } from 'lucide-react';
import type { Root } from '../api';
import { useDesktop } from '../state/desktop';
import { useDocs } from '../state/docs';
import { openAssistant } from '../state/workspace';
import { editorViews } from '../lib/editorInsert';
import { IconButton } from './ui';

export function AskAssistant({ root, path, resource = false }: { root: Root; path: string; resource?: boolean }) {
  const desktop = useDesktop(s => !!s.info);
  if (!desktop) return null;
  return <IconButton label={resource ? 'Enviar ficha al asistente' : 'Enviar selección o documento al asistente'} onClick={() => {
    const view = editorViews.get(`${root}:${path}`), selection = view?.state.selection.main;
    const text = selection && !selection.empty ? view!.state.sliceDoc(selection.from, selection.to) : useDocs.getState().docs[`${root}:${path}`]?.content;
    openAssistant({ root, path, ...(text !== undefined ? { text } : {}) });
  }}><Bot size={14} /></IconButton>;
}
