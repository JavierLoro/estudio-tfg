import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { resolveSafe } from './paths.ts';

/** Mismo orden en lectura y reescritura de enlaces; nunca salen del vault. */
export function attachmentCandidates(note: string, value: string, resourcesSubdir = 'Recursos') {
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return [];
  return [
    { path: path.posix.join(path.posix.dirname(note), value), form: 'relative' },
    { path: path.posix.normalize(value), form: 'vault' },
    { path: path.posix.join(resourcesSubdir, value), form: 'legacy' },
  ].filter((c, i, all) => c.path !== '..' && !c.path.startsWith('../') && !all.slice(0, i).some((p) => p.path === c.path));
}

export async function resolveAttachment(cfg: Config, note: string, value?: string): Promise<{ attachmentPath: string | null; attachmentWarning?: string }> {
  if (!value) return { attachmentPath: null };
  const candidates = attachmentCandidates(note, value, cfg.resourcesSubdir);
  if (!candidates.length) return { attachmentPath: null, attachmentWarning: 'Ruta de adjunto no permitida' };
  const found: { path: string; form: string }[] = [];
  for (const candidate of candidates) {
    try {
      const r = await resolveSafe(cfg, 'notes', candidate.path);
      if (r.exists && (await fs.stat(r.abs)).isFile()) found.push(candidate);
    } catch {
      // No cambiar de archivo silenciosamente cuando el candidato prioritario es inaccesible.
      if (!found.length) return { attachmentPath: null, attachmentWarning: 'No se puede acceder al adjunto de forma segura' };
    }
  }
  if (!found.length) return { attachmentPath: null, attachmentWarning: `Adjunto no encontrado: ${value}` };
  return { attachmentPath: found[0].path,
    ...(found.length > 1 ? { attachmentWarning: `Hay varios adjuntos posibles; se usa ${found[0].path}. Revisa el campo attachment si querías otro.` }
      : found[0].form === 'legacy' ? { attachmentWarning: 'Adjunto localizado en la carpeta de recursos original; revisa el enlace después de mover la ficha fuera de la app.' } : {}),
  };
}
