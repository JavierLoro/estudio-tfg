import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { estado, exportar, listEstados } from '../diagramas.ts';

export default async function diagramasRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  // Con `path`: el estado de ese diagrama. Sin `path`: todos, con dónde se usan (árbol y vista Documento).
  app.get('/api/diagramas/estado', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    if (q.path === undefined) return { items: await listEstados(ctx) };
    return estado(ctx, q.path);
  });

  app.post('/api/diagramas/exportar', async (req, reply) => {
    const r = await exportar(ctx, req.body);
    reply.code(r.status);
    return r.body;
  });
}
