export const RELEASES_URL = 'https://github.com/JavierLoro/estudio-tfg/releases';
export const UPDATE_TAG = 'actualizaciones';

export function distributionTag(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag ?? '')) throw new Error('Tag de distribución no válido');
  return `distribucion-${tag}`;
}

export const assetUrl = (tag, name) => `${RELEASES_URL}/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
