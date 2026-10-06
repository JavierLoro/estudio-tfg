import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { REPO_ROOT, loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { startWatcher } from './events.ts';

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
const cfg = loadConfig(process.env);

for (const [name, dir] of [['NOTES_DIR', cfg.notesDir], ['MEMORIA_DIR', cfg.memoriaDir]] as const) {
  if (!fs.existsSync(dir)) {
    console.error(`[estudio-tfg] ${name} no existe: ${dir}`);
    process.exit(1);
  }
}

const { app, ctx } = await buildApp(cfg, { logger: true });
const watcher = startWatcher(cfg, ctx.bus);

const shutdown = async () => {
  await watcher.close().catch(() => {});
  await app.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
app.log.info({ notesDir: cfg.notesDir, memoriaDir: cfg.memoriaDir, buildDir: cfg.buildDir, workerUrl: cfg.workerUrl }, 'Estudio TFG server listo');
