import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from './context.ts';
import { HttpError, badRequest } from './errors.ts';
import { atomicWrite, backup, createExclusive, rev } from './fsutil.ts';
import { isInside, resolveSafe } from './paths.ts';
import { treeKey } from './fileops.ts';
import { ensureLibrary, libraryId } from './libraryIdentity.ts';
import { newLibraryData, updateLibraryContent, urls, UUID, type Bibliography } from './libraryModel.ts';
import { listResources, readResourceFile } from './resources.ts';
import { setFrontmatterKeys } from './frontmatter.ts';
import {
  parseBibDocument,
  parseRis,
  sourceHash,
  normalizeDoi,
  suggestedKey,
  citeKey,
  fieldName,
  type BibEntry,
  type ImportFormat,
} from './bibliography.ts';
import { fetchPublicMetadata } from './metadataHttp.ts';
import { buildRefs, cleanTex } from './refs.ts';

export interface ImportSource {
  format: ImportFormat;
  text: string;
}
interface Choice {
  index: number;
  action: 'create' | 'associate' | 'merge' | 'skip';
  targetId?: string;
  baseRev?: string;
  title: string;
  key: string;
  entryType: string;
  fields: Record<string, string>;
}
interface ItemPlan {
  path: string;
  id: string;
  before: string | null;
  after: string;
}
interface ImportResult {
  index: number;
  state: 'done' | 'error' | 'skipped';
  path?: string;
  id?: string;
  error?: string;
  duplicate?: boolean;
}
interface ImportOperation {
  version: 1;
  id: string;
  fingerprint: string;
  source: ImportSource;
  submitted: any[];
  choices: Choice[];
  plans: Record<string, ItemPlan>;
  results: ImportResult[];
}
const originalPath = (ctx: Ctx, source: ImportSource) =>
  `${ctx.cfg.resourcesSubdir}/originales/${sourceHash(source.text)}.${source.format === 'bibtex' ? 'bib' : source.format === 'ris' ? 'ris' : 'json'}`;
const operationPath = (ctx: Ctx, id: string) =>
  path.join(ctx.cfg.dataDir, 'library', libraryId(ctx.cfg), 'imports', `${id}.json`);
const fold = (v: string) =>
  cleanTex(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const doiOf = (v: string | undefined) => {
  try {
    return v ? normalizeDoi(v) : '';
  } catch {
    return '';
  }
};
const hasOriginal = (bib: Bibliography | undefined, hash: string, index: number) =>
  bib?.authority === 'library' &&
  [bib.source, ...(bib.sources ?? [])].some((source) => source?.hash === hash && source.index === index);
const referenceUrls = (fields: Record<string, string>) => {
  const doi = doiOf(fields.doi),
    result: string[] = [];
  if (doi) result.push(`https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`);
  if (fields.url)
    try {
      result.push(...urls([fields.url]));
    } catch {
      /* la URL original sigue como campo revisable */
    }
  return [...new Set(result)];
};

function checkedSource(input: any): ImportSource {
  if (
    !input ||
    !['bibtex', 'ris', 'doi'].includes(input.format) ||
    typeof input.text !== 'string' ||
    Buffer.byteLength(input.text) > 1024 * 1024 ||
    input.text.includes('\0') ||
    Buffer.from(input.text, 'utf8').toString('utf8') !== input.text
  )
    throw badRequest('Fuente bibliográfica no válida (máximo 1 MiB)');
  return { format: input.format, text: input.text };
}
function doiEntries(text: string): BibEntry[] {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest('Metadatos DOI no válidos');
  }
  const m = parsed?.message ?? parsed;
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw badRequest('Metadatos DOI no válidos');
  const fields: Record<string, string> = {};
  const str = (v: any) => (typeof v === 'string' ? v : '');
  const first = (v: any) => (Array.isArray(v) ? str(v[0]) : str(v));
  const doi = normalizeDoi(str(m.DOI));
  fields.doi = doi;
  if (Array.isArray(m.author)) {
    const names = m.author
      .map((a: any) => (str(a.family) ? `${str(a.family)}${str(a.given) ? ', ' + a.given : ''}` : str(a.name)))
      .filter(Boolean);
    if (names.length) fields.author = names.join(' and ');
  }
  const year = m.issued?.['date-parts']?.[0]?.[0];
  if (Number.isInteger(year) && year > 0) fields.year = String(year);
  for (const [key, value] of Object.entries({
    journaltitle: first(m['container-title']),
    publisher: str(m.publisher),
    volume: str(m.volume),
    number: str(m.issue),
    pages: str(m.page),
    url: str(m.URL),
  }))
    if (value) fields[key] = value;
  const title = first(m.title),
    entryType =
      (
        { 'journal-article': 'article', book: 'book', 'book-chapter': 'incollection', 'posted-content': 'online' } as Record<string, string>
      )[str(m.type)] ?? 'misc';
  return [
    {
      key: '',
      entryType,
      title,
      fields,
      raw: text,
      start: 0,
      end: text.length,
      ...(!title ? { error: 'No hay título; complétalo manualmente antes de importar' } : {}),
    },
  ];
}
export const importEntries = (source: ImportSource): BibEntry[] =>
  source.format === 'bibtex'
    ? parseBibDocument(source.text).entries
    : source.format === 'ris'
      ? parseRis(source.text)
      : doiEntries(source.text);

