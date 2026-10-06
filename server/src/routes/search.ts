import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import { ROOTS, type RootName } from '../paths.ts';
import { OutlineService } from '../outline.ts';
import { search, type OutlineLookup } from '../search.ts';

export default async function searchRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.get('/api/search', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const r = q.root ?? 'all';
    let roots: RootName[];
    if (r === 'all') roots = ROOTS;
    else if (r === 'notes' || r === 'memoria') roots = [r];
    else throw badRequest('root debe ser notes, memoria o all');
    let lookup: OutlineLookup | undefined;
    if (roots.includes('memoria') && (q.q ?? '').trim()) {
      try {
        const b = await ctx.outline.built();
        lookup = (p, line) => OutlineService.lookup(b, p, line);
      } catch {
        lookup = () => null;
      }
    }
    return { items: await search(ctx.cfg, q.q ?? '', roots, lookup) };
  });
}
