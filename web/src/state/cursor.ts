import { create } from 'zustand';

/** Línea del cursor de cada editor abierto (docKey → línea, 1-based). */
export const useCursor = create<{ lines: Record<string, number> }>(() => ({ lines: {} }));

export function setCursorLine(key: string, line: number) {
  const s = useCursor.getState();
  if (s.lines[key] === line) return;
  useCursor.setState({ lines: { ...s.lines, [key]: line } });
}
