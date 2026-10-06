import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { HttpError, badRequest } from '../errors.ts';
import { atomicWrite, backup, rev } from '../fsutil.ts';
import { resolveSafe } from '../paths.ts';
import {
  DATOS_REL,
  INSTITUCION_REL,
  FieldInvalid,
  applyChanges,
  parseDatos,
  validKeys,
  type DatosFile,
} from '../datos.ts';

const MAX_LOGO = 5 * 1024 * 1024;
const REL: Record<DatosFile, string> = { datos: DATOS_REL, institucion: INSTITUCION_REL };

interface DatosResponse {
  datos: Record<string, string>;
  institucion: Record<string, string>;
  rev: { datos: string | null; institucion: string | null };
}

function fieldError(field: string, message: string) {
  return new HttpError(400, message, { field });
}

/** Extensión según el contenido (firma del archivo). */
function logoExt(buf: Buffer): 'pdf' | 'png' | 'jpg' | null {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

export default async function datosRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { cfg, locks } = ctx;

  async function readFile(file: DatosFile): Promise<{ abs: string; buf: Buffer | null }> {
    const r = await resolveSafe(cfg, 'memoria', REL[file]);
    try {
      return { abs: r.abs, buf: await fs.readFile(r.abs) };
    } catch (e: any) {
      if (e?.code === 'ENOENT' || e?.code === 'EISDIR') return { abs: r.abs, buf: null };
      throw e;
    }
  }

  async function snapshot(): Promise<DatosResponse> {
    const [d, i] = await Promise.all([readFile('datos'), readFile('institucion')]);
    return {
      datos: d.buf ? parseDatos(d.buf.toString('utf8'), 'datos') : {},
      institucion: i.buf ? parseDatos(i.buf.toString('utf8'), 'institucion') : {},
      rev: { datos: d.buf ? rev(d.buf) : null, institucion: i.buf ? rev(i.buf) : null },
    };
  }

  /** Bloquea ambos archivos (mismas claves que PUT /api/file) en orden fijo. */
  const withLocks = <T>(fn: () => Promise<T>) =>
    locks.run(`memoria:${DATOS_REL}`, () => locks.run(`memoria:${INSTITUCION_REL}`, fn));

  /** Aplica cambios a un archivo. `expected` undefined = sin comprobar baseRev. */
  async function writeChanges(file: DatosFile, changes: Record<string, unknown>, cur: Buffer): Promise<void> {
    let next: string;
    try {
      next = applyChanges(cur.toString('utf8'), file, changes);
    } catch (e) {
      if (e instanceof FieldInvalid) throw fieldError(e.field, e.message);
      throw e;
    }
    if (next === cur.toString('utf8')) return;
    const abs = (await readFile(file)).abs;
    await backup(cfg, 'memoria', REL[file], cur);
    await atomicWrite(abs, next);
  }

  app.get('/api/memoria/datos', async () => snapshot());

  app.put('/api/memoria/datos', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const baseRev = (b.baseRev ?? {}) as Record<string, unknown>;
    if (typeof b.baseRev !== 'object' || b.baseRev === null) throw badRequest('baseRev es obligatorio');
    const todo: Partial<Record<DatosFile, Record<string, unknown>>> = {};
    for (const file of ['datos', 'institucion'] as const) {
      const ch = b[file];
      if (ch === undefined) continue;
      if (typeof ch !== 'object' || ch === null || Array.isArray(ch)) throw badRequest(`${file} no es válido`);
      const keys = Object.keys(ch);
      if (!keys.length) continue;
      const allowed = validKeys(file);
      for (const k of keys) if (!allowed.includes(k)) throw fieldError(k, `Campo desconocido: ${k}`);
      todo[file] = ch as Record<string, unknown>;
    }

    return withLocks(async () => {
      const cur: Partial<Record<DatosFile, Buffer>> = {};
      for (const file of Object.keys(todo) as DatosFile[]) {
        const { buf } = await readFile(file);
        const first = Object.keys(todo[file]!)[0];
        if (!buf) {
          throw fieldError(
            first,
            file === 'institucion'
              ? 'Esta memoria usa la plantilla anterior (no tiene estilo/institucion.tex)'
              : 'La memoria no tiene datos.tex',
          );
        }
        if (typeof baseRev[file] !== 'string') throw badRequest(`baseRev.${file} es obligatorio`);
        cur[file] = buf;
      }
      // Todo se valida antes de escribir nada: si un archivo falla, el otro no se toca.
      for (const file of Object.keys(todo) as DatosFile[]) {
        if (rev(cur[file]!) !== baseRev[file]) {
          reply.code(409);
          return { error: 'conflict', current: await snapshot() };
        }
      }
      for (const file of Object.keys(todo) as DatosFile[]) {
        try {
          applyChanges(cur[file]!.toString('utf8'), file, todo[file]!);
        } catch (e) {
          if (e instanceof FieldInvalid) throw fieldError(e.field, e.message);
          throw e;
        }
      }
      for (const file of Object.keys(todo) as DatosFile[]) await writeChanges(file, todo[file]!, cur[file]!);
      return snapshot();
    });
  });

  async function requireInstitucion(): Promise<Buffer> {
    const { buf } = await readFile('institucion');
    if (!buf) throw fieldError('logo', 'Esta memoria usa la plantilla anterior (no tiene estilo/institucion.tex)');
    return buf;
  }

  app.post('/api/memoria/logo', async (req) => {
    if (!req.isMultipart()) throw badRequest('Se esperaba multipart/form-data con el campo «file»');
    const part = await req.file({ limits: { fileSize: MAX_LOGO } });
    if (!part || part.fieldname !== 'file') throw badRequest('Falta el campo «file»');
    let data: Buffer;
    try {
      data = await part.toBuffer();
    } catch (e: any) {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE' || e?.statusCode === 413) throw new HttpError(413, 'Logo demasiado grande (máx. 5 MB)');
      throw e;
    }
    if ((part.file as any).truncated) throw new HttpError(413, 'Logo demasiado grande (máx. 5 MB)');
    const ext = logoExt(data);
    const nameExt = path.extname(part.filename || '').toLowerCase().replace('.', '').replace('jpeg', 'jpg');
    if (!ext || (nameExt && nameExt !== ext)) throw fieldError('logo', 'El logo debe ser un PDF, PNG o JPG');

    return withLocks(async () => {
      const cur = await requireInstitucion();
      const rel = `estilo/logo.${ext}`;
      const r = await resolveSafe(cfg, 'memoria', rel);
      await fs.mkdir(path.dirname(r.abs), { recursive: true });
      await resolveSafe(cfg, 'memoria', rel);
      if (r.exists) await backup(cfg, 'memoria', rel, await fs.readFile(r.abs));
      await atomicWrite(r.abs, data);
      // Un logo anterior con otra extensión deja de usarse.
      for (const other of ['pdf', 'png', 'jpg'].filter((x) => x !== ext)) {
        const o = await resolveSafe(cfg, 'memoria', `estilo/logo.${other}`);
        if (o.exists) {
          await backup(cfg, 'memoria', `estilo/logo.${other}`, await fs.readFile(o.abs));
          await fs.rm(o.abs, { force: true });
        }
      }
      await writeChanges('institucion', { logo: `logo.${ext}` }, cur);
      return snapshot();
    });
  });

  app.delete('/api/memoria/logo', async () =>
    withLocks(async () => {
      const cur = await requireInstitucion();
      await writeChanges('institucion', { logo: '' }, cur);
      return snapshot();
    }),
  );
}
