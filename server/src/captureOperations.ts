import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildResourceMarkdown, localDate, localIso, prepareCapture, sanitizeFilename, sanitizeTitle, type CaptureInput } from './capture.ts';
import { realpathLoose, type Config } from './config.ts';
import { badRequest, HttpError } from './errors.ts';
import { atomicWrite, createExclusive, KeyedLock } from './fsutil.ts';
import type { MetadataFetcher } from './metadataHttp.ts';
import { resolveSafe } from './paths.ts';

const locks = new KeyedLock();
// Índice regenerable: no releer todos los recibos en cada captura nueva.
const reservations = new Map<string, Set<string>>();
const hash = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const OP_ID = /^[A-Za-z0-9-]{8,100}$/;
interface Operation {
  version: 1;
  fingerprint: string;
  result: { path: string; title: string; warning?: string };
  state: 'prepared' | 'done';
  markdown?: string;
  attachment?: { path: string; hash: string };
}

/** Identidad del destino, independiente de la memoria y de la fecha de arranque. */
export function libraryId(cfg: Config): string {
  let root = realpathLoose(path.join(cfg.notesDir, cfg.resourcesSubdir));
  if (process.platform === 'win32') root = path.toNamespacedPath(root).toLowerCase();
  return hash(root).slice(0, 32);
}
const operationsDir = (cfg: Config) => path.join(path.dirname(cfg.buildDir), 'captures', libraryId(cfg));
const operationDir = (cfg: Config, id: string) => path.join(operationsDir(cfg), id);

