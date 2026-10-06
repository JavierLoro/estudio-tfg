import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { aplicarPlantilla, computePlan, deshacerPlantilla, publicPlan } from '../plantilla.ts';

// Actualizar plantilla (v0.6). Mismas garantías que el resto de escrituras de la memoria.
export default async function plantillaRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.get('/api/memoria/plantilla', async (req) => {
    const perfil = (req.query as Record<string, string | undefined>).perfil;
    return publicPlan(await computePlan(ctx.cfg, perfil));
  });

  app.post('/api/memoria/plantilla/actualizar', async (req) => aplicarPlantilla(ctx, req.body));

  app.post('/api/memoria/plantilla/deshacer', async (req) => deshacerPlantilla(ctx, req.body));
}
