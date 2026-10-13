export const APP_ORIGIN = 'http://estudio-tfg.localhost';

export function isAppUrl(value) {
  try { const url = new URL(value); return url.origin === APP_ORIGIN && !url.username && !url.password; }
  catch { return false; }
}

export function isExternalUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !isAppUrl(value); }
  catch { return false; }
}
