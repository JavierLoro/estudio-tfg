import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { HttpError } from '../errors.ts';
import { normalizeSetting, requireAdmin } from '../settings.ts';
import { validSegment } from '../paths.ts';
import { extraerPlantilla, inspeccionarProyecto, MAX_ZIP } from '../plantilla-propia.ts';

const TTL = 15 * 60_000;
export default async function plantillaPropiaRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const uploads = new Map<string, { temp: string; root: string; expires: number; busy: boolean }>();
  let preparing = 0;
  const admin = async (req: Parameters<typeof requireAdmin>[0]) => requireAdmin(req, ctx.cfg);
  const remove = async (id: string) => {
    const upload = uploads.get(id);
    if (!upload) return;
    uploads.delete(id);
    await fs.rm(upload.temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  const purge = async () => {
    for (const [id, upload] of uploads) {
      if (!upload.busy && upload.expires <= Date.now()) await remove(id);
    }
  };
  const timer = setInterval(() => { void purge().catch((e) => app.log.error(e)); }, 60_000);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await Promise.all([...uploads.keys()].map(remove));
  });

  app.post('/api/templates/inspect', { preHandler: admin }, async (req) => {
    const dir = normalizeSetting(ctx.cfg, 'memoriaDir', (req.body as { dir?: unknown } | null)?.dir, true);
    return inspeccionarProyecto(dir);
  });
  app.post('/api/templates/upload', { preHandler: admin }, async (req) => {
    await purge();
    if (preparing + uploads.size >= 3) throw new HttpError(429, 'Termina o cancela una importación antes de subir otro ZIP');
    preparing++;
    let temp: string | undefined;
    try {
      const file = await req.file({ limits: { fileSize: MAX_ZIP, files: 1, fields: 0 } });
      if (!file || !/\.zip$/i.test(file.filename)) throw new HttpError(400, 'Selecciona un archivo ZIP');
      const bytes = await file.toBuffer();
      if (file.file.truncated) throw new HttpError(413, 'El ZIP supera los 50 MB');
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-plantilla-'));
      const root = await extraerPlantilla(bytes, temp);
      const preview = await inspeccionarProyecto(root);
      const id = randomUUID();
      uploads.set(id, { temp, root, expires: Date.now() + TTL, busy: false });
      temp = undefined;
      return { ...preview, id };
    } finally {
      preparing--;
      if (temp) await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  app.delete('/api/templates/uploads/:id', { preHandler: admin }, async (req) => {
    const id = (req.params as { id: string }).id;
    if (uploads.get(id)?.busy) throw new HttpError(409, 'La importación está en curso');
    await remove(id);
    return { ok: true };
  });
  app.post('/api/templates/use', { preHandler: admin }, async (req) => {
    const body = req.body as { dir?: unknown; main?: unknown; id?: unknown } | null;
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Selecciona una plantilla');
    const main = normalizeSetting(ctx.cfg, 'memoriaMain', body.main, true);
    const upload = typeof body.id === 'string' ? uploads.get(body.id) : undefined;
    if (body.id !== undefined && (!upload || upload.expires <= Date.now())) throw new HttpError(410, 'El ZIP ha caducado; vuelve a seleccionarlo');
    if (upload?.busy) throw new HttpError(409, 'La importación está en curso');
    const dir = normalizeSetting(ctx.cfg, 'memoriaDir', body.dir, !upload);
    if (upload) upload.busy = true;
    let temporary: string | undefined;
    try {
      const preview = await inspeccionarProyecto(upload?.root ?? dir);
      if (!preview.archivos.some((file) => file.path === main)) throw new HttpError(400, 'El archivo principal no pertenece a esta plantilla');
      if (upload) {
        if (!validSegment(path.basename(dir))) throw new HttpError(400, 'Nombre de carpeta no válido');
        normalizeSetting(ctx.cfg, 'memoriaDir', path.dirname(dir), true);
        if (await fs.lstat(dir).then(() => true, (e) => { if (e.code === 'ENOENT') return false; throw e; })) {
          throw new HttpError(409, 'La carpeta de destino ya existe; elige una carpeta nueva');
        }
        temporary = await fs.mkdtemp(path.join(path.dirname(dir), '.et-plantilla-'));
        const prepared = path.join(temporary, 'proyecto');
        await fs.cp(upload.root, prepared, { recursive: true, force: false, errorOnExist: true });
        await fs.rename(prepared, dir);
      }
      let result;
      try { result = await ctx.settings.update({ memoriaDir: dir, memoriaMain: main }); }
      catch (e) {
        if (upload) throw new HttpError(500, 'La plantilla se ha copiado, pero no se pudo abrir. Puedes seleccionar su carpeta desde Ajustes');
        throw e;
      }
      if (typeof body.id === 'string') await remove(body.id).catch((e) => app.log.error(e));
      return result;
    } finally {
      if (upload) upload.busy = false;
      if (temporary) await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}
