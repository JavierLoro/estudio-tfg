import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { HttpError, badRequest } from '../errors.ts';
import { computeSourceRev } from '../compile.ts';
import { applyChanges } from '../datos.ts';
import { validarFuentes } from '../fuentes.ts';
import { generarPortadas } from '../portadas.ts';
import { compararEstilo, fuentesActuales, guardarTransaccion, aplicarTransaccion, proposalFolder } from '../styleProposals.ts';
import { readPrivate } from '../assistantChanges.ts';
import { rev } from '../fsutil.ts';
export default async function estiloRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const jobs = new Map<string, AbortController>();
  app.addHook('preClose', async () => { for (const c of jobs.values()) c.abort(); });
  app.get('/api/memoria/estilo/revision', async () => ({ baseRev: await computeSourceRev(ctx.cfg) }));
  app.post('/api/memoria/estilo/propuestas', async req => {
    if (jobs.size) throw new HttpError(409, 'Espera a que termine la comparación');
    const b = req.body as { baseRev?: unknown; valores?: Record<string, unknown>; portadas?: unknown };
    if (!b?.valores || typeof b.valores !== 'object' || Array.isArray(b.valores)) throw badRequest('Faltan los valores de estilo');
    const cfg = { ...ctx.cfg }, baseRev = await computeSourceRev(cfg);
    if (b.baseRev !== baseRev) throw new HttpError(409, 'La memoria ha cambiado; vuelve a cargar el estilo');
    await validarFuentes(cfg, b.valores);
    const actual = await fuentesActuales(cfg);
    if (!actual.get('estilo/memoria.cls')?.toString().includes('v3.6')) throw new HttpError(409, 'Actualiza la plantilla antes de comparar cambios de estilo');
    if (baseRev !== await computeSourceRev(cfg)) throw new HttpError(409, 'La memoria cambió durante la lectura');
    const cambios = new Map<string, string | Buffer>();
    cambios.set('estilo/institucion.tex', applyChanges(actual.get('estilo/institucion.tex')!.toString(), 'institucion', b.valores));
    if (b.portadas) cambios.set('estilo/portadas.tex', generarPortadas(b.portadas));
    const candidate = new Map([...actual, ...cambios]);
    const controller = new AbortController(); jobs.set(baseRev, controller);
    try {
      const preview = await compararEstilo(cfg, actual, candidate, cfg.memoriaMain, controller.signal);
      await guardarTransaccion(cfg, preview.id, baseRev, cambios);
      const transaction = await readPrivate(path.join(proposalFolder(cfg, preview.id), 'transaction.json'));
      return { ...preview, baseRev: rev(JSON.stringify(transaction)) };
    } finally { jobs.delete(baseRev); }
  });
  app.get('/api/memoria/estilo/propuestas/:id/:side', async (req, reply) => {
    const { id, side } = req.params as { id: string; side: string };
    if (!['actual.pdf', 'propuesta.pdf'].includes(side)) throw badRequest('PDF no válido');
    const dir = proposalFolder(ctx.cfg, id);
    await readPrivate(path.join(dir, 'transaction.json'));
    reply.type('application/pdf').header('cache-control', 'no-store');
    return fs.readFile(path.join(dir, side));
  });
  app.post('/api/memoria/estilo/propuestas/:id/apply', async req => aplicarTransaccion(ctx, (req.params as {id: string}).id, (req.body as any)?.baseRev));
  app.post('/api/memoria/estilo/propuestas/:id/undo', async req => aplicarTransaccion(ctx, (req.params as {id: string}).id, (req.body as any)?.baseRev, true));
}
