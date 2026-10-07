import { describe, expect, it } from 'vitest';
import { absCrumbs, isAbsPath, joinAbs, parentAbs, relUnder, splitAbs } from '../../web/src/lib/abspath.ts';

describe('rutas absolutas del servidor', () => {
  it.each(['/notas', '/', '~', '~/notas', '~\\notas', 'C:\\', 'c:/notas', '\\\\srv\\share\\notas'])('acepta %s', (p) => {
    expect(isAbsPath(p)).toBe(true);
  });
  it.each(['notas', 'C:notas', '~otro', '\\notas', ''])('rechaza %s', (p) => {
    expect(isAbsPath(p)).toBe(false);
  });
  it.each([
    ['/a/b/', '/', ['a', 'b']],
    ['C:\\', 'C:\\', []],
    ['c:/a/b', 'c:/', ['a', 'b']],
    ['C:\\a/b\\c', 'C:\\', ['a', 'b', 'c']],
    ['\\\\srv\\share\\a/b', '\\\\srv\\share\\', ['a', 'b']],
    ['\\\\srv\\share', '\\\\srv\\share\\', []],
    ['~\\a/b', '~', ['a', 'b']],
  ] as const)('separa %s', (p, root, parts) => {
    expect(splitAbs(p)).toEqual({ root, parts });
  });
  it('une y obtiene padres sin perder raíces', () => {
    expect(joinAbs('C:\\', 'a/b', '\\')).toBe('C:\\a\\b');
    expect(joinAbs('/notas/', 'Recursos', '/')).toBe('/notas/Recursos');
    expect(parentAbs('C:\\a', '\\')).toBe('C:\\');
    expect(parentAbs('\\\\srv\\share\\a', '\\')).toBe('\\\\srv\\share\\');
    expect(parentAbs('/a', '/')).toBe('/');
    expect(parentAbs('~\\a', '\\')).toBe('~');
  });
  it.each([
    ['/a/', '/a/b', 'b'],
    ['/a', '/a', ''],
    ['/', '/a/b', 'a/b'],
    ['C:\\Notas', 'c:/notas/Recursos\\PDF', 'Recursos/PDF'],
    ['C:\\', 'c:/notas', 'notas'],
    ['\\\\srv\\share\\notas', '\\\\SRV\\SHARE\\Notas\\Recursos', 'Recursos'],
    ['/a', '/ab/c', null],
    ['/A', '/a/b', null],
    ['C:\\a', 'D:\\a\\b', null],
    ['\\\\srv\\share', '\\\\srv\\otro\\a', null],
    ['/a', '/a/../fuera', null],
    ['/a', 'relativa', null],
  ])('relativa de %s a %s', (base, p, expected) => {
    expect(relUnder(base, p)).toBe(expected);
  });
  it('migas de raíz POSIX y de la raíz permitida más próxima', () => {
    expect(absCrumbs('/a/b', [], '/')).toEqual([{ label: '/', path: '/' }, { label: 'a', path: '/a' }, { label: 'b', path: '/a/b' }]);
    expect(absCrumbs('c:/Notas/Recursos/PDF', ['C:\\', 'C:\\Notas'], '\\')).toEqual([
      { label: 'C:\\Notas', path: 'C:\\Notas' },
      { label: 'Recursos', path: 'C:\\Notas\\Recursos' },
      { label: 'PDF', path: 'C:\\Notas\\Recursos\\PDF' },
    ]);
    expect(absCrumbs('\\\\srv\\share\\a', [], '\\')[0]).toEqual({ label: '\\\\srv\\share\\', path: '\\\\srv\\share\\' });
  });
});
