/** Separador del documento; los archivos sin saltos nuevos usan LF. */
export const eolOf = (s: string) => (s.includes('\r\n') ? '\r\n' : '\n');
