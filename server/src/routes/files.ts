import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { HttpError, badRequest, notFound } from '../errors.ts';
import { atomicWrite, backup, createExclusive, isTextPath, rev } from '../fsutil.ts';
import { contentTypeFor } from '../mime.ts';
import { parseRoot, resolveSafe } from '../paths.ts';
import { buildTree } from '../tree.ts';

type Q = Record<string, string | undefined>;

function requireText(rel: string) {
  if (!isTextPath(rel)) throw new HttpError(415, 'Tipo de archivo no soportado como texto');
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string') throw badRequest(`${name} es obligatorio`);
  return v;
}

export default async function filesRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { cfg, locks } = ctx;

  app.get('/api/tree', async (req) => {
    const root = parseRoot((req.query as Q).root);
    return { root, entries: await buildTree(cfg, root) };
  });

  app.get('/api/file', async (req) => {
    const q = req.query as Q;
    const root = parseRoot(q.root);
    const r = await resolveSafe(cfg, root, q.path);
    if (!r.exists) throw notFound('Archivo no encontrado');
    const st = await fs.stat(r.abs);
    if (!st.isFile()) throw badRequest('No es un archivo');
    requireText(r.rel);
    const buf = await fs.readFile(r.abs);
    return { root, path: r.rel, content: buf.toString('utf8'), rev: rev(buf), mtime: st.mtimeMs };
  });

  app.put('/api/file', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const root = parseRoot(b.root);
    const content = requireString(b.content, 'content');
    const baseRev = requireString(b.baseRev, 'baseRev');
    const r = await resolveSafe(cfg, root, b.path);
    requireText(r.rel);
    return locks.run(`${root}:${r.rel}`, async () => {
      let current: Buffer;
      try {
        current = await fs.readFile(r.abs);
      } catch (e: any) {
        if (e?.code === 'ENOENT') throw notFound('Archivo no encontrado (usa POST para crearlo)');
        if (e?.code === 'EISDIR') throw badRequest('No es un archivo');
        throw e;
      }
      const curRev = rev(current);
      if (curRev !== baseRev) {
        reply.code(409);
        return { error: 'conflict', content: current.toString('utf8'), rev: curRev };
      }
      const next = Buffer.from(content, 'utf8');
      if (!current.equals(next)) {
        await backup(cfg, root, r.rel, current);
        await atomicWrite(r.abs, next);
      }
      const st = await fs.stat(r.abs);
      return { rev: rev(next), mtime: st.mtimeMs };
    });
  });

  app.post('/api/file', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const root = parseRoot(b.root);
    const content = typeof b.content === 'string' ? b.content : '';
    const r = await resolveSafe(cfg, root, b.path);
    requireText(r.rel);
    return locks.run(`${root}:${r.rel}`, async () => {
      if (r.exists) {
        reply.code(409);
        return { error: 'El archivo ya existe' };
      }
      await fs.mkdir(path.dirname(r.abs), { recursive: true });
      // Re-check containment after creating folders.
      await resolveSafe(cfg, root, r.rel);
      const buf = Buffer.from(content, 'utf8');
      if (!(await createExclusive(r.abs, buf))) {
        reply.code(409);
        return { error: 'El archivo ya existe' };
      }
      const st = await fs.stat(r.abs);
      return { rev: rev(buf), mtime: st.mtimeMs };
    });
  });

  app.get('/api/raw', async (req, reply) => {
    const q = req.query as Q;
    const root = parseRoot(q.root);
    const r = await resolveSafe(cfg, root, q.path);
    if (!r.exists) throw notFound('Archivo no encontrado');
    const st = await fs.stat(r.abs);
    if (!st.isFile()) throw badRequest('No es un archivo');
    reply.header('content-type', contentTypeFor(r.rel));
    reply.header('content-length', st.size);
    reply.header('cache-control', 'no-cache');
    reply.header('x-content-type-options', 'nosniff');
    if (r.rel.toLowerCase().endsWith('.svg')) reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
    reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(r.rel))}`);
    return reply.send(createReadStream(r.abs));
  });
}
