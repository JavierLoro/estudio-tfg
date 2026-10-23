import { expect, it } from 'vitest';
// @ts-expect-error Resolución bundler del cliente; Vitest transpila estos módulos.
import { importedFileText } from '../../web/src/lib/fileImport';

it('genera figuras con nombres seguros y escapa el pie; no introduce formatos incompatibles', () => {
  const text = importedFileText('capitulos/uno.tex', 'figuras/100 & resultado.png', 'ficticio');
  expect(text).toContain('\\includegraphics[width=0.8\\textwidth]{\\detokenize{figuras/100 & resultado.png}}');
  expect(text).toContain('\\caption{100 \\& resultado}');
  expect(text).toContain('\\label{fig:archivo-ficticio}');
  expect(importedFileText('uno.tex', 'imagen.webp', 'ficticio')).toBe('');
  expect(importedFileText('uno.bib', 'imagen.png', 'ficticio')).toBe('');
  expect(() => importedFileText('uno.tex', 'figuras/romper%codigo.png', 'ficticio')).toThrow();
});

it('genera imágenes y enlaces Markdown relativos con espacios, tildes y caracteres de URL', () => {
  expect(importedFileText('notas/capitulo/uno.md', 'notas/adjuntos/gráfico & datos.png', 'ficticio'))
    .toBe('![gráfico & datos](../adjuntos/gr%C3%A1fico%20%26%20datos.png)');
  expect(importedFileText('uno.md', 'adjuntos/Documento (2).pdf', 'ficticio'))
    .toBe('[Documento (2)](adjuntos/Documento%20%282%29.pdf)');
});
