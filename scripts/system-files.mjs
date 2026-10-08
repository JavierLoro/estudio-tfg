/** Archivos generados por Windows y temporales: comparación sin distinguir mayúsculas. */
export function isSystemFile(name) {
  return /^(desktop\.ini|thumbs\.db)$/i.test(name) || /\.tmp$/i.test(name);
}
