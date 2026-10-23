import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { createSection, editSection } from '../sections.ts';
import { guardarPortadas, leerPortadas } from '../portadas.ts';

export default async function memoriaRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.get('/api/memoria/outline', async () => ctx.outline.get());

  app.post('/api/memoria/sections', async (req) => createSection(ctx, req.body));
  app.post('/api/memoria/sections/edit', async (req) => editSection(ctx, req.body));
  app.get('/api/memoria/portadas', async () => leerPortadas(ctx));
  app.put('/api/memoria/portadas', async (req) => guardarPortadas(ctx, req.body));
}
