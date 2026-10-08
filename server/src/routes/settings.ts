import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { HttpError, notFound } from '../errors.ts';
import { isInside } from '../paths.ts';
import { expandUserPath, fieldError, isDirSync, isFileSync, requireAdmin } from '../settings.ts';
import { listPerfiles } from '../../../scripts/memoria-template.mjs';

export interface DirEntry {
  name: string;
  path: string;
  isObsidianVault: boolean;
  hasMainTex: boolean;
  isGitRepo: boolean;
}

function describe(abs: string, name = path.basename(abs) || abs): DirEntry {
  return {
    name,
    path: abs,
    isObsidianVault: isDirSync(path.join(abs, '.obsidian')),
    hasMainTex: ['tfg.tex', 'main.tex'].some((f) => isFileSync(path.join(abs, f))),
    isGitRepo: isDirSync(path.join(abs, '.git')) || isFileSync(path.join(abs, '.git')),
  };
}

const WINDOWS_SYSTEM_DIR = /^(AppData|\$Recycle\.Bin|System Volume Information|Config\.Msi|Recovery|PerfLogs|Windows|ProgramData|Program Files.*|MSOCache)$/i;

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

export default async function settingsRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { cfg, settings } = ctx;
  const admin = async (req: any) => requireAdmin(req, cfg);

  app.get('/api/settings', async () => settings.view());
  app.put('/api/settings', { preHandler: admin }, async (req) => settings.update(req.body));
  app.post('/api/settings/reset', { preHandler: admin }, async (req) => settings.reset(req.body));
  app.post('/api/settings/init-memoria', { preHandler: admin }, async (req) => settings.initMemoria(req.body));
  app.get('/api/templates/perfiles', async () => ({ perfiles: listPerfiles() }));

  app.get('/api/fs/dirs', { preHandler: admin }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const roots = cfg.allowedRoots;
    if (q.path === undefined || q.path === '') {
      return { path: null, parent: null, dirs: roots.filter((r) => isDirSync(r)).map((r) => describe(r, r)) };
    }
    if (q.path.includes('\0')) throw fieldError('path', 'Ruta no válida');
    const expanded = expandUserPath(q.path);
    if (!path.isAbsolute(expanded)) throw fieldError('path', 'La ruta debe ser absoluta');
    let real: string;
    try {
      real = await fs.realpath(path.resolve(expanded));
    } catch {
      throw notFound(`No existe: ${expanded}`);
    }
    const root = roots.find((r) => isInside(r, real));
    if (!root) throw fieldError('path', `Fuera de las carpetas permitidas (${roots.join(', ')})`);
    if (!isDirSync(real)) throw fieldError('path', 'No es una carpeta');
    let ents;
    try {
      ents = await fs.readdir(real, { withFileTypes: true });
    } catch (e: any) {
      throw new HttpError(e?.code === 'EACCES' || e?.code === 'EPERM' ? 403 : 500, `No se puede leer la carpeta: ${real}`);
    }
    const dirs: DirEntry[] = [];
    for (const ent of ents) {
      if (ent.name.startsWith('.') || (os.platform() === 'win32' && WINDOWS_SYSTEM_DIR.test(ent.name))) continue;
      const abs = path.join(real, ent.name);
      if (ent.isSymbolicLink()) {
        const target = await fs.realpath(abs).catch(() => null);
        if (!target || !roots.some((r) => isInside(r, target)) || !isDirSync(target)) continue;
      } else if (!ent.isDirectory()) continue;
      if (os.platform() === 'win32') {
        // Junctions y carpetas protegidas pueden existir pero no ser navegables.
        try { await fs.readdir(abs); } catch (e: any) {
          if (['EPERM', 'EACCES', 'ENOENT'].includes(e?.code)) continue;
          throw e;
        }
      }
      dirs.push(describe(abs, ent.name));
    }
    dirs.sort((a, b) => collator.compare(a.name, b.name) || a.name.localeCompare(b.name));
    const parent = roots.some((r) => isInside(r, real) && isInside(real, r)) ? null : path.dirname(real);
    return { path: real, parent, dirs };
  });
}
