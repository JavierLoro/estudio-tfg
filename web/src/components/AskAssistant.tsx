import { Bot } from 'lucide-react';
import type { Root } from '../api';
import { useDesktop } from '../state/desktop';
import { useDocs } from '../state/docs';
import { openAssistant } from '../state/workspace';
import { editorViews } from '../lib/editorInsert';
import { IconButton } from './ui';

export function assistantContext(root: Root, path: string) {
  const view = editorViews.get(`${root}:${path}`), selection = view?.state.selection.main;
  const selected = !!selection && !selection.empty;
  const text = selected ? view!.state.sliceDoc(selection!.from, selection!.to) : useDocs.getState().docs[`${root}:${path}`]?.content;
  return { root, path, ...(text !== undefined ? { text } : {}), selection: selected };
}

export function AskAssistant({ root, path, resource = false }: { root: Root; path: string; resource?: boolean }) {
  const desktop = useDesktop(s => !!s.info);
  if (!desktop) return null;
  return <IconButton label={resource ? 'Enviar ficha al asistente' : 'Enviar selección o documento al asistente'} onClick={() => {
    openAssistant(assistantContext(root, path));
  }}><Bot size={14} /></IconButton>;
}
