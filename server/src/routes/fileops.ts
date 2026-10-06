import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import { createDir, moveEntryOp, restoreEntry, trashEntry } from '../fileops.ts';
import { parseRoot } from '../paths.ts';

type Q = Record<string, string | undefined>;

/** Carpetas, mover/renombrar, papelera y restaurar (contrato v0.7). */
export default async function fileopsRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.post('/api/dir', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const root = parseRoot(b.root);
    const p = await createDir(ctx, root, b.path);
    reply.code(201);
    return { path: p };
  });

  app.post('/api/move', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const root = parseRoot(b.root);
    if (b.updateLinks !== undefined && typeof b.updateLinks !== 'boolean') throw badRequest('updateLinks debe ser true o false');
    return moveEntryOp(ctx, root, b.from, b.to, b.updateLinks !== false);
  });

  app.delete('/api/file', async (req) => {
    const q = req.query as Q;
    const root = parseRoot(q.root);
    return trashEntry(ctx, root, q.path);
  });

  app.post('/api/trash/restore', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const root = parseRoot(b.root);
    return { path: await restoreEntry(ctx, root, b.path, b.trashPath) };
  });
}
