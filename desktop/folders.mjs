import { existsSync } from 'node:fs';

/** El escritorio puede elegir carpetas del equipo; un límite explícito prevalece. */
export function desktopAllowedRoots(value, platform = process.platform, exists = existsSync) {
  if (value?.trim()) return value;
  if (platform !== 'win32') return '/';
  return Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`).filter(exists).join(';');
}
