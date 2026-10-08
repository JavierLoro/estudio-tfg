import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expandPath, parseAllowedRoots, repoGuardError } from '../src/config.ts';
import { isInside, normalizeRel, toPosix, validSegment } from '../src/paths.ts';
import { absCrumbs, isAbsPath, joinAbs, parentAbs, relUnder, splitAbs } from '../../web/src/lib/abspath.ts';

afterEach(() => vi.restoreAllMocks());

const absent = () => vi.spyOn(fs.realpathSync, 'native').mockImplementation(() => {
  throw Object.assign(new Error('Ruta ficticia inexistente'), { code: 'ENOENT' });
});

describe('rutas Windows desde cualquier sistema', () => {
  it.each([
    ['C:\\', 'c:/Notas', true],
    ['C:\\Notas', 'C:\\Notas\\..datos', true],
    ['C:\\Notas', 'C:\\Notas2', false],
    ['C:\\Notas', 'D:\\Notas', false],
    ['\\\\servidor\\recurso', '//SERVIDOR/recurso/Notas', true],
    ['\\\\servidor\\recurso', '\\\\servidor\\otro\\Notas', false],
    ['\\\\?\\C:\\Notas', '\\\\?\\c:\\Notas\\hija', true],
    ['C:\\Notas', '\\\\?\\C:\\Notas\\hija', true],
    ['\\\\?\\C:\\Notas', 'c:/Notas/hija', true],
    ['\\\\srv\\share', '\\\\?\\UNC\\srv\\share\\Notas', true],
    ['\\\\?\\UNC\\servidor\\recurso', '\\\\?\\UNC\\servidor\\recurso\\Notas', true],
    ['C:\\Notas', 'C:\\Notas\\..\\fuera', false],
  ] as const)('%s contiene %s = %s', (base, child, expected) => {
    expect(isInside(base, child, path.win32)).toBe(expected);
  });

  it.each([path.posix, path.win32])('normalizar relativas no debilita la API con %j', (paths) => {
    expect(normalizeRel('./Carpeta//nota.md', false, paths)).toBe('Carpeta/nota.md');
    expect(normalizeRel('', true, paths)).toBe('');
    for (const value of ['../nota', 'Carpeta/../nota', '/notas', 'C:/notas', 'C:notas', 'a:b', '\\\\srv\\share', '\\\\?\\C:\\notas', 'Carpeta\\nota', '\0', '']) {
      expect(() => normalizeRel(value, false, paths)).toThrow();
    }
    expect(toPosix('Carpeta\\nota.md', path.win32)).toBe('Carpeta/nota.md');
    expect(toPosix('Carpeta/nota.md', path.posix)).toBe('Carpeta/nota.md');
  });

  it('expande home, unidades, UNC y rutas mezcladas sin consultar discos reales', () => {
    absent();
    vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\Ficticio');
    expect(expandPath('~\\Notas', 'D:\\repo', path.win32)).toBe('C:\\Users\\Ficticio\\Notas');
    expect(expandPath('C:/Notas\\hija', 'D:\\repo', path.win32)).toBe('C:\\Notas\\hija');
    expect(parseAllowedRoots('C:\\Notas;D:/Memoria;\\\\srv\\share;\\\\?\\C:\\larga', 'C:\\repo', path.win32))
      .toEqual(['C:\\Notas', 'D:\\Memoria', '\\\\srv\\share\\', '\\\\?\\C:\\larga']);
  });

  it.each(['nota.', 'nota ', 'CON', 'aux.tex', 'COM¹', 'LPT³.md', 'a:b', 'carpeta\\nota'])('nombres nuevos rechazan %s también desde POSIX', (name) => {
    expect(validSegment(name)).toBe(false);
  });
});

describe('guardia del repositorio con semántica nativa o inyectada', () => {
  it.each([
    [path.win32, 'C:\\repo', 'c:/REPO/..datos', true],
    [path.win32, 'C:\\repo', 'c:/REPO/WORKSPACE/Notas', false],
    [path.win32, 'C:\\repo', 'C:\\repo\\workspace-x', true],
    [path.win32, 'C:\\repo', 'C:\\repo2\\Notas', false],
    [path.win32, 'C:\\repo', 'D:\\repo\\Notas', false],
    [path.win32, '\\\\srv\\share\\repo', '\\\\SRV\\SHARE\\REPO\\datos', true],
    [path.win32, '\\\\?\\C:\\repo', '\\\\?\\C:\\repo\\datos', true],
    [path.win32, 'C:\\repo', '\\\\?\\C:\\repo\\datos', true],
    [path.win32, '\\\\srv\\share\\repo', '\\\\?\\UNC\\srv\\share\\repo\\datos', true],
    [path.win32, 'C:\\repo', '\\\\?\\C:\\repo\\workspace\\Notas', false],
    [path.posix, '/repo', '/repo/..datos', true],
    [path.posix, '/repo', '/repo/WORKSPACE/notas', true],
    [path.posix, '/repo', '/repo/workspace/notas', false],
    [path.posix, '/repo', '/repo/../notas', false],
  ] as const)('%s: %s → %s, bloqueada=%s', (paths, repo, dir, blocked) => {
    absent();
    expect(repoGuardError('NOTES_DIR', dir, repo, paths) !== null).toBe(blocked);
  });

  it('un alias Windows que entra en una carpeta versionada se bloquea por realpath', () => {
    vi.spyOn(fs.realpathSync, 'native').mockImplementation((p) => {
      const text = String(p).toLowerCase();
      if (text === 'c:\\repo') return 'C:\\Repo';
      if (text === 'x:\\notas') return 'C:\\Repo\\docs';
      throw new Error('No existe');
    });
    expect(repoGuardError('NOTES_DIR', 'X:\\notas', 'C:\\repo', path.win32)).toMatch(/dentro del repositorio/);
  });
});

describe('helpers del navegador independientes del SO de la prueba', () => {
  it.each(['C:\\', '\\\\srv\\share\\', '\\\\?\\C:\\', '\\\\?\\UNC\\srv\\share\\'])('mantiene la raíz de %s', (root) => {
    const full = path.win32.join(root, 'Notas', 'hija');
    expect(isAbsPath(full)).toBe(true);
    expect(splitAbs(full).parts.at(-1)).toBe('hija');
    expect(parentAbs(full, '\\')).toBe(path.win32.dirname(full));
    expect(joinAbs(root, 'Notas/hija', '\\')).toBe(full);
    expect(relUnder(root, full)).toBe('Notas/hija');
    expect(absCrumbs(full, [path.win32.join(root, 'Notas')], '\\').at(-1)?.path).toBe(full);
  });
});
