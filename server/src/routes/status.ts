import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { walkFiles } from '../fsutil.ts';
import { ROOTS } from '../paths.ts';

export async function workerStatus(url: string): Promise<'up' | 'down'> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return 'down';
    const body: any = await res.json().catch(() => null);
    return body?.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export default async function statusRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { cfg } = ctx;
  app.get('/api/status', async () => {
    const [worker, ...conflicts] = await Promise.all([
      workerStatus(cfg.workerUrl),
      ...ROOTS.map(async (root) =>
        (await walkFiles(cfg, root, { includeSyncConflicts: true }).catch(() => [])).map((f) => `${root}/${f.rel}`),
      ),
    ]);
    return {
      notesDir: cfg.notesDir,
      memoriaDir: cfg.memoriaDir,
      memoriaMain: cfg.memoriaMain,
      resourcesSubdir: cfg.resourcesSubdir,
      syncConflicts: (conflicts as string[][]).flat().sort(),
      worker,
    };
  });
}
