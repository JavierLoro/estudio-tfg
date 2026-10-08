export function fold(s: string) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
