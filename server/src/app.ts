import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.ts';
import { isAuthorized } from './auth.ts';
import { Compiler } from './compile.ts';
import type { Ctx } from './context.ts';
import { HttpError } from './errors.ts';
import { EventBus } from './events.ts';
import { KeyedLock } from './fsutil.ts';
import { MAX_UPLOAD } from './capture.ts';
import compileRoutes from './routes/compile.ts';
import eventsRoutes from './routes/events.ts';
import filesRoutes from './routes/files.ts';
import notesRoutes from './routes/notes.ts';
import resourcesRoutes from './routes/resources.ts';
import searchRoutes from './routes/search.ts';
import statusRoutes from './routes/status.ts';

export interface BuildOptions {
  logger?: boolean;
  bus?: EventBus;
  /** Serve web/dist if present (default true). */
  serveWeb?: boolean;
}

export async function buildApp(cfg: Config, opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  fs.mkdirSync(cfg.buildDir, { recursive: true });
  const app = Fastify({
    logger: opts.logger ? { level: 'info' } : false,
    bodyLimit: 25 * 1024 * 1024,
  });
  const bus = opts.bus ?? new EventBus();
  const compiler = new Compiler(cfg, (r) => bus.emit('compile', r));
  const ctx: Ctx = { cfg, bus, compiler, locks: new KeyedLock() };
  await compiler.load();

  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD, files: 1, fields: 20, fieldSize: 5 * 1024 * 1024 },
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!cfg.authToken || !req.url.startsWith('/api/')) return;
    if (!isAuthorized(req, cfg.authToken)) {
      reply.code(401).send({ error: 'No autorizado' });
      return reply;
    }
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message, ...(err.body ?? {}) });
      return;
    }
    const status = typeof err?.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    const message =
      status === 413 ? 'Petición demasiado grande (máx. 50 MB)' : status >= 500 ? 'Error interno del servidor' : err?.message || 'Petición no válida';
    reply.code(status).send({ error: message });
  });

  for (const plugin of [statusRoutes, filesRoutes, notesRoutes, resourcesRoutes, searchRoutes, compileRoutes, eventsRoutes]) {
    await app.register(plugin, { ctx });
  }

  const indexHtml = path.join(cfg.webDist, 'index.html');
  const hasWeb = (opts.serveWeb ?? true) && fs.existsSync(indexHtml);
  if (hasWeb) {
    await app.register(fastifyStatic, { root: cfg.webDist, wildcard: false, index: ['index.html'] });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url === '/api' || req.method !== 'GET' || !hasWeb) {
      reply.code(404).send({ error: 'No encontrado' });
      return;
    }
    reply.header('cache-control', 'no-cache');
    return reply.sendFile('index.html');
  });

  return { app, ctx };
}
