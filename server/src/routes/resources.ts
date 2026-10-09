import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Ctx } from '../context.ts';
import { parseTags, receiveUpload, type CaptureInput } from '../capture.ts';
import { capture, captureOperationState } from '../captureOperations.ts';
import { HttpError, badRequest, notFound } from '../errors.ts';
import { setFrontmatterKeys } from '../frontmatter.ts';
import { atomicWrite, backup, rev } from '../fsutil.ts';
import { resolveSafe } from '../paths.ts';
import { itemFromContent, listResources } from '../resources.ts';

async function readCaptureInput(req: FastifyRequest, cfg: Ctx['cfg']): Promise<CaptureInput> {
  const input: CaptureInput = {};
  const set = (k: string, v: unknown) => {
    if ((k === 'operationId' || k === 'libraryId') && v !== undefined && typeof v !== 'string') throw badRequest(`${k} no válido`);
    if (typeof v !== 'string') return;
    if (k === 'operationId') input.operationId = v;
    else if (k === 'libraryId') input.libraryId = v;
    else if (k === 'url') input.url = v;
    else if (k === 'title') input.title = v;
    else if (k === 'note') input.note = v;
    else if (k === 'tags') input.tags = parseTags(v);
  };
  if (!req.isMultipart()) {
    const b = (req.body ?? {}) as Record<string, unknown>;
    for (const k of ['url', 'title', 'note', 'operationId', 'libraryId']) set(k, b[k]);
    if (b.tags !== undefined) input.tags = parseTags(b.tags);
    return input;
  }
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (input.file || part.fieldname !== 'file') {
          part.file.resume();
          if (input.file) throw badRequest('Solo se admite un archivo');
          continue;
        }
        const tmpAbs = await receiveUpload(cfg, part.file);
        if ((part.file as any).truncated) {
          await fs.rm(tmpAbs, { force: true });
          throw new HttpError(413, 'Adjunto demasiado grande (máx. 50 MB)');
        }
        input.file = { tmpAbs, filename: part.filename || 'adjunto' };
      } else {
        set(part.fieldname, part.value);
      }
    }
  } catch (e) {
    if (input.file) await fs.rm(input.file.tmpAbs, { force: true });
    throw e;
  }
  return input;
}

export default async function resourcesRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { cfg, locks } = ctx;

  app.post('/api/capture', async (req) => {
    // Ajustes puede cambiar cfg durante una subida; toda la operación usa la misma raíz.
    const destination = { ...cfg };
    const input = await readCaptureInput(req, destination);
    try {
      return await capture(destination, input);
    } finally {
      if (input.file) await fs.rm(input.file.tmpAbs, { force: true });
    }
  });

  app.get('/api/capture/operation', async (req) => {
    const q = req.query as Record<string, unknown>;
    return captureOperationState({ ...cfg }, q.operationId, q.libraryId);
  });

  app.get('/api/resources', async () => ({ items: await listResources(cfg) }));

  app.patch('/api/resources', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const r = await resolveSafe(cfg, 'notes', b.path);
    if (!r.rel.toLowerCase().endsWith('.md')) throw badRequest('Solo archivos .md');
    const updates: Record<string, string | string[]> = {};
    if (b.status !== undefined) {
      if (typeof b.status !== 'string' || !b.status.trim()) throw badRequest('status no válido');
      updates.status = b.status.trim();
    }
    if (b.tags !== undefined) {
      if (!Array.isArray(b.tags) && typeof b.tags !== 'string') throw badRequest('tags no válido');
      updates.tags = parseTags(b.tags);
    }
    if (typeof b.baseRev !== 'string' || !/^[a-f0-9]{16}$/.test(b.baseRev)) throw badRequest('baseRev obligatorio (revisión de 16 caracteres)');
    return locks.run(`notes:${r.rel}`, async () => {
      let current: Buffer;
      try {
        current = await fs.readFile(r.abs);
      } catch (e: any) {
        if (e?.code === 'ENOENT') throw notFound('Recurso no encontrado');
        throw e;
      }
      const curRev = rev(current);
      if (b.baseRev !== curRev) {
        reply.code(409);
        return { error: 'conflict', content: current.toString('utf8'), rev: curRev };
      }
      const src = current.toString('utf8');
      let next = src;
      if (Object.keys(updates).length) {
        try {
          next = setFrontmatterKeys(src, updates);
        } catch {
          throw new HttpError(422, 'El frontmatter del recurso no es YAML válido');
        }
      }
      if (next !== src) {
        await backup(cfg, 'notes', r.rel, current);
        await atomicWrite(r.abs, next);
      }
      const st = await fs.stat(r.abs);
      const item = itemFromContent(r.rel, next, st.mtime);
      return { ...item, rev: rev(next), mtime: st.mtimeMs };
    });
  });
}
