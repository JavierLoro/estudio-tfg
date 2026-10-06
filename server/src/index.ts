import path from 'node:path';
import dotenv from 'dotenv';
import { REPO_ROOT, loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { isConfigured } from './settings.ts';

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
const cfg = loadConfig(process.env);

// settings.json (data/settings.json) is applied inside buildApp; the watcher restarts on every change.
const { app, ctx } = await buildApp(cfg, { logger: true, watch: true });

const shutdown = async () => {
  await app.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
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
