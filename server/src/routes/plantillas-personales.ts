import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { guardarPersonal, leerPersonal, personalRoot, crearZip } from '../plantillas-personales.ts';
import { UUID, readPrivate } from '../assistantChanges.ts';
import { requireAdmin } from '../settings.ts';
import { HttpError } from '../errors.ts';
import { nuevaMemoria } from '../nueva-memoria.ts';
import { parseDatos, applyChanges } from '../datos.ts';
export default async function personalesRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const admin = async (req: Parameters<typeof requireAdmin>[0]) => requireAdmin(req, ctx.cfg);
  app.get('/api/templates/personal', {preHandler: admin}, async () => {
    const names = await fs.readdir(personalRoot(ctx)).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const items = [];
    for (const id of names.filter(n => UUID.test(n))) { const meta = await readPrivate(path.join(personalRoot(ctx), id, 'template.json')); items.push({id, nombre: meta.nombre, rev: meta.rev}); }
    return {items};
  });
  app.post('/api/templates/personal', {preHandler: admin}, async req => {
    const b = req.body as any; return guardarPersonal(ctx, b?.nombre, b?.baseRev);
  });
  app.get('/api/templates/personal/:id', {preHandler: admin}, async req => {
    const {meta, archivos} = await leerPersonal(ctx, (req.params as {id: string}).id);
    return {id: meta.id, nombre: meta.nombre, rev: meta.rev, config: meta.config, fuentes: archivos.has('estilo/fuentes.json') ? JSON.parse(archivos.get('estilo/fuentes.json')!.toString()).familias.map((f: any) => [f.id, f.nombre]) : []};
  });
  app.get('/api/templates/personal/:id/export', {preHandler: admin}, async (req, reply) => {
    const {archivos} = await leerPersonal(ctx, (req.params as {id: string}).id);
    reply.type('application/zip').header('content-disposition', 'attachment; filename="plantilla.zip"').header('cache-control', 'no-store'); return crearZip(archivos);
  });
  app.post('/api/templates/personal/:id/create', {preHandler: admin}, async req => {
    const {meta, archivos} = await leerPersonal(ctx, (req.params as {id: string}).id), b = req.body as any;
    if (b?.baseRev !== meta.rev) throw new HttpError(409, 'La plantilla personal ha cambiado');
    const config = b.configuracion ?? meta.config, files = nuevaMemoria(config, ctx.cfg.templatesDir);
    for (const [rel,data] of archivos) if (/^estilo\/(?:fuentes(?:\.json|\.tex|\/)|imagenes\/|LICENCIAS-FUENTES\.txt)/.test(rel)) files.set(rel, data);
    const logo = parseDatos(archivos.get('estilo/institucion.tex')!.toString(), 'institucion').logo;
    if (logo) { files.set('estilo/' + logo, archivos.get('estilo/' + logo)!); files.set('estilo/institucion.tex', applyChanges(files.get('estilo/institucion.tex')!.toString(), 'institucion', {logo})); }
    const registry = archivos.has('estilo/fuentes.json') ? JSON.parse(archivos.get('estilo/fuentes.json')!.toString()) : {familias: []};
    for (const [key,value] of Object.entries(config.institucion)) if (key.startsWith('fuente') && typeof value === 'string' && value.startsWith('propia-') && !registry.familias.some((f: any) => f.id === value)) throw new HttpError(400, 'La fuente seleccionada no está incluida en la plantilla');
    if (JSON.stringify(config.capitulos) === JSON.stringify(meta.config.capitulos)) for (const [rel,data] of archivos) if (rel.startsWith('1-capitulos/')) files.set(rel, data);
    return ctx.settings.initMemoria({dir: b.dir, configuracion: config}, undefined, files);
  });
}
