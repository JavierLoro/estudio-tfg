import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { migrate, migrationPreview, resumeMigration } from '../libraryMigration.ts';

export default async function libraryRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const snapshot = () => ({ ...ctx, cfg: { ...ctx.cfg } });
  app.get('/api/library/migration', async () => migrationPreview(snapshot()));
  app.post('/api/library/migration', async (req) => {
    const body = (req.body ?? {}) as any;
    return migrate(snapshot(), body.operationId, body.items, body.libraryId);
  });
  app.post('/api/library/migration/:id/retry', async (req) => resumeMigration(snapshot(), (req.params as any).id));
  app.post('/api/library/migration/:id/undo', async (req) => resumeMigration(snapshot(), (req.params as any).id, true));
}
