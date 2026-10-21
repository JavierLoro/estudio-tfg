import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { escapeVisualText, inlineVisual, visualCaret, visualClipboard, visualEdit, visualLines, visualRange } from '../../web/src/lib/latexVisual.ts';

const fixture = String.raw`% Comentario que no se modifica
\newcommand{\nombre}[1]{Ejemplo #1}
\section{Título con \emph{énfasis}}
Texto con \textbf{negrita y \emph{cursiva}} y 20\%.

\begin{itemize}
\item Primera
\begin{enumerate}
\item Interna
\item Otra
\end{enumerate}
\item Segunda
\end{itemize}
\begin{figure}[h]
\caption{Una macro {anidada}}
\begin{minipage}{.5\textwidth}
Texto dentro de un entorno desconocido.
\end{minipage}
\end{figure}
\personalizada{
  argumento {anidado}
}
Texto final con \cite{Manual2026}.
`;

describe('LaTeX visual sin serializar fuentes', () => {
  it.each([fixture, fixture.replaceAll('\n', '\r\n'), '\\verb|\\macro{literal}|\n', '\\textbf{sin cerrar', 'áéíóú 😀 & # $ % _ { } \\'])('analizar no cambia ningún byte del documento', (source) => {
    const before = source;
    const lines = visualLines(source);
    expect(source).toBe(before);
    expect(lines.map((line, i) => source.slice(line.from, lines[i + 1]?.from ?? source.length)).join('')).toBe(source);
    for (const line of lines) for (const span of line.spans) {
      expect(span.from).toBeGreaterThanOrEqual(line.from);
      expect(span.to).toBeLessThanOrEqual(line.to);
    }
  });

  it('presenta formato anidado y listas, y deja macros, comentarios y entornos especiales en código', () => {
    const lines = visualLines(fixture);
    expect(lines[0].kind).toBe('code');
    expect(lines[1].kind).toBe('code');
    expect(lines[2]).toMatchObject({ kind: 'heading', level: 2 });
    expect(lines[3].spans.map((span) => span.kind)).toContain('bold');
    expect(lines[3].spans.map((span) => span.kind)).toContain('italic');
    expect(lines.filter((line) => line.kind === 'item').map((line) => line.indent)).toEqual([0, 1, 1, 0]);
    expect(lines.filter((line) => line.kind === 'item').map((line) => line.bullet)).toEqual(['• ', '1. ', '2. ', '• ']);
    expect(lines.slice(13, 22).every((line) => line.kind === 'code')).toBe(true);
    expect(lines[22].spans.some((span) => span.kind === 'citation')).toBe(true);
  });

  it('solo reemplaza el rango de texto elegido y conserva todo su contexto literal', () => {
    const from = fixture.indexOf('Primera');
    const edit = visualEdit(fixture, from, from + 7, 'textbf')!;
    const after = fixture.slice(0, edit.from) + edit.insert + fixture.slice(edit.to);
    expect(after).toBe(fixture.replace('Primera', '\\textbf{Primera}'));
    expect(visualEdit(fixture, fixture.indexOf('Comentario'), fixture.indexOf('Comentario') + 10, 'emph')).toBeNull();
  });

  it('cambia títulos conservando el contenido, sin duplicar comandos ni borrar formato', () => {
    const source = '\\section{Título \\emph{importante}}';
    const heading = visualEdit(source, 12, 12, 'subsection')!;
    expect(heading.insert).toBe('\\subsection{Título \\emph{importante}}');
    expect(visualEdit(heading.insert, 14, 14, 'paragraph')?.insert).toBe('Título \\emph{importante}');
    expect(visualEdit('\\section*{Título}', 12, 12, 'chapter')?.insert).toBe('\\chapter*{Título}');
    expect(visualEdit('\\section{Título} % no borrar', 12, 12, 'paragraph')).toBeNull();
  });

  it('crea listas solo con párrafos soportados y rechaza rangos desequilibrados', () => {
    expect(visualEdit('Uno\nDos', 0, 7, 'enumerate')?.insert).toBe('\\begin{enumerate}\n\\item Uno\n\\item Dos\n\\end{enumerate}');
    expect(visualEdit('Uno\n\\macro{dos}', 0, 15, 'itemize')).toBeNull();
    expect(visualEdit('Texto \\emph{cursiva}', 0, 16, 'textbf')).toBeNull();
    expect(visualEdit('Texto', 0, 0, 'cite:Manual2026')?.insert).toBe('\\cite{Manual2026}');
    expect(visualEdit('Texto', 0, 0, 'cite:x}\\input{secreto')).toBeNull();
  });

  it('no interpreta comandos dentro de verb ni entornos literales, y conserva fórmulas en código', () => {
    const source = String.raw`\verb|\begin{figure}|
Texto normal.
\begin{verbatim}
\begin{figure}
\end{verbatim}
Texto normal otra vez.
\[
x + y
\]
`;
    const lines = visualLines(source);
    expect(lines.map((line) => line.kind)).toEqual(['code', 'text', 'code', 'code', 'code', 'text', 'code', 'code', 'code', 'text']);
  });

  it('copia el texto visible sin volver a pegar comandos como texto escapado', () => {
    expect(visualClipboard('Texto \\textbf{importante} al 20\\%.')).toBe('Texto importante al 20%.');
    expect(visualClipboard('\\section{Título}\nTexto \\cite{Manual2026}.')).toBe('Título\nTexto [Manual2026].');
    expect(visualClipboard('\\macro{se conserva}')).toBe('\\macro{se conserva}');
  });

  it('copia rangos parciales usando el formato de la fuente completa, sin llaves invisibles', () => {
    const source = String.raw`Antes \textbf{énfasis a lo importante} y utilizar \emph{cursivas}.`;
    expect(visualClipboard(source, source.indexOf('lo importante'), source.indexOf('utilizar') + 8)).toBe('lo importante y utilizar');
    const nested = String.raw`Antes \textbf{texto \emph{muy importante} y largo} después.`;
    expect(visualClipboard(nested, nested.indexOf('importante'), nested.indexOf('después') + 7)).toBe('importante y largo después');
    expect(visualClipboard(nested, nested.indexOf('Antes'), nested.indexOf('importante') + 10)).toBe('Antes texto muy importante');
    const unknown = '\\macro{dato {literal}}';
    expect(visualClipboard(unknown, 7, unknown.length)).toBe(unknown.slice(7));
  });

  it.each([String.raw`\% de mejora`, String.raw`\cite{Manual2026} indica`])('permite insertar antes y después de un widget visible: %s', (source) => {
    const end = source.indexOf(' ');
    expect(visualCaret(source, 0)).toBe(0);
    expect(visualRange(source, 0, 0)).toEqual({ from: 0, to: 0 });
    expect(visualCaret(source, end)).toBe(end);
    expect(visualRange(source, end, end)).toEqual({ from: end, to: end });
    expect(visualCaret(source, 1)).toBe(0);
  });

  it('edita y cambia títulos con etiquetas finales conservadas literalmente, incluso títulos vacíos', () => {
    const source = String.raw`\chapter{Metodología \emph{aplicada}}\label{cap:metodologia} \label{sec:metodo}  `;
    const [line] = visualLines(source);
    expect(line.kind).toBe('heading');
    expect(source.slice(line.body, line.bodyEnd)).toBe(String.raw`Metodología \emph{aplicada}`);
    const changed = visualEdit(source, line.body, line.bodyEnd, 'section')!;
    expect(changed.insert).toBe(source.replace('chapter', 'section'));
    const paragraph = visualEdit(source, line.body, line.bodyEnd, 'paragraph')!;
    expect(paragraph.insert).toBe(String.raw`Metodología \emph{aplicada}\label{cap:metodologia} \label{sec:metodo}  `);
    expect(visualLines(paragraph.insert)[0].kind).toBe('text');
    expect(visualEdit(paragraph.insert, 0, 0, 'chapter')?.insert).toBe(source);
    expect(visualRange(source, 0, source.length)).toEqual({ from: line.body, to: line.bodyEnd });
    const empty = source.slice(0, line.body) + source.slice(line.bodyEnd);
    expect(visualLines(empty)[0]).toMatchObject({ kind: 'heading', body: line.body, bodyEnd: line.body });
    expect(visualCaret(empty, 0)).toBe(line.body);
    expect(visualLines(String.raw`\chapter{Título}\label{}`)[0].kind).toBe('code');
  });

  it.each(['templates/perfiles/generico/1-capitulos/04-desarrollo.tex', 'templates/base/2-anexos/a-anexo.tex'])('reconoce los capítulos/anexos reales de plantilla sin convertir su fuente: %s', async (path) => {
    const source = await fs.readFile(new URL('../../' + path, import.meta.url), 'utf8');
    const line = visualLines(source)[0];
    expect(line.kind).toBe('heading');
    const edit = visualEdit(source, line.body, line.body, 'section')!;
    expect(edit.insert).toContain(source.slice(line.bodyEnd + 1, line.to));
    expect(visualClipboard(source, line.from, line.to)).toBe(source.slice(line.body, line.bodyEnd));
  });

  it('seleccionar el título visual conserva sus delimitadores e incluye solo el texto', () => {
    expect(visualRange('\\section{Título}', 0, 16)).toEqual({ from: 9, to: 15 });
    expect(visualRange('\\section{Título}', 9, 15)).toEqual({ from: 9, to: 15 });
    expect(visualRange('\\section{Título}', 0, 15)).toEqual({ from: 9, to: 15 });
  });

  it('sitúa el cursor dentro de los títulos al entrar en Visual', () => {
    expect(visualCaret('\\section{Título}', 0)).toBe(9);
    expect(visualCaret('Texto normal', 0)).toBe(0);
  });

  it('escapa texto literal y lo puede volver a presentar sin tratarlo como LaTeX activo', () => {
    const escaped = escapeVisualText('20% & precio $5 #1 _ {dato} \\ ^ ~');
    expect(escaped).toBe('20\\% \\& precio \\$5 \\#1 \\_ \\{dato\\} \\textbackslash{} \\textasciicircum{} \\textasciitilde{}');
    expect(inlineVisual(escaped)).not.toBeNull();
    expect(inlineVisual('\\textbf{sin cerrar')).toBeNull();
    expect(inlineVisual('\\textbf{'.repeat(40) + 'x' + '}'.repeat(40))).toBeNull();
  });
});
