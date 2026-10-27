import { expect, it } from 'vitest';
// @ts-expect-error Resolución bundler del cliente; Vitest transpila estos módulos.
import { mapSource, memoryLink, nodeBranch } from '../../web/src/lib/libraryMap';
// @ts-expect-error Resolución bundler del cliente.
import { bodyInsertionPosition } from '../../web/src/lib/editorInsert';

it('el mapa representa jerarquía y relaciones sin permitir inyectar sintaxis Mermaid', () => {
  const map = { version: 1, nodes: [{ id: 'a', parent: null, title: 'Tema "<img>"\nclick n0 "https://example.org"', note: '' }, { id: 'b', parent: 'a', title: 'Fuente', note: '' }], links: [{ id: 'c', from: 'b', to: 'a', label: 'Respalda "idea"' }] };
  const source = mapSource(map);
  expect(source).toContain('n0 -.-> n1');
  expect(source).toContain('n1 -- "Respalda &#34;idea&#34;" --> n0');
  expect(source).not.toMatch(/\nclick/);
  expect(source).not.toContain('<img>');
  expect([...nodeBranch(map, 'a')]).toEqual(['a', 'b']);
});

it('prepara enlaces HTTP sin comandos LaTeX procedentes de título o URL', () => {
  expect(memoryLink('https://example.org/a?q=1&x=2#parte', 'A & B')).toBe('\\href{https://example.org/a?q=1\\&x=2\\#parte}{A \\& B}');
  expect(() => memoryLink('javascript:alert(1)', 'Ficticio')).toThrow();
  expect(() => memoryLink('https://usuario:clave@example.org', 'Ficticio')).toThrow();
  expect(memoryLink('https://example.org/{x}', '\\input{secreto}')).toContain('\\textbackslash{}input\\{secreto\\}');
});

it('sitúa contenido en el cuerpo sin tomar delimitadores comentados ni romper el cursor de un capítulo', () => {
  const source = '% \\begin{document} comentado\n\\documentclass{article}\n\\begin{document}% inicio\nTexto 50\\% válido.\n\\end{document}\n';
  const begin = source.indexOf('\\begin{document}', source.indexOf('\\documentclass')) + '\\begin{document}'.length;
  expect(bodyInsertionPosition(source, 0)).toBe(begin);
  expect(bodyInsertionPosition(source, source.length)).toBe(source.lastIndexOf('\\end{document}'));
  expect(bodyInsertionPosition(source, source.indexOf('válido'))).toBe(source.indexOf('válido'));
  expect(bodyInsertionPosition('\\chapter{Uno}\nTexto.', 8)).toBe(8);
});
