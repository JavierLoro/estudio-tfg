import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { RefsService } from '../refs.ts';

export default async function refsRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const refs = new RefsService(ctx.cfg, ctx.bus);
  app.get('/api/memoria/refs', async () => refs.get());
}
