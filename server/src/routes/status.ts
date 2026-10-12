import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { createEngine } from '../engine/index.ts';
import { libraryId } from '../captureOperations.ts';
import { walkFiles } from '../fsutil.ts';
import { ROOTS } from '../paths.ts';
import { instanceId, isConfigured } from '../settings.ts';

export default async function statusRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { cfg } = ctx;
  app.get('/api/status', async () => {
    const engine = createEngine(cfg);
    const [health, ...conflicts] = await Promise.all([
      engine.health(),
      ...ROOTS.map(async (root) =>
        (await walkFiles(cfg, root, { includeSyncConflicts: true }).catch(() => [])).map((f) => `${root}/${f.rel}`),
      ),
    ]);
    let captureIdentity: { libraryId?: string; libraryError?: string };
    try { captureIdentity = { libraryId: libraryId(cfg) }; }
    catch (e) { captureIdentity = { libraryError: e instanceof Error ? e.message : 'Identidad de biblioteca no válida' }; }
    return {
      notesDir: cfg.notesDir,
      memoriaDir: cfg.memoriaDir,
      memoriaMain: cfg.memoriaMain,
      resourcesSubdir: cfg.resourcesSubdir,
      syncConflicts: (conflicts as string[][]).flat().sort(),
      worker: health.ok ? 'up' : 'down',
      motor: { tipo: engine.type, estado: health.ok ? 'up' : 'down', version: health.version, capacidades: health.capabilities },
      ...(ctx.watcher?.status ?? { watcher: 'ok' }),
      configured: isConfigured(cfg),
      instanceId: instanceId(cfg),
      ...captureIdentity,
    };
  });
}
