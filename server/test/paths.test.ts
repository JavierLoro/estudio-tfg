import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, realpathLoose } from '../src/config.ts';
import { isInside } from '../src/paths.ts';
import { instanceId } from '../src/settings.ts';

afterEach(() => vi.restoreAllMocks());

describe('pertenencia de rutas por sistema', () => {
  it.each([
    ['C:\\a', 'c:\\A\\b', true],
    ['C:\\a', 'c:/A', true],
    ['C:\\a', 'D:\\a', false],
    ['C:\\a', 'C:\\ab', false],
    ['C:\\a', 'C:\\a\\..\\fuera', false],
    ['C:\\a', 'C:\\a\\..datos', true],
    ['\\\\srv\\share\\a', '\\\\SRV\\SHARE\\A\\b', true],
    ['\\\\srv\\share', '\\\\srv\\otro\\a', false],
  ] as const)('Windows: %s contiene %s = %s', (parent, child, expected) => {
    expect(isInside(parent, child, path.win32)).toBe(expected);
  });
  it('igualdad de raíces con comparación en ambos sentidos', () => {
    const same = (a: string, b: string) => isInside(a, b, path.win32) && isInside(b, a, path.win32);
    expect(same('C:\\a', 'c:/A')).toBe(true);
    expect(same('C:\\a', 'c:\\A\\b')).toBe(false);
  });
  it('POSIX conserva distinción de mayúsculas y límites de carpeta', () => {
    expect(isInside('/a', '/a/b', path.posix)).toBe(true);
    expect(isInside('/a', '/A/b', path.posix)).toBe(false);
    expect(isInside('/a', '/ab', path.posix)).toBe(false);
    expect(isInside('/a', '/a/../b', path.posix)).toBe(false);
    expect(isInside('/a', '/a/..datos', path.posix)).toBe(true);
  });
});

describe('rutas canónicas e instanceId', () => {
  it('usa realpath nativo y añade el sufijo inexistente en Windows', () => {
    const native = vi.spyOn(fs.realpathSync, 'native').mockImplementation((p) => {
      if (String(p).toLowerCase() === 'x:\\notas') return 'C:\\Users\\yo\\Notas';
      throw Object.assign(new Error('No existe'), { code: 'ENOENT' });
    });
    expect(realpathLoose('X:\\notas\\nueva\\otra', path.win32)).toBe('C:\\Users\\yo\\Notas\\nueva\\otra');
    expect(native).toHaveBeenCalledWith('X:\\notas');
    expect(realpathLoose('Z:\\no-existe', path.win32)).toBe('Z:\\no-existe');
  });
  it('aliases de unidad y variantes de mayúsculas comparten instancia', () => {
    const cfg = loadConfig();
    vi.spyOn(fs.realpathSync, 'native').mockImplementation((p) => {
      const s = String(p).toLowerCase().replace(/\//g, '\\');
      if (['c:\\notas', 'x:\\notas'].includes(s)) return 'C:\\Notas';
      if (['c:\\memoria', 'y:\\memoria'].includes(s)) return 'C:\\Memoria';
      throw new Error('Ruta ficticia no prevista');
    });
    const id = (notesDir: string, memoriaDir: string) => instanceId({ ...cfg, notesDir, memoriaDir }, path.win32);
    expect(id('c:/notas', 'c:\\MEMORIA')).toBe(id('X:\\notas', 'Y:\\memoria'));
    expect(id('C:\\Notas', 'C:\\Memoria')).toMatch(/^[0-9a-f]{12}$/);
  });
  it('conserva el hash previo para rutas nativas ya canónicas', () => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-tfg-id-')));
    try {
      const cfg = { ...loadConfig(), notesDir: path.join(dir, 'notas'), memoriaDir: path.join(dir, 'memoria') };
      fs.mkdirSync(cfg.notesDir);
      fs.mkdirSync(cfg.memoriaDir);
      const previous = crypto.createHash('sha256').update(`${cfg.notesDir}|${cfg.memoriaDir}`).digest('hex').slice(0, 12);
      expect(instanceId(cfg)).toBe(previous);
      expect(instanceId({ ...cfg, notesDir: path.join(cfg.notesDir, '..', 'notas') })).toBe(previous);
      expect(instanceId({ ...cfg, notesDir: path.join(dir, 'otra') })).not.toBe(previous);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
