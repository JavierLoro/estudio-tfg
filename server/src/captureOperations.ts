import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildResourceMarkdown, localDate, localIso, prepareCapture, sanitizeFilename, sanitizeTitle, type CaptureInput } from './capture.ts';
import type { Config } from './config.ts';
import { ensureLibrary, libraryId } from './libraryIdentity.ts';
import { inferKind, newLibraryData } from './libraryModel.ts';
import { setFrontmatterKeys } from './frontmatter.ts';
import { listResources } from './resources.ts';
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
  result: { path: string; title: string; id?: string; warning?: string };
  state: 'prepared' | 'done';
  markdown?: string;
  attachment?: { path: string; hash: string };
  attachments?: { path: string; hash: string }[];
}

/** Identidad del destino, independiente de la memoria y de la fecha de arranque. */
export { libraryId } from './libraryIdentity.ts';
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
      for (const attachment of attachmentsOf(op)) paths.add(attachment.path);
    }
  }
  reservations.set(target, paths);
  return paths;
}

function releaseReservation(cfg: Config, op: Operation) {
  const paths = reservations.get(libraryId(cfg));
  paths?.delete(op.result.path);
  for (const attachment of attachmentsOf(op)) paths?.delete(attachment.path);
}

const attachmentsOf = (op: Operation) => op.attachments ?? (op.attachment ? [op.attachment] : []);
const stageName = (op: Operation, index: number) => op.attachments ? `attachment-${index}` : 'attachment';

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
  if (op.state === 'done') {
    releaseReservation(cfg, op);
    if (op.result.id) {
      const matches = (await listResources(cfg)).items.filter((item) => item.id === op.result.id);
      if (matches.length > 1) throw new HttpError(409, 'La identidad de ficha está duplicada; revisa la biblioteca');
      if (matches.length === 1) return { ...op.result, path: matches[0].path, title: matches[0].title };
    }
    return op.result;
  }
  if (typeof op.markdown !== 'string') throw new Error('Falta el texto de la captura pendiente');
  for (const [index, attachment] of attachmentsOf(op).entries()) {
    const bytes = await fs.readFile(path.join(dir, stageName(op, index)));
    if (hash(bytes) !== attachment.hash) throw new Error('El adjunto de recuperación no coincide');
    await publish(cfg, attachment.path, bytes);
  }
  await publish(cfg, op.result.path, Buffer.from(op.markdown));
  // El recibo se conserva: jamás se reutiliza el ID aunque se borre o edite la ficha.
  await atomicWrite(path.join(dir, 'operation.json'), JSON.stringify({ ...op, state: 'done', markdown: undefined }));
  releaseReservation(cfg, op);
  for (const [index] of attachmentsOf(op).entries()) await fs.rm(path.join(dir, stageName(op, index)), { force: true }).catch(() => {});
  return op.result;
}

