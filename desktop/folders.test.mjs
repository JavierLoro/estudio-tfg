import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopAllowedRoots } from './folders.mjs';

test('escritorio permite volúmenes POSIX y unidades Windows disponibles', () => {
  assert.equal(desktopAllowedRoots(undefined, 'darwin'), '/');
  assert.equal(desktopAllowedRoots('', 'linux'), '/');
  const drives = [];
  assert.equal(desktopAllowedRoots(undefined, 'win32', drive => {
    drives.push(drive); return ['C:\\', 'D:\\', 'Z:\\'].includes(drive);
  }), 'C:\\;D:\\;Z:\\');
  assert.equal(drives.length, 26);
});

test('escritorio respeta ALLOWED_ROOTS explícito, incluidas carpetas de red', () => {
  for (const value of ['/una/raiz:/otra', 'C:\\Documentos;\\\\servidor\\carpeta']) {
    assert.equal(desktopAllowedRoots(value, 'win32', () => assert.fail('No debe explorar unidades')), value);
  }
});
