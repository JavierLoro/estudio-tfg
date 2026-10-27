import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { receiveUpload, sanitizeFilename } from '../capture.ts';
import { HttpError, badRequest } from '../errors.ts';
import { linkExclusive, rev } from '../fsutil.ts';
import { isIgnoredRel } from '../ignore.ts';
import { normalizeRel, parseRoot, resolveSafe, validateNewPath } from '../paths.ts';
import { instanceId } from '../settings.ts';
import { treeKey } from '../fileops.ts';
import { checkDiagramDestination } from '../diagramFiles.ts';
import { parseExcalidraw } from '../../../shared/excalidraw.ts';

export default async function importRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.post('/api/files/import', async (req) => {
    const cfg = { ...ctx.cfg }, q = req.query as Record<string, unknown>;
    const root = parseRoot(q.root), directory = normalizeRel(q.directory, true);
    const checkDestination = () => {
      if (typeof q.instanceId !== 'string' || q.instanceId !== instanceId(cfg) || q.instanceId !== instanceId(ctx.cfg))
        throw new HttpError(409, 'El destino ha cambiado; vuelve al proyecto original antes de importar');
    };
    checkDestination();
    if (!req.isMultipart()) throw badRequest('Selecciona un archivo');
    let tmp: string | undefined, filename = '';
    try {
      for await (const part of req.parts({ limits: { files: 1, fields: 0 } })) {
        if (part.type !== 'file' || part.fieldname !== 'file') throw badRequest('Selecciona un único archivo');
        filename = sanitizeFilename(part.filename.replace(/%/g, ' '));
        const rel = await validateNewPath(cfg, root, path.posix.join(directory, filename));
        if (isIgnoredRel(rel, root, false)) throw badRequest('El archivo o la carpeta están excluidos de la app; elige otro destino');
        const target = await resolveSafe(cfg, root, rel);
        await fs.mkdir(path.dirname(target.abs), { recursive: true });
        const safe = await resolveSafe(cfg, root, rel);
        tmp = await receiveUpload(cfg, part.file, path.dirname(safe.abs));
        if (part.file.truncated) throw new HttpError(413, 'Archivo demasiado grande (máx. 50 MB)');
      }
      if (!tmp) throw badRequest('Selecciona un archivo');
      const bytes = await fs.readFile(tmp), revision = rev(bytes);
      if (/\.excalidraw$/i.test(filename)) { try { parseExcalidraw(bytes.toString('utf8')); } catch (e) { throw badRequest((e as Error).message); } }
      const extension = path.posix.extname(filename), stem = filename.slice(0, filename.length - extension.length);
      return await ctx.locks.run(treeKey(root), () => ctx.locks.run(`${root}:import:${directory}/${filename}`, async () => {
        for (let n = 1; n <= 1000; n++) {
          checkDestination();
          const name = n === 1 ? filename : `${stem} ${n}${extension}`;
          const target = await resolveSafe(cfg, root, path.posix.join(directory, name));
          try { await checkDiagramDestination(cfg, root, target.rel); }
          catch (e) { if (e instanceof HttpError && e.statusCode === 409) continue; throw e; }
          if (target.exists) {
            const stat = await fs.stat(target.abs);
            if (stat.isFile() && stat.size === bytes.length && (await fs.readFile(target.abs)).equals(bytes))
              return { root, path: target.rel, rev: revision, reused: true };
          } else if (await linkExclusive(tmp!, target.abs)) {
            return { root, path: target.rel, rev: revision, reused: false };
          } else n--; // Otra creación ganó el nombre: comprobar sus bytes antes de elegir otro.
        }
        throw new HttpError(409, 'Hay demasiados archivos con este nombre; elige otra carpeta');
      }));
    } finally {
      if (tmp) await fs.rm(tmp, { force: true });
    }
  });
}
