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
import { EventBus, WatchManager } from './events.ts';
import { KeyedLock } from './fsutil.ts';
import { MAX_UPLOAD } from './capture.ts';
import { ROOTS, rootDir, type RootName } from './paths.ts';
import { OutlineService } from './outline.ts';
import { NOT_CONFIGURED, Settings, isDirSync } from './settings.ts';
import datosRoutes from './routes/datos.ts';
import compileRoutes from './routes/compile.ts';
import eventsRoutes from './routes/events.ts';
import filesRoutes from './routes/files.ts';
import fileopsRoutes from './routes/fileops.ts';
import memoriaRoutes from './routes/memoria.ts';
import notesRoutes from './routes/notes.ts';
import plantillaRoutes from './routes/plantilla.ts';
import resourcesRoutes from './routes/resources.ts';
import searchRoutes from './routes/search.ts';
import settingsRoutes from './routes/settings.ts';
import statusRoutes from './routes/status.ts';
import synctexRoutes from './routes/synctex.ts';

export interface BuildOptions {
  logger?: boolean;
  bus?: EventBus;
  /** Serve web/dist if present (default true). */
  serveWeb?: boolean;
  /** Start the chokidar watcher (restarted on settings changes). Default false. */
  watch?: boolean;
}

const pickRoot = (v: unknown): RootName[] | null => (v === 'notes' || v === 'memoria' ? [v] : null);

/** Roots a request needs to exist (null = route does not touch the roots). */
function rootsFor(method: string, url: string, query: any, body: any): RootName[] | null {
  const p = url.split('?')[0];
  if (p === '/api/tree' || p === '/api/file' || p === '/api/raw') return pickRoot(query?.root ?? body?.root) ?? [];
  if (p.startsWith('/api/notes/') || p === '/api/resources' || p === '/api/capture') return ['notes'];
  if (p === '/api/dir' || p === '/api/move' || p === '/api/trash/restore') return pickRoot(body?.root) ?? [];
  if (p === '/api/search') return pickRoot(query?.root) ?? ROOTS;
  if (p === '/api/compile' && method === 'POST') return ['memoria'];
  if (p.startsWith('/api/memoria/')) return ['memoria'];
  return null;
}

export async function buildApp(cfg: Config, opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  fs.mkdirSync(cfg.buildDir, { recursive: true });
  const app = Fastify({
    logger: opts.logger ? { level: 'info' } : false,
    bodyLimit: 25 * 1024 * 1024,
  });
  const bus = opts.bus ?? new EventBus();
  const compiler = new Compiler(cfg, (r) => bus.emit('compile', r));
  const watcher = opts.watch ? new WatchManager(cfg, bus) : null;
  const settings = new Settings(cfg, bus, { onApply: () => watcher?.restart() });
  // settings.json > .env > defaults (invalid stored values fall back and are reported as checks).
  settings.load();
  const outline = new OutlineService(cfg, compiler, bus);
  app.addHook('onClose', async () => outline.close());
  const ctx: Ctx = { cfg, bus, compiler, locks: new KeyedLock(), settings, watcher, outline };
  await compiler.load();
  if (watcher) {
    await watcher.start();
    app.addHook('onClose', async () => watcher.close());
  }

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

  // Not configured yet (folders missing): file endpoints answer 409 with a clear message.
  app.addHook('preHandler', async (req, reply) => {
    const roots = rootsFor(req.method, req.url, req.query, req.body);
    if (!roots) return;
    const missing = roots.filter((r) => !isDirSync(rootDir(cfg, r)));
    if (missing.length) {
      reply.code(409).send({
        error: `${NOT_CONFIGURED}: no existe ${missing.map((r) => (r === 'notes' ? `la carpeta de notas (${cfg.notesDir})` : `la carpeta de la memoria (${cfg.memoriaDir})`)).join(' ni ')}`,
        code: 'not_configured',
      });
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

  for (const plugin of [statusRoutes, filesRoutes, fileopsRoutes, notesRoutes, resourcesRoutes, searchRoutes, compileRoutes, synctexRoutes, memoriaRoutes, datosRoutes, plantillaRoutes, eventsRoutes, settingsRoutes]) {
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
