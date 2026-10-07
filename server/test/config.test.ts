import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPO_ROOT, expandPath, loadConfig, parseAllowedRoots } from '../src/config.ts';


describe('config: contenido personal fuera del repo', () => {
  it('acepta carpetas externas y workspace/', () => {
    expect(() => loadConfig({ NOTES_DIR: '/tmp/otra/notas', MEMORIA_DIR: '/tmp/otra/memoria' }, REPO_ROOT)).not.toThrow();
    expect(() => loadConfig({ NOTES_DIR: './workspace/notes', MEMORIA_DIR: './workspace/memoria' }, REPO_ROOT)).not.toThrow();
    expect(() => loadConfig({}, REPO_ROOT)).not.toThrow();
  });
  it('rechaza carpetas versionadas del repo', () => {
    expect(() => loadConfig({ MEMORIA_DIR: './templates/base' }, REPO_ROOT)).toThrow(/dentro del repositorio/);
    expect(() => loadConfig({ NOTES_DIR: './docs' }, REPO_ROOT)).toThrow(/dentro del repositorio/);
    expect(() => loadConfig({ NOTES_DIR: '.' }, REPO_ROOT)).toThrow(/dentro del repositorio/);
    expect(() => loadConfig({ NOTES_DIR: './workspace-x' }, REPO_ROOT)).toThrow(/dentro del repositorio/);
  });
});

describe('config: ALLOWED_ROOTS por sistema', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { name: 'dos unidades Windows', paths: path.win32, base: 'C:\\repo', value: 'C:\\a;D:\\b', expected: ['C:\\a', 'D:\\b'] },
    { name: 'una ruta Windows como la de los tests', paths: path.win32, base: 'C:\\repo', value: 'C:\\Users\\yo\\Temp', expected: ['C:\\Users\\yo\\Temp'] },
    { name: 'espacios, vacíos y duplicados Windows', paths: path.win32, base: 'C:\\repo', value: ' ; C:\\a ; ; D:\\b ; C:\\a ; ', expected: ['C:\\a', 'D:\\b'] },
    { name: 'rutas relativas Windows', paths: path.win32, base: 'C:\\repo', value: '.;..\\notas', expected: ['C:\\repo', 'C:\\notas'] },
    { name: 'dos raíces POSIX', paths: path.posix, base: '/repo', value: '/a:/b', expected: ['/a', '/b'] },
    { name: 'espacios, vacíos y duplicados POSIX', paths: path.posix, base: '/repo', value: ' : /a : : /b : /a : ', expected: ['/a', '/b'] },
    { name: 'rutas relativas POSIX', paths: path.posix, base: '/repo', value: '.:../notas', expected: ['/repo', '/notas'] },
    { name: 'punto y coma dentro de un nombre POSIX', paths: path.posix, base: '/repo', value: '/a;b:/c', expected: ['/a;b', '/c'] },
  ])('$name', ({ paths, base, value, expected }) => {
    // Las rutas simuladas no existen en el sistema que ejecuta la prueba.
    vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
      throw Object.assign(new Error('Carpeta inexistente'), { code: 'ENOENT' });
    });
    expect(parseAllowedRoots(value, base, paths)).toEqual(expected);
  });

  it('mantiene el home por defecto y las rutas canónicas con el módulo nativo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-tfg-roots-'));
    try {
      vi.spyOn(os, 'homedir').mockReturnValue(dir);
      const canonical = fs.realpathSync(dir);
      for (const value of [undefined, '', ` ${path.delimiter} `]) {
        expect(parseAllowedRoots(value, REPO_ROOT)).toEqual([canonical]);
      }
      expect(parseAllowedRoots(`~${path.delimiter}${dir}`, REPO_ROOT)).toEqual([canonical]);
      expect(parseAllowedRoots('./nueva', dir)).toEqual([path.join(canonical, 'nueva')]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});


describe('expansión del home', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(['~', '~/notas', '~\\notas'])('acepta %s en ambos sistemas', (p) => {
    vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\yo');
    expect(expandPath(p, 'C:\\repo', path.win32)).toBe(p === '~' ? 'C:\\Users\\yo' : 'C:\\Users\\yo\\notas');
    vi.spyOn(os, 'homedir').mockReturnValue('/home/yo');
    expect(expandPath(p, '/repo', path.posix)).toBe(p === '~' ? '/home/yo' : '/home/yo/notas');
  });
});
