import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { notFound } from '../errors.ts';

export default async function compileRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { compiler } = ctx;

  app.post('/api/compile', async () => compiler.compile());

  app.get('/api/compile/last', async () => {
    const last = await compiler.last();
    if (!last) throw notFound('Aún no hay compilaciones');
    return last;
  });

  app.get('/api/pdf/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const m = /^(.+)\.pdf$/.exec(file);
    const abs = m ? await compiler.buildFile(m[1], '.pdf') : null;
    if (!abs) throw notFound('PDF no encontrado');
    const st = await fs.stat(abs);
    reply.header('content-type', 'application/pdf');
    reply.header('content-length', st.size);
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    return reply.send(createReadStream(abs));
  });

  app.get('/api/compile/log/:buildId', async (req, reply) => {
    const { buildId } = req.params as { buildId: string };
    const abs = await compiler.buildFile(buildId, '.log');
    if (!abs) throw notFound('Log no encontrado');
    reply.header('content-type', 'text/plain; charset=utf-8');
    return reply.send(await fs.readFile(abs, 'utf8'));
  });
}