export async function capture(cfg: Config, input: CaptureInput, now = new Date(), fetchMetadata?: MetadataFetcher): Promise<Operation['result']> {
  const target = libraryId(cfg);
  if (input.operationId !== undefined && !OP_ID.test(input.operationId)) throw badRequest('operationId no válido');
  if (input.operationId && !input.libraryId) throw badRequest('libraryId es obligatorio con operationId');
  if (input.libraryId !== undefined && input.libraryId !== target) throw new HttpError(409, 'La biblioteca de destino ha cambiado; vuelve al destino original', { code: 'capture_destination_changed' });
  const id = input.operationId ?? crypto.randomUUID();
  const fileBytes = input.libraryVersion !== 1 && input.file ? await fs.readFile(input.file.tmpAbs) : undefined;
  const files = input.libraryVersion === 1 ? input.files ?? (input.file ? [input.file] : []) : [];
  if (files.length > 20) throw badRequest('Se admiten como máximo 20 archivos por ficha');
  const allBytes = await Promise.all(files.map((file) => fs.readFile(file.tmpAbs)));
  if (allBytes.reduce((sum, bytes) => sum + bytes.length, 0) > 200 * 1024 * 1024) throw new HttpError(413, 'Los adjuntos superan 200 MB en total');
  const fingerprint = hash(JSON.stringify({
    url: input.url?.trim() || '', title: input.title ?? '', note: input.note ?? '', tags: input.tags ?? [],
    file: input.libraryVersion !== 1 && input.file ? { name: input.file.filename, hash: hash(fileBytes!) } : null,
    ...(input.libraryVersion === 1 ? { libraryVersion: 1, kind: input.kind, collections: input.collections ?? [],
      files: files.map((file, i) => ({ name: file.filename, hash: hash(allBytes[i]) })) } : {}),
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
      if (op.state === 'prepared' && op.attachments) for (const [i, bytes] of allBytes.entries()) await atomicWrite(path.join(dir, stageName(op, i)), bytes);
      return finish(cfg, dir, op);
    }
    // Los nombres interrumpidos siguen reservados aunque falte la ficha.
    const reserved = await reservedPaths(cfg);
    const prepared = await prepareCapture(input, fetchMetadata);
    const library = input.libraryVersion === 1 ? newLibraryData({ kind: input.kind ?? inferKind(files[0]?.filename, prepared.url), urls: prepared.url ? [prepared.url] : [], collections: input.collections,
      method: files.length ? 'file' : prepared.url ? 'url' : 'manual' }) : null;
    await ensureLibrary(cfg);
    const res = await resolveSafe(cfg, 'notes', cfg.resourcesSubdir);
    await fs.mkdir(res.abs, { recursive: true });
    let attachment: Operation['attachment'];
    if (input.file && input.libraryVersion !== 1) {
      const clean = sanitizeFilename(input.file.filename);
      const ext = path.extname(clean);
      const rel = await unusedPath(cfg, `${res.rel}/adjuntos/${clean.slice(0, clean.length - ext.length)}`, ext, reserved);
      attachment = { path: rel, hash: hash(fileBytes!) };
    }
    const attachments = [];
    const allocated = new Set(reserved);
    for (const [i, file] of files.entries()) {
      const clean = sanitizeFilename(file.filename), ext = path.extname(clean);
      const rel = await unusedPath(cfg, `${res.rel}/adjuntos/${clean.slice(0, clean.length - ext.length)}`, ext, allocated);
      allocated.add(rel);
      attachments.push({ path: rel, hash: hash(allBytes[i]) });
    }
    const rel = await unusedPath(cfg, `${res.rel}/${localDate(now)} ${sanitizeTitle(prepared.title)}`, '.md', reserved);
    op = {
      version: 1, fingerprint, state: 'prepared', result: { path: rel, title: prepared.title, ...(prepared.warning ? {warning: prepared.warning} : {}) }, attachment,
      ...(input.libraryVersion === 1 ? { attachments } : {}),
      markdown: buildResourceMarkdown({ ...prepared, ...(library ? { url: undefined } : {}), captured: localIso(now), tags: input.tags ?? [], attachment: attachment?.path.slice(res.rel.length + 1) }),
    };
    if (library) {
      library.attachments = attachments.map((a) => path.posix.relative(path.posix.dirname(rel), a.path));
      op.markdown = setFrontmatterKeys(op.markdown!, { biblioteca: library });
      op.result.id = library.id;
    }
    await fs.mkdir(dir, { recursive: true });
    // Antes de publicar cualquier archivo, guardar intención, nombres y texto.
    await atomicWrite(path.join(dir, 'operation.json'), JSON.stringify(op));
    reserved.add(op.result.path);
    if (op.attachment) reserved.add(op.attachment.path);
    for (const attachment of attachments) reserved.add(attachment.path);
    if (fileBytes) await atomicWrite(path.join(dir, 'attachment'), fileBytes);
    for (const [i, bytes] of allBytes.entries()) await atomicWrite(path.join(dir, stageName(op, i)), bytes);
    return finish(cfg, dir, op);
  });
}

/** Reinicio: terminar registros preparados; los conflictos quedan disponibles para recuperación. */
export async function recoverCaptures(cfg: Config): Promise<string[]> {
  try { libraryId(cfg); } catch (e) { return [e instanceof Error ? e.message : 'Identidad de biblioteca no válida']; }
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
        else if (op?.state === 'done') for (const [i] of attachmentsOf(op).entries()) await fs.rm(path.join(dir, stageName(op, i)), { force: true });
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
