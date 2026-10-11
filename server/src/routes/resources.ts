import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Ctx } from '../context.ts';
import { parseTags, receiveUpload, type CaptureInput } from '../capture.ts';
import { capture, captureOperationState } from '../captureOperations.ts';
import { HttpError, badRequest, notFound } from '../errors.ts';
import { setFrontmatterKeys } from '../frontmatter.ts';
import { atomicWrite, backup, rev } from '../fsutil.ts';
import { resolveSafe } from '../paths.ts';
import { itemFromContent, listResources, readResourceFile } from '../resources.ts';
import { RESOURCE_KINDS, strings, updateLibraryContent, type ResourceKind } from '../libraryModel.ts';

async function readCaptureInput(req: FastifyRequest, cfg: Ctx['cfg']): Promise<CaptureInput> {
  const input: CaptureInput = {};
  const set = (k: string, v: unknown) => {
    if ((k === 'operationId' || k === 'libraryId') && v !== undefined && typeof v !== 'string') throw badRequest(`${k} no válido`);
    if (typeof v !== 'string') return;
    if (k === 'libraryVersion') {
      if (v !== '1') throw badRequest('Versión de biblioteca no válida');
      input.libraryVersion = 1;
    } else if (k === 'kind') {
      if (!RESOURCE_KINDS.includes(v as ResourceKind)) throw badRequest('Tipo de recurso no válido');
      input.kind = v as ResourceKind;
    } else if (k === 'collections') input.collections = strings(v.split(','), 'collections');
    if (k === 'operationId') input.operationId = v;
    else if (k === 'libraryId') input.libraryId = v;
    else if (k === 'url') input.url = v;
    else if (k === 'title') input.title = v;
    else if (k === 'note') input.note = v;
    else if (k === 'tags') input.tags = parseTags(v);
  };
  if (!req.isMultipart()) {
    const b = (req.body ?? {}) as Record<string, unknown>;
    for (const k of ['url', 'title', 'note', 'operationId', 'libraryId', 'kind', 'collections']) set(k, b[k]);
    if (b.libraryVersion !== undefined) {
      if (b.libraryVersion !== 1) throw badRequest('Versión de biblioteca no válida');
      input.libraryVersion = 1;
    }
    if (b.tags !== undefined) input.tags = parseTags(b.tags);
    if (b.collections !== undefined) input.collections = Array.isArray(b.collections) ? strings(b.collections, 'collections') : input.collections;
    return input;
  }
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!['file', 'files'].includes(part.fieldname)) {
          part.file.resume();
          continue;
        }
        const tmpAbs = await receiveUpload(cfg, part.file);
        if ((part.file as any).truncated) {
          await fs.rm(tmpAbs, { force: true });
          throw new HttpError(413, 'Adjunto demasiado grande (máx. 50 MB)');
        }
        const file = { tmpAbs, filename: part.filename || 'adjunto' };
        (input.files ??= []).push(file);
        input.file ??= file;
        let total = 0;
        for (const file of input.files) total += (await fs.stat(file.tmpAbs)).size;
        if (total > 200 * 1024 * 1024) throw new HttpError(413, 'Los adjuntos superan 200 MB en total');
      } else {
        set(part.fieldname, part.value);
      }
    }
  } catch (e) {
    for (const file of input.files ?? []) await fs.rm(file.tmpAbs, { force: true });
    throw e;
  }
  if (input.libraryVersion !== 1 && (input.files?.length ?? 0) > 1) {
    for (const file of input.files ?? []) await fs.rm(file.tmpAbs, { force: true });
    throw badRequest('Solo se admite un archivo en el formato antiguo');
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
      return await capture(destination, input, undefined, ctx.fetchMetadata);
    } finally {
      for (const file of input.files ?? []) await fs.rm(file.tmpAbs, { force: true });
    }
  });

  app.get('/api/capture/operation', async (req) => {
    const q = req.query as Record<string, unknown>;
    return captureOperationState({ ...cfg }, q.operationId, q.libraryId);
  });

  app.get('/api/resources', async () => listResources({ ...cfg }));
  app.get('/api/resources/file', async (req) => {
    try { return await readResourceFile({ ...cfg }, (req.query as Record<string, unknown>).path); }
    catch (e: any) { if (e?.code === 'ENOENT') throw notFound('Recurso no encontrado'); throw e; }
  });

  app.patch('/api/resources', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const r = await resolveSafe(cfg, 'notes', b.path);
    if (!r.rel.toLowerCase().endsWith('.md')) throw badRequest('Solo archivos .md');
    const updates: Record<string, unknown> = {};
    if (b.status !== undefined) {
      if (typeof b.status !== 'string' || !b.status.trim()) throw badRequest('status no válido');
      updates.status = b.status.trim();
    }
    if (b.tags !== undefined) {
      if (!Array.isArray(b.tags) && typeof b.tags !== 'string') throw badRequest('tags no válido');
      updates.tags = parseTags(b.tags);
    }
    if (b.title !== undefined) {
      if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 1000) throw badRequest('Título no válido');
      updates.title = b.title.trim();
    }
    for (const key of ['kind', 'note', 'bibliography'] as const) if (b[key] !== undefined) updates[key] = b[key];
    for (const key of ['urls', 'collections', 'attachments'] as const) if (b[key] !== undefined) updates[key] = strings(b[key], key);
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
      const existing = itemFromContent(r.rel, src, new Date());
      if (existing.libraryError) throw new HttpError(422, existing.libraryError);
      if (existing.id && (await listResources(cfg)).items.filter((item) => item.id === existing.id).length > 1) throw new HttpError(409, 'Identidad duplicada; no se modificó la ficha');
      for (const value of (updates.attachments as string[] | undefined) ?? []) {
        await resolveSafe(cfg, 'notes', path.posix.join(path.posix.dirname(r.rel), value));
      }
      let next = src;
      if (Object.keys(updates).length) {
        try {
          next = updateLibraryContent(src, updates);
        } catch (e) {
          if (e instanceof HttpError) throw e;
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
