import crypto from 'node:crypto';
import fss from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { realpathLoose, type Config } from './config.ts';
import { HttpError } from './errors.ts';
import { createExclusive, KeyedLock } from './fsutil.ts';
import { isInside, resolveSafe } from './paths.ts';

const FILE = '.biblioteca.json';
const locks = new KeyedLock();

export function libraryId(cfg: Config): string {
  let root = realpathLoose(path.join(cfg.notesDir, cfg.resourcesSubdir));
  const file = path.join(root, FILE);
  try {
    if (!isInside(realpathLoose(cfg.notesDir), root) || !fss.lstatSync(file).isFile()) throw new Error('Identidad fuera de la biblioteca');
    const data = JSON.parse(fss.readFileSync(file, 'utf8'));
    if (data.version !== 1 || typeof data.id !== 'string' || !/^[a-f0-9]{32}$/.test(data.id)) throw new Error('Formato no válido');
    return data.id;
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw new HttpError(422, 'La identidad de biblioteca no es válida; conserva una copia y revisa .biblioteca.json');
  }
  if (process.platform === 'win32') root = path.toNamespacedPath(root).toLowerCase();
  return crypto.createHash('sha256').update(root).digest('hex').slice(0, 32);
}

/** Persistir el ID anterior mantiene válidos recibos y pendientes de R2. */
export async function ensureLibrary(cfg: Config): Promise<string> {
  const root = await resolveSafe(cfg, 'notes', cfg.resourcesSubdir);
  return locks.run(root.abs, async () => {
    const id = libraryId(cfg);
    await fs.mkdir(root.abs, { recursive: true });
    const file = await resolveSafe(cfg, 'notes', `${cfg.resourcesSubdir}/${FILE}`);
    await createExclusive(file.abs, JSON.stringify({ version: 1, id }) + '\n');
    return libraryId(cfg);
  });
}