async function knownKeys(ctx: Ctx) {
  const keys = new Set((await listResources(ctx.cfg)).items.map((r) => r.bibliography?.key).filter((v): v is string => !!v));
  try {
    for (const c of (await buildRefs(ctx.cfg)).citas) keys.add(c.key);
  } catch (e: any) {
    if (e.code !== 'ENOENT' && !(e instanceof HttpError && e.body?.code === 'not_configured')) throw e;
  }
  return keys;
}
export async function importPreview(ctx: Ctx, input: any) {
  let source: ImportSource, warning: string | undefined;
  if (input?.format === 'doi' && typeof input.doi === 'string') {
    const doi = normalizeDoi(input.doi);
    try {
      const response = await (ctx.fetchMetadata ?? fetchPublicMetadata)(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      if (response.status !== 200 || response.body.length > 1024 * 1024) throw new Error('Respuesta DOI no válida');
      source = checkedSource({ format: 'doi', text: response.body.toString('utf8') });
      if (doiOf(importEntries(source)[0]?.fields.doi) !== doi) throw new Error('El DOI devuelto no coincide');
    } catch (e) {
      warning = e instanceof Error ? e.message : 'No se pudo consultar el DOI';
      source = { format: 'doi', text: JSON.stringify({ DOI: doi }) };
    }
  } else source = checkedSource(input);
  const entries = importEntries(source),
    hash = sourceHash(source.text),
    keys = await knownKeys(ctx),
    resources = (await listResources(ctx.cfg)).items;
  const items = entries.map((entry, index) => {
    let key = suggestedKey(entry.title, entry.fields, entry.key),
      n = 2;
    const stem = key;
    while (keys.has(key)) key = `${stem}-${n++}`;
    keys.add(key);
    const candidates = resources
      .filter((r) => !r.libraryError && r.id)
      .flatMap((r) => {
        const bib = r.bibliography as any,
          exact = hasOriginal(r.bibliography, hash, index);
        const sameDoi = !!doiOf(entry.fields.doi) && doiOf(bib?.fields?.doi) === doiOf(entry.fields.doi);
        const sameTitle = !!fold(entry.title) && fold(entry.title) === fold(r.title);
        return exact || sameDoi || sameTitle
          ? [
              {
                id: r.id,
                path: r.path,
                title: r.title,
                baseRev: r.rev,
                reason: exact ? 'original' : sameDoi ? 'doi' : 'titulo',
                exact,
                manual: bib?.authority === 'manual',
              },
            ]
          : [];
      });
    return { index, key, title: entry.title, entryType: entry.entryType, fields: entry.fields, error: entry.error, candidates };
  });
  return { libraryId: libraryId(ctx.cfg), source, items, ...(warning ? { warning } : {}) };
}
function checkedChoice(c: any): Choice {
  if (!c || !Number.isInteger(c.index) || c.index < 0 || c.index >= 100 || !['create', 'associate', 'merge', 'skip'].includes(c.action))
    throw badRequest('Decisión de importación no válida');
  if (c.action === 'skip') return { ...c, title: '', key: '', entryType: 'misc', fields: {} };
  if (
    typeof c.title !== 'string' ||
    !c.title.trim() ||
    c.title.length > 1000 ||
    typeof c.key !== 'string' ||
    !citeKey.test(c.key) ||
    typeof c.entryType !== 'string' ||
    !/^[A-Za-z]+$/.test(c.entryType)
  )
    throw badRequest('Indica título, tipo y clave bibliográfica válidos');
  if (
    !c.fields ||
    typeof c.fields !== 'object' ||
    Array.isArray(c.fields) ||
    Object.keys(c.fields).length > 100 ||
    Object.entries(c.fields).some(([k, v]) => !fieldName.test(k) || k === 'title' || typeof v !== 'string' || Buffer.byteLength(v) > 65536)
  )
    throw badRequest('Campos bibliográficos no válidos');
  if (c.action !== 'create' && (!UUID.test(c.targetId) || typeof c.baseRev !== 'string' || !/^[a-f0-9]{16}$/.test(c.baseRev)))
    throw badRequest('Asociar o combinar necesita identidad y revisión de la ficha');
  return {
    index: c.index,
    action: c.action,
    title: c.title,
    key: c.key,
    entryType: c.entryType,
    fields: c.fields,
    ...(c.targetId ? { targetId: c.targetId, baseRev: c.baseRev } : {}),
  };
}
async function finishImport(ctx: Ctx, op: ImportOperation) {
  const save = () => atomicWrite(operationPath(ctx, op.id), JSON.stringify(op) + '\n');
  const original = await resolveSafe(ctx.cfg, 'notes', originalPath(ctx, op.source));
  await fs.mkdir(path.dirname(original.abs), { recursive: true });
  await resolveSafe(ctx.cfg, 'notes', original.rel);
  if (!(await createExclusive(original.abs, op.source.text)) && !Buffer.from(op.source.text).equals(await fs.readFile(original.abs)))
    throw new HttpError(409, 'El original bibliográfico cambió; conserva el registro antes de repararlo');
  const hash = sourceHash(op.source.text);
  for (const choice of op.choices) {
    if (op.results.some((r) => r.index === choice.index && (r.state === 'done' || r.state === 'skipped'))) continue;
    op.results = op.results.filter((r) => r.index !== choice.index);
    try {
      if (choice.action === 'skip') {
        op.results.push({ index: choice.index, state: 'skipped' });
        await save();
        continue;
      }
      let plan = op.plans[choice.index];
      if (!plan) {
        const items = (await listResources(ctx.cfg)).items;
        const exact = items.filter((r) => hasOriginal(r.bibliography, hash, choice.index));
        if (choice.action === 'create' && exact.length === 1) {
          op.results.push({ index: choice.index, state: 'done', path: exact[0].path, id: exact[0].id!, duplicate: true });
          await save();
          continue;
        }
        if (exact.length > 1) throw new HttpError(409, 'El original está asociado a varias fichas; decide cuál conservar');
        const bibliography: any = {
          authority: 'library',
          key: choice.key,
          entryType: choice.entryType,
          fields: choice.fields,
          source: { format: op.source.format, hash, index: choice.index },
        };
        if (choice.action === 'create') {
          if ((await knownKeys(ctx)).has(choice.key))
            throw new HttpError(409, `La clave ${choice.key} ya está en uso; elige otra sin cambiar citas existentes`);
          const id = crypto.randomUUID(),
            rel = `${ctx.cfg.resourcesSubdir}/${id}.md`;
          const library = {
            ...newLibraryData({
              id,
              kind: choice.entryType === 'book' ? 'book' : 'article',
              method: 'bibliography',
              urls: referenceUrls(choice.fields),
            }),
            bibliography,
          };
          const after = setFrontmatterKeys('', {
            title: choice.title,
            status: 'inbox',
            captured: new Date().toISOString(),
            tags: ['recurso'],
            biblioteca: library,
          });
          plan = { id, path: rel, before: null, after };
        } else {
          const matches = items.filter((r) => r.id === choice.targetId);
          if (matches.length !== 1 || matches[0].libraryError)
            throw new HttpError(409, 'La ficha de destino desapareció o tiene una identidad duplicada');
          const file = await readResourceFile(ctx.cfg, matches[0].path);
          if (file.rev !== choice.baseRev) throw new HttpError(409, 'La ficha cambió; revisa la combinación antes de reintentarlo');
          if (file.item.bibliography?.authority === 'manual')
            throw badRequest('La bibliografía manual se edita en su .bib; no se sustituye al importar');
          if (choice.action === 'associate' && file.item.bibliography)
            throw badRequest('La ficha ya tiene referencia; revisa y elige Combinar');
          const old = file.item.bibliography;
          if (old?.authority === 'library' && old.key) bibliography.key = old.key;
          else if ((await knownKeys(ctx)).has(choice.key)) throw new HttpError(409, 'La clave propuesta está en uso');
          if (old?.authority === 'library') {
            bibliography.fields = { ...old.fields, ...choice.fields };
            const previous = old as any;
            bibliography.sources = [...(previous.sources ?? []), ...(previous.source ? [previous.source] : [])];
          }
          plan = {
            id: matches[0].id!,
            path: file.path,
            before: file.content,
            after: updateLibraryContent(file.content, {
              title: choice.title,
              bibliography,
              urls: [...new Set([...(file.item.urls ?? []), ...referenceUrls(choice.fields)])],
            }),
          };
        }
        if (Buffer.byteLength(JSON.stringify({ ...op, plans: { ...op.plans, [choice.index]: plan } })) > 20 * 1024 * 1024)
          throw new HttpError(413, 'El lote supera 20 MiB; importa menos referencias');
        op.plans[choice.index] = plan;
        await save();
      }
      await ctx.locks.run(`notes:${plan.path}`, async () => {
        const r = await resolveSafe(ctx.cfg, 'notes', plan.path);
        const root = await resolveSafe(ctx.cfg, 'notes', ctx.cfg.resourcesSubdir);
        if (!isInside(root.abs, r.abs) || !r.rel.endsWith('.md') || !UUID.test(plan.id))
          throw badRequest('Destino de importación no válido');
        const bytes = r.exists ? await fs.readFile(r.abs) : null;
        if (bytes && bytes.equals(Buffer.from(plan.after))) return;
        if (plan.before === null) {
          if (bytes) throw new HttpError(409, 'El destino de importación está ocupado');
          await fs.mkdir(path.dirname(r.abs), { recursive: true });
          await resolveSafe(ctx.cfg, 'notes', r.rel);
          if (!(await createExclusive(r.abs, plan.after))) throw new HttpError(409, 'El destino de importación cambió');
        } else {
          if (!bytes || rev(bytes) !== rev(plan.before))
            throw new HttpError(409, 'La ficha cambió durante la importación; el registro se conserva');
          await backup(ctx.cfg, 'notes', r.rel, bytes);
          await atomicWrite(r.abs, plan.after);
        }
        ctx.bus.change({ root: 'notes', path: r.rel, kind: 'change' });
      });
      op.results.push({ index: choice.index, state: 'done', path: plan.path, id: plan.id });
    } catch (e) {
      op.results.push({ index: choice.index, state: 'error', error: e instanceof Error ? e.message : 'No se pudo importar la referencia' });
    }
    await save();
  }
  return { operationId: op.id, results: op.results };
}
export async function importApply(ctx: Ctx, input: any) {
  if (input?.libraryId !== libraryId(ctx.cfg)) throw new HttpError(409, 'La biblioteca cambió; vuelve al destino de la importación');
  if (!UUID.test(input.operationId) || !Array.isArray(input.items) || input.items.length > 100)
    throw badRequest('Operación de importación no válida');
  const source = checkedSource(input.source),
    entries = importEntries(source);
  // Cada entrada errónea se puede corregir o excluir sin impedir importar las demás.
  const choices: Choice[] = [],
    errors: ImportResult[] = [];
  for (const c of input.items)
    try {
      const choice = checkedChoice(c);
      if (!entries[choice.index]) throw badRequest('La referencia no pertenece al original');
      choices.push(choice);
    } catch (e) {
      if (!Number.isInteger(c?.index) || c.index < 0 || c.index >= 100) throw badRequest('Índice de referencia no válido');
      errors.push({ index: c.index, state: 'error', error: e instanceof Error ? e.message : 'Datos no válidos' });
    }
  if (new Set(input.items.map((c: any) => c.index)).size !== input.items.length) throw badRequest('Referencias repetidas en la selección');
  const fingerprint = sourceHash(JSON.stringify({ source, items: input.items }));
  return ctx.locks.run(treeKey('notes'), async () => {
    await ensureLibrary(ctx.cfg);
    const file = operationPath(ctx, input.operationId);
    let op: ImportOperation;
    try {
      op = JSON.parse(await fs.readFile(file, 'utf8'));
      if (op.version !== 1 || op.id !== input.operationId || op.fingerprint !== fingerprint)
        throw new HttpError(409, 'El ID de importación ya tiene otra selección; conserva el original y usa una operación nueva');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      op = { version: 1, id: input.operationId, fingerprint, source, submitted: input.items, choices, plans: {}, results: errors };
      await fs.mkdir(path.dirname(file), { recursive: true });
      if (!(await createExclusive(file, JSON.stringify(op) + '\n'))) throw new HttpError(409, 'La operación ya existe; recarga su estado');
    }
    return finishImport(ctx, op);
  });
}
export async function importOperations(ctx: Ctx) {
  const dir = path.dirname(operationPath(ctx, 'lista'));
  const names = await fs.readdir(dir).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  const items = [],
    resources = (await listResources(ctx.cfg)).items;
  for (const name of names.filter((n) => n.endsWith('.json') && UUID.test(n.slice(0, -5)))) {
    const op = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as ImportOperation;
    const results = op.results.map((r) => {
      if (r.state !== 'error' || op.choices.some((c) => c.index === r.index)) return r;
      const hash = sourceHash(op.source.text),
        matches = resources.filter((resource) => hasOriginal(resource.bibliography, hash, r.index));
      return matches.length === 1
        ? { index: r.index, state: 'done' as const, path: matches[0].path, id: matches[0].id, duplicate: true }
        : r;
    });
    items.push({ operationId: op.id, libraryId: libraryId(ctx.cfg), source: op.source, items: op.submitted, results });
  }
  return { libraryId: libraryId(ctx.cfg), items };
}
