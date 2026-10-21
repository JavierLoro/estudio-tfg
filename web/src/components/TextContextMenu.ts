import type { KeyboardEvent, MouseEvent } from 'react';
import type { Root } from '../api';
import { assistantContextActions, copyContextText } from './AssistantContextActions';
import { openContextMenu, type MenuItem } from './ContextMenu';

export function textContextMenu({ root, path, content, resource = false, onEdit }: { root: Root; path: string; content: string; resource?: boolean; onEdit?: () => void }) {
  const show = (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, x: number, y: number) => {
    if ((e.target as Element).closest('input,textarea,select,button,a,[contenteditable="true"],[role="menu"]')) return;
    const host = e.currentTarget, selection = window.getSelection();
    const text = selection && host.contains(selection.anchorNode) && host.contains(selection.focusNode) ? selection.toString() : '';
    const subject = text ? 'la selección' : resource ? 'la ficha' : 'la nota';
    const items: MenuItem[] = [
      { label: 'Copiar selección', disabled: !text, run: () => copyContextText(text) },
      { label: 'Seleccionar contenido', run: () => { const range = document.createRange(); range.selectNodeContents(host); const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); } },
      ...(onEdit ? [{ label: resource ? 'Editar ficha' : 'Editar nota', run: onEdit }] : []),
      ...assistantContextActions({ root, path, text: text || content, selection: !!text }, subject, !resource),
    ];
    e.stopPropagation(); host.focus({ preventScroll: true });
    openContextMenu({ clientX: x, clientY: y, preventDefault: () => e.preventDefault() }, items, text ? 'Texto seleccionado' : resource ? 'Biblioteca' : 'Nota · Vista previa');
  };
  return {
    onContextMenu: (e: MouseEvent<HTMLElement>) => show(e, e.clientX, e.clientY),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      const rect = e.currentTarget.getBoundingClientRect(); show(e, rect.left + 12, rect.top + 12);
    },
  };
}
