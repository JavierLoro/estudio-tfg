import fs from 'node:fs/promises';
import path from 'node:path';
import { EnginePackage, atomicJson } from './engine-package.mjs';
import { requireAdmin, isConfigured, instanceId, computeSourceRev } from '../server/dist/server.mjs';

export async function setupRoutes(app, ctx, { dataDir, manifest, archive }) {
  ctx.cfg.desktopDataDir = await fs.realpath(dataDir);
  const marker = path.join(dataDir, 'setup.json');
  const engine = new EnginePackage({ dataDir, manifest, archive, onReady: ({ binDir, perlDir }) => {
    ctx.cfg.texBinDir = binDir; ctx.cfg.texPerlDir = perlDir;
  } });
  await engine.load();
  let completion = await fs.readFile(marker, 'utf8').then(JSON.parse).catch(() => null);
  const view = () => ({ engine: engine.view(), needsSetup: !isConfigured(ctx.cfg) || (!!manifest && (completion?.instanceId !== instanceId(ctx.cfg) || !engine.view().current)) });
  const admin = async req => requireAdmin(req, ctx.cfg);
  app.get('/api/desktop/setup', async () => view());
  app.post('/api/desktop/engine/prepare', { preHandler: admin }, async () => engine.prepare());
  app.post('/api/desktop/engine/cancel', { preHandler: admin }, () => engine.cancel());
  app.post('/api/desktop/setup/complete', { preHandler: admin }, async () => {
    const last = await ctx.compiler.last();
    if (!isConfigured(ctx.cfg) || (manifest && !engine.view().current) || !last?.ok || last.sourceRev !== await computeSourceRev(ctx.cfg))
      throw Object.assign(new Error('Crea o selecciona las carpetas y compila la memoria antes de terminar'), { statusCode: 409 });
    completion = { instanceId: instanceId(ctx.cfg), completedAt: new Date().toISOString() };
    await atomicJson(marker, completion);
    return view();
  });
  app.addHook('preClose', () => engine.cancel().then(() => {}));
}