async function readOperation(dir: string): Promise<Operation | null> {
  try {
    const op = JSON.parse(await fs.readFile(path.join(dir, 'operation.json'), 'utf8')) as Operation;
    if (op.version !== 1 || !['prepared', 'done'].includes(op.state) || !op.result?.path || !op.fingerprint) {
      throw new Error('Registro de captura no válido; conserva una copia antes de repararlo');
    }
    return op;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

async function reservedPaths(cfg: Config): Promise<Set<string>> {
  const target = libraryId(cfg);
  const cached = reservations.get(target);
  if (cached) return cached;
  const paths = new Set<string>();
  const ids = await fs.readdir(operationsDir(cfg)).catch((e) => { if (e.code === 'ENOENT') return []; throw e; });
  for (const id of ids.filter((id) => OP_ID.test(id))) {
    const op = await readOperation(operationDir(cfg, id));
    if (op?.state === 'prepared') {
      paths.add(op.result.path);
      if (op.attachment) paths.add(op.attachment.path);
    }
  }
  reservations.set(target, paths);
  return paths;
}

function releaseReservation(cfg: Config, op: Operation) {
  const paths = reservations.get(libraryId(cfg));
  paths?.delete(op.result.path);
  if (op.attachment) paths?.delete(op.attachment.path);
}

async function unusedPath(cfg: Config, stem: string, ext: string, reserved: Set<string>): Promise<string> {
  for (let n = 1; n <= 1001; n++) {
    const rel = `${stem}${n === 1 ? '' : ` ${n}`}${ext}`;
    const r = await resolveSafe(cfg, 'notes', rel);
    if (!r.exists && !reserved.has(rel)) return rel;
  }
  throw new Error('Demasiadas colisiones de nombre');
}

/** Publicar sin sobrescribir. Si alguien ha ocupado el destino, se conserva el registro. */
async function publish(cfg: Config, rel: string, bytes: Buffer) {
  const r = await resolveSafe(cfg, 'notes', rel);
  await fs.mkdir(path.dirname(r.abs), { recursive: true });
  if (await createExclusive(r.abs, bytes)) return;
  const current = await fs.readFile(r.abs);
  if (!current.equals(bytes)) throw new HttpError(409, `La captura pendiente tiene un conflicto en ${rel}; conserva y revisa el registro de recuperación`);
}

async function finish(cfg: Config, dir: string, op: Operation): Promise<Operation['result']> {
  if (op.state === 'done') { releaseReservation(cfg, op); return op.result; }
  if (typeof op.markdown !== 'string') throw new Error('Falta el texto de la captura pendiente');
  if (op.attachment) {
    const bytes = await fs.readFile(path.join(dir, 'attachment'));
    if (hash(bytes) !== op.attachment.hash) throw new Error('El adjunto de recuperación no coincide');
    await publish(cfg, op.attachment.path, bytes);
  }
  await publish(cfg, op.result.path, Buffer.from(op.markdown));
  // El recibo se conserva: jamás se reutiliza el ID aunque se borre o edite la ficha.
  await atomicWrite(path.join(dir, 'operation.json'), JSON.stringify({ ...op, state: 'done', markdown: undefined }));
  releaseReservation(cfg, op);
  await fs.rm(path.join(dir, 'attachment'), { force: true }).catch(() => {});
  return op.result;
}

export async function capture(cfg: Config, input: CaptureInput, now = new Date(), fetchMetadata?: MetadataFetcher): Promise<Operation['result']> {
  const target = libraryId(cfg);
  if (input.operationId !== undefined && !OP_ID.test(input.operationId)) throw badRequest('operationId no válido');
  if (input.operationId && !input.libraryId) throw badRequest('libraryId es obligatorio con operationId');
  if (input.libraryId !== undefined && input.libraryId !== target) throw new HttpError(409, 'La biblioteca de destino ha cambiado; vuelve al destino original', { code: 'capture_destination_changed' });
  const id = input.operationId ?? crypto.randomUUID();
  const fileBytes = input.file ? await fs.readFile(input.file.tmpAbs) : undefined;
  const fingerprint = hash(JSON.stringify({
    url: input.url?.trim() || '', title: input.title ?? '', note: input.note ?? '', tags: input.tags ?? [],
    file: input.file ? { name: input.file.filename, hash: hash(fileBytes!) } : null,
  }));
  return locks.run(target, async () => {
    const dir = operationDir(cfg, id);
    let op = await readOperation(dir);
    if (op) {
      if (op.fingerprint !== fingerprint) throw new HttpError(409, 'Este identificador de captura ya se usó con otro contenido', { code: 'capture_id_conflict' });
      if (op.state === 'prepared' && fileBytes && op.attachment) {
        // Un fallo antes de guardar el adjunto se recupera con el mismo reenvío.
        await atomicWrite(path.join(dir, 'attachment'), fileBytes);
      }
      return finish(cfg, dir, op);
    }
    // Los nombres interrumpidos siguen reservados aunque falte la ficha.
    const reserved = await reservedPaths(cfg);
    const prepared = await prepareCapture(input, fetchMetadata);
    const res = await resolveSafe(cfg, 'notes', cfg.resourcesSubdir);
    await fs.mkdir(res.abs, { recursive: true });
    let attachment: Operation['attachment'];
    if (input.file) {
      const clean = sanitizeFilename(input.file.filename);
      const ext = path.extname(clean);
      const rel = await unusedPath(cfg, `${res.rel}/adjuntos/${clean.slice(0, clean.length - ext.length)}`, ext, reserved);
      attachment = { path: rel, hash: hash(fileBytes!) };
    }
    const rel = await unusedPath(cfg, `${res.rel}/${localDate(now)} ${sanitizeTitle(prepared.title)}`, '.md', reserved);
    op = {
      version: 1, fingerprint, state: 'prepared', result: { path: rel, title: prepared.title, ...(prepared.warning ? {warning: prepared.warning} : {}) }, attachment,
      markdown: buildResourceMarkdown({ ...prepared, captured: localIso(now), tags: input.tags ?? [], attachment: attachment?.path.slice(res.rel.length + 1) }),
    };
    await fs.mkdir(dir, { recursive: true });
    // Antes de publicar cualquier archivo, guardar intención, nombres y texto.
    await atomicWrite(path.join(dir, 'operation.json'), JSON.stringify(op));
    reserved.add(op.result.path);
    if (op.attachment) reserved.add(op.attachment.path);
    if (fileBytes) await atomicWrite(path.join(dir, 'attachment'), fileBytes);
    return finish(cfg, dir, op);
  });
}

/** Reinicio: terminar registros preparados; los conflictos quedan disponibles para recuperación. */
export async function recoverCaptures(cfg: Config): Promise<string[]> {
  return locks.run(libraryId(cfg), async () => {
    const problems: string[] = [];
    reservations.delete(libraryId(cfg));
    try { await reservedPaths(cfg); }
    catch (e) {
      // Un registro dañado no impide consultar la biblioteca; las escrituras siguen protegidas.
      return [`No se pudo reconstruir el registro: ${e instanceof Error ? e.message : String(e)}`];
    }
    let ids: string[];
    try { ids = await fs.readdir(operationsDir(cfg)); }
    catch (e: any) { if (e?.code === 'ENOENT') return problems; throw e; }
    for (const id of ids.filter((id) => OP_ID.test(id))) {
      try {
        const dir = operationDir(cfg, id);
        const op = await readOperation(dir);
        if (op?.state === 'prepared') await finish(cfg, dir, op);
        else if (op?.state === 'done') await fs.rm(path.join(dir, 'attachment'), { force: true });
      } catch (e) {
        problems.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return problems;
  });
}

export async function captureOperationState(cfg: Config, id: unknown, target: unknown): Promise<{ state: 'unknown' | 'prepared' | 'done' }> {
  if (typeof id !== 'string' || !OP_ID.test(id)) throw badRequest('operationId no válido');
  if (target !== libraryId(cfg)) throw new HttpError(409, 'Vuelve a la biblioteca original');
  return locks.run(libraryId(cfg), async () => ({ state: (await readOperation(operationDir(cfg, id)))?.state ?? 'unknown' }));
}
