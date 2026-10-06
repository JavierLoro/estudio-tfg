import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { createSection } from '../sections.ts';

export default async function memoriaRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.get('/api/memoria/outline', async () => ctx.outline.get());

  app.post('/api/memoria/sections', async (req) => createSection(ctx, req.body));
}
