import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { isValidBuildId } from '../compile.ts';
import type { Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { resolveSafe } from '../paths.ts';
import { forward, inverse, outlinePositions } from '../synctex.ts';

const NO_SYNCTEX = 'No hay datos de SyncTeX para esta compilación';

/** Número de la query: entero positivo (int) o real finito. */
function num(v: unknown, name: string, int: boolean): number {
  const s = typeof v === 'string' ? v.trim() : '';
  const n = s === '' ? NaN : Number(s);
  if (!Number.isFinite(n) || (int && (!Number.isInteger(n) || n < 1))) throw badRequest(`Parámetro «${name}» no válido`);
  return n;
}

/** Ruta relativa a la memoria, con `/`, sin `..` ni partes vacías raras. */
function relFile(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().replace(/\\/g, '/') : '';
  const parts = s.split('/').filter((p) => p && p !== '.');
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.includes('\0') || !parts.length || parts.includes('..')) {
    throw badRequest('Parámetro «file» no válido: debe ser una ruta relativa a la memoria');
  }
  return parts.join('/');
}

/** Línea que abre un título (\chapter, \section…): al saltar a ella hay que ignorar la página que cierra el \cleardoublepage. */
const HEADING_RE = /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*[[{]/;

export default async function synctexRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const { compiler } = ctx;

  async function isHeadingLine(file: string, line: number): Promise<boolean> {
    try {
      const { abs } = await resolveSafe(ctx.cfg, 'memoria', file);
      const text = await fs.readFile(abs, 'utf8');
      return HEADING_RE.test(text.split('\n')[line - 1] ?? '');
    } catch {
      return false;
    }
  }

  /** Compilación pedida o, por defecto, la del último PDF bueno. */
  async function load(build: unknown) {
    let id: string | null;
    if (build === undefined || build === '') {
      await compiler.load();
      id = compiler.lastGoodBuildId;
      if (!id) throw notFound('Aún no hay ningún PDF compilado');
    } else {
      if (typeof build !== 'string' || !isValidBuildId(build)) throw badRequest('Parámetro «build» no válido');
      id = build;
    }
    const data = await compiler.synctex(id);
    if (!data) throw notFound(NO_SYNCTEX);
    return { id, data };
  }

  app.get('/api/synctex/forward', async (req) => {
    const q = req.query as Record<string, unknown>;
    const file = relFile(q.file);
    const line = num(q.line, 'line', true);
    const { id, data } = await load(q.build);
    const heading = await isHeadingLine(file, line);
    const hit = forward(data, file, line, { heading });
    if (!hit) throw notFound(`No se encontró ${file}:${line} en el PDF`);
    return { build: id, ...hit };
  });

  app.get('/api/synctex/inverse', async (req) => {
    const q = req.query as Record<string, unknown>;
    const page = num(q.page, 'page', true);
    const x = num(q.x, 'x', false);
    const y = num(q.y, 'y', false);
    const { id, data } = await load(q.build);
    const hit = inverse(data, page, x, y);
    if (!hit) throw notFound('No se encontró código de la memoria en esa posición del PDF');
    return { build: id, ...hit };
  });

  /** Posición en el PDF de cada apartado de la vista Documento (orden del documento). */
  app.get('/api/synctex/outline', async (req) => {
    const q = req.query as Record<string, unknown>;
    const { id, data } = await load(q.build);
    const { flat } = await ctx.outline.built();
    return { build: id, items: outlinePositions(data, flat.filter((it) => it.enabled)) };
  });

  app.get('/api/synctex/file/:buildId', async (req, reply) => {
    const { buildId } = req.params as { buildId: string };
    const abs = await compiler.buildFile(buildId, '.synctex.gz');
    if (!abs) throw notFound(NO_SYNCTEX);
    const st = await fs.stat(abs);
    reply.header('content-type', 'application/gzip');
    reply.header('content-length', st.size);
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    return reply.send(createReadStream(abs));
  });
}
