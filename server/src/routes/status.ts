import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { createEngine } from '../engine/index.ts';
import { dockerEngine } from '../engine/docker.ts';
import { detectLocal } from '../engine/local.ts';
import { requireAdmin } from '../settings.ts';
import { libraryId } from '../captureOperations.ts';
import { walkFiles } from '../fsutil.ts';
import { ROOTS } from '../paths.ts';
import { instanceId, isConfigured } from '../settings.ts';

export default async function statusRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { cfg } = ctx;
  app.get('/api/engines', async (req) => {
    requireAdmin(req, cfg);
    const [docker, local] = await Promise.all([dockerEngine(cfg.workerUrl).health(), detectLocal({ ...cfg }, true)]);
    return { docker, local };
  });
  app.get('/api/status', async () => {
    const snap = { ...cfg };
    const engine = await createEngine(snap);
    const [health, docker, ...conflicts] = await Promise.all([
      engine.health(),
      engine.type === 'docker' ? Promise.resolve(null) : dockerEngine(snap.workerUrl).health(),
      ...ROOTS.map(async (root) =>
        (await walkFiles(snap, root, { includeSyncConflicts: true }).catch(() => [])).map((f) => `${root}/${f.rel}`),
      ),
    ]);
    let captureIdentity: { libraryId?: string; libraryError?: string };
    try { captureIdentity = { libraryId: libraryId(snap) }; }
    catch (e) { captureIdentity = { libraryError: e instanceof Error ? e.message : 'Identidad de biblioteca no válida' }; }
    const message = health.ok ? undefined : [
      ...(snap.compileEngine === 'auto' && docker && !docker.ok ? [docker.message ?? 'Docker no está disponible.'] : []),
      health.message ?? 'El motor seleccionado no está disponible.',
    ].join(' ');
    return {
      notesDir: snap.notesDir,
      memoriaDir: snap.memoriaDir,
      memoriaMain: snap.memoriaMain,
      resourcesSubdir: snap.resourcesSubdir,
      syncConflicts: (conflicts as string[][]).flat().sort(),
      worker: (docker ?? health).ok ? 'up' : 'down',
      motor: { seleccion: snap.compileEngine, tipo: engine.type, estado: health.ok ? 'up' : 'down', version: health.version, capacidades: health.capabilities, ...(message ? { mensaje: message } : {}) },
      ...(ctx.watcher?.status ?? { watcher: 'ok' }),
      configured: isConfigured(snap),
      instanceId: instanceId(snap),
      ...captureIdentity,
    };
  });
}
