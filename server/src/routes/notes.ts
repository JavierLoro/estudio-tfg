import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { walkFiles } from '../fsutil.ts';
import { extractLinks, makeSnippet, noteTitle, readText, resolveWikilink } from '../notes.ts';
import { normalizeRel } from '../paths.ts';

type Q = Record<string, string | undefined>;

export default async function notesRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { cfg } = ctx;

  app.get('/api/notes/resolve', async (req) => {
    const q = req.query as Q;
    if (!q.target || !q.target.trim()) throw badRequest('target es obligatorio');
    const from = q.from ? normalizeRel(q.from) : undefined;
    const files = (await walkFiles(cfg, 'notes')).map((f) => f.rel);
    const hit = resolveWikilink(q.target, files, from);
    if (!hit) throw notFound('Nota no encontrada');
    return { path: hit };
  });

  app.get('/api/notes/backlinks', async (req) => {
    const q = req.query as Q;
    const target = normalizeRel(q.path);
    const all = await walkFiles(cfg, 'notes');
    const files = all.map((f) => f.rel);
    const items: { path: string; title: string; snippet: string }[] = [];
    for (const f of all) {
      if (!f.rel.toLowerCase().endsWith('.md') || f.rel === target) continue;
      const content = await readText(f.abs);
      if (!content || (!content.includes('[[') && !content.includes(']('))) continue;
      const hit = extractLinks(content).find((l) => resolveWikilink(l.target, files, f.rel) === target);
      if (hit) items.push({ path: f.rel, title: noteTitle(f.rel, content), snippet: makeSnippet(hit.line) });
    }
    items.sort((a, b) => a.title.localeCompare(b.title, 'es'));
    return { items };
  });
}
