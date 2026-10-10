import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { REPO_ROOT, loadConfig, type Config } from '../src/config.ts';
import type { Ctx } from '../src/context.ts';
import { copyTemplate } from '../../scripts/memoria-template.mjs';

export const FIXTURES = path.join(REPO_ROOT, 'test', 'fixtures');

export interface TestEnv {
  dir: string;
  cfg: Config;
  app: FastifyInstance;
  ctx: Ctx;
  close: () => Promise<void>;
}

/** Copy test/fixtures (notes) and the template (templates/base + perfil esi-uclm, as memoria) into a fresh temp dir and build an app pointing there. Never touches the real vault. */
export async function setup(env: Record<string, string> = {}, opts: { fetchMetadata?: Ctx['fetchMetadata']; watch?: boolean; before?: (dir: string) => Promise<void> } = {}): Promise<TestEnv> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-test-')));
  await fs.cp(FIXTURES, path.join(dir, 'fixtures'), { recursive: true });
  await fs.mkdir(path.join(dir, 'fixtures', 'memoria'), { recursive: true });
  copyTemplate(path.join(dir, 'fixtures', 'memoria'));
  const cfg = loadConfig(
    {
      NOTES_DIR: './fixtures/notes',
      MEMORIA_DIR: './fixtures/memoria',
      RESOURCES_SUBDIR: 'Recursos',
      MEMORIA_MAIN: 'tfg.tex',
      BUILD_DIR: './data/builds',
      WORKER_URL: 'http://127.0.0.1:1',
      AUTH_TOKEN: '',
      ALLOWED_ROOTS: dir,
      ...env,
    },
    dir,
  );
  for (const p of [cfg.notesDir, cfg.memoriaDir, cfg.buildDir, cfg.settingsFile]) {
    if (!p.startsWith(dir)) throw new Error(`Test config escapes temp dir: ${p}`);
  }
  await opts.before?.(dir);
  const { app, ctx } = await buildApp(cfg, { serveWeb: false, watch: opts.watch, fetchMetadata: opts.fetchMetadata });
  await app.ready();
  return {
    dir,
    cfg,
    app,
    ctx,
    close: async () => {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

/** Build a multipart payload for fastify.inject from a FormData. */
export async function multipart(fd: FormData): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const req = new Request('http://localhost/', { method: 'POST', body: fd });
  return {
    payload: Buffer.from(await req.arrayBuffer()),
    headers: { 'content-type': req.headers.get('content-type')! },
  };
}

export function flatPaths(entries: { path: string; children?: any[] }[]): string[] {
  return entries.flatMap((e) => [e.path, ...(e.children ? flatPaths(e.children) : [])]);
}

const symlinkSupport = new Map<string, Promise<boolean>>();

/** Prueba una vez por tipo; en Windows las carpetas usan junction sin privilegios. */
export function canSymlink(kind: 'file' | 'dir' = 'file'): Promise<boolean> {
  let probe = symlinkSupport.get(kind);
  if (!probe) {
    probe = (async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-symlink-'));
      const target = path.join(dir, 'target');
      try {
        if (kind === 'dir') await fs.mkdir(target);
        else await fs.writeFile(target, 'prueba');
        await fs.symlink(target, path.join(dir, 'link'), kind === 'dir' && process.platform === 'win32' ? 'junction' : kind);
        return true;
      } catch (e: any) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(e?.code)) return false;
        throw e;
      } finally {
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    })();
    symlinkSupport.set(kind, probe);
  }
  return probe;
}
