import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { REPO_ROOT, checkoutRoot, loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { isConfigured } from './settings.ts';
export { loadConfig, userDataDir } from './config.ts';

/** Entrada reutilizable por la app de escritorio; no lee .env ni instala señales. */
export async function startServer(env: NodeJS.ProcessEnv = process.env) {
  const cfg = loadConfig(env);

  // buildApp aplica settings.json y reinicia el vigilante cuando cambian las carpetas.
  const { app, ctx } = await buildApp(cfg, { logger: true, watch: true });

  let url: string;
  try { url = await app.listen({ port: cfg.port, host: cfg.host }); }
  catch (error) { await app.close(); throw error; }
  app.log.info(
    { notesDir: cfg.notesDir, memoriaDir: cfg.memoriaDir, buildDir: cfg.buildDir, workerUrl: cfg.workerUrl, allowedRoots: cfg.allowedRoots },
    'Estudio TFG server listo',
  );
  if (!isConfigured(cfg)) {
    app.log.warn('Carpetas sin configurar (notas o memoria no existen): configúralas en Ajustes');
  }
  for (const c of (await ctx.settings.view()).checks) {
    if (c.level === 'error') app.log.warn(`[ajustes] ${c.key}: ${c.message}`);
  }
  return { app, ctx, url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (checkoutRoot()) dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
  const { app } = await startServer();
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
