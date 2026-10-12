import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { migrate, migrationPreview, resumeMigration } from '../libraryMigration.ts';
import { importApply, importOperations, importPreview } from '../libraryImport.ts';
import { integrationApply, integrationOperation, integrationPreview, libraryUses } from '../libraryIntegration.ts';

export default async function libraryRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const snapshot = () => ({ ...ctx, cfg: { ...ctx.cfg } });
  app.get('/api/library/migration', async () => migrationPreview(snapshot()));
  app.post('/api/library/migration', async (req) => {
    const body = (req.body ?? {}) as any;
    return migrate(snapshot(), body.operationId, body.items, body.libraryId);
  });
  app.post('/api/library/migration/:id/retry', async (req) => resumeMigration(snapshot(), (req.params as any).id));
  app.post('/api/library/migration/:id/undo', async (req) => resumeMigration(snapshot(), (req.params as any).id, true));
  app.post('/api/library/import/preview', async(req)=>importPreview(snapshot(),req.body));
  app.post('/api/library/import', async(req)=>importApply(snapshot(),req.body));
  app.get('/api/library/import/operations', async()=>importOperations(snapshot()));
  app.post('/api/library/integration/preview', async(req)=>integrationPreview(snapshot(),req.body));
  app.post('/api/library/integration/apply', async(req)=>integrationApply(snapshot(),req.body));
  app.get('/api/library/integration/:id',async(req)=>integrationOperation(snapshot(),(req.params as any).id));
  app.get('/api/library/uses',async(req)=>{const q=req.query as any;return libraryUses(snapshot(),q.id,q.path);});
}
