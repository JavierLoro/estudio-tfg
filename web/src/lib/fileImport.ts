import { basename, dirname, ext, stripExt } from './paths';
import { escapeVisualText } from './latexVisual';

export function canInsertFile(editorPath: string, filePath: string): boolean {
  return ext(editorPath) === 'md' || (ext(editorPath) === 'tex' && ['png', 'jpg', 'jpeg', 'pdf'].includes(ext(filePath)));
}

export function importedFileText(editorPath: string, filePath: string, label: string): string {
  if (!canInsertFile(editorPath, filePath)) return '';
  const title = stripExt(basename(filePath));
  if (ext(editorPath) === 'tex') {
    if (/[{}%\\^\r\n]/.test(filePath)) throw new Error('Para insertar la figura, elige una carpeta sin llaves, %, ^ ni barras invertidas.');
    return ['\\begin{figure}[htbp]', '  \\centering', `  \\includegraphics[width=0.8\\textwidth]{\\detokenize{${filePath}}}`,
      `  \\caption{${escapeVisualText(title)}}`, `  \\label{fig:archivo-${label}}`, '\\end{figure}'].join('\n');
  }
  const from = dirname(editorPath).split('/').filter(Boolean), to = filePath.split('/');
  while (from.length && from[0] === to[0]) { from.shift(); to.shift(); }
  const relative = [...from.map(() => '..'), ...to].map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)).join('/');
  const image = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'].includes(ext(filePath));
  return `${image ? '!' : ''}[${title.replace(/[\[\]\\]/g, '\\$&')}](${relative})`;
}

export const hasDroppedFiles = (transfer: DataTransfer | null) => !!transfer?.types.includes('Files');
