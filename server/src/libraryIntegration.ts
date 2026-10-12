import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from './context.ts';
import { HttpError, badRequest, notFound } from './errors.ts';
import { atomicWrite, backup, createExclusive, rev, walkFiles } from './fsutil.ts';
import { resolveSafe } from './paths.ts';
import { treeKey } from './fileops.ts';
import { libraryId } from './libraryIdentity.ts';
import { UUID } from './libraryModel.ts';
import { listResources, readResourceFile } from './resources.ts';
import { instanceId } from './settings.ts';
import { bibReferences, buildRefs, cleanTex, citasFromBib } from './refs.ts';
import { stripComment } from './outline.ts';
import { citeKey, sourceHash, texEscape } from './bibliography.ts';
import { renderLibraryReference, type ExportedReference } from './libraryBibliography.ts';

export const LIBRARY_BIB = 'biblioteca/referencias.bib';
export const LIBRARY_MANIFEST = 'biblioteca/estado.json';
const FIGURES = 'figuras/biblioteca/';
interface Reference extends ExportedReference {
  id: string;
  libraryId: string;
  key: string;
  fingerprint: string;
  authority: 'library' | 'manual';
  manualPath?: string;
}
interface Figure {
  id: string;
  libraryId: string;
  path: string;
  hash: string;
  sourcePath: string;
  title: string;
  credit: string;
  label: string;
}
interface Manifest {
  version: 1;
  references: Reference[];
  figures: Figure[];
  bibRev: string | null;
}
interface Write {
  path: string;
  baseRev: string | null;
  afterRev: string;
  text?: string;
  stage?: string;
}
interface Integration {
  version: 1;
  operationId: string;
  libraryId: string;
  instanceId: string;
  fingerprint: string;
  state: 'prepared' | 'done';
  resourceId: string;
  resourcePath: string;
  resourceRev: string;
  writes: Write[];
  result: {
    snippet: string;
    key?: string;
    figurePath?: string;
    mainEdit?: { path: string; baseRev: string; before: string; after: string };
  };
  preview: { path: string; baseRev: string | null; before?: string; after?: string }[];
  warnings: string[];
}
const operationDir = (ctx: Ctx, id: string) => {
  if (!UUID.test(id)) throw badRequest('ID de integración no válido');
  return path.join(path.dirname(ctx.cfg.buildDir), 'library', libraryId(ctx.cfg), 'integrations', id);
};
const fingerprint = (title: string, bibliography: unknown) => rev(JSON.stringify({ title, bibliography }));
async function readMemory(ctx: Ctx, rel: string, max = 20 * 1024 * 1024) {
  const r = await resolveSafe(ctx.cfg, 'memoria', rel);
  if (!r.exists) return { r, bytes: null, revision: null };
  const st = await fs.stat(r.abs);
  if (!st.isFile() || st.size > max) throw badRequest('Archivo de memoria no válido o demasiado grande');
  const bytes = await fs.readFile(r.abs);
  return { r, bytes, revision: rev(bytes) };
}
async function manifest(ctx: Ctx) {
  const file = await readMemory(ctx, LIBRARY_MANIFEST);
  let value: Manifest = { version: 1, references: [], figures: [], bibRev: null };
  if (file.bytes)
    try {
      value = JSON.parse(file.bytes.toString('utf8'));
      if (
        value.version !== 1 ||
        !Array.isArray(value.references) ||
        !Array.isArray(value.figures) ||
        value.references.some(
          (r) => !UUID.test(r.id) || !citeKey.test(r.key) || !['library', 'manual'].includes(r.authority) || typeof r.body !== 'string',
        ) ||
        value.figures.some((f) => !UUID.test(f.id) || !f.path.startsWith(FIGURES) || !/^[a-f0-9]{64}$/.test(f.hash))
      )
        throw new Error();
    } catch {
      throw new HttpError(
        409,
        'El registro de Biblioteca de la memoria es desconocido o está dañado; conserva una copia antes de repararlo',
      );
    }
  return { file, value };
}
export function addBibResource(text: string, resource: string) {
  if (bibReferences(text).some((p) => p.replace(/^\.\//, '') === resource)) return text;
  const lines = text.split(/\r?\n/),
    index = lines.findIndex((l) => /\\begin\s*\{document\}/.test(stripComment(l)));
  if (index < 0)
    throw badRequest('No se encontró el inicio del documento; añade el recurso bibliográfico en el preámbulo y vuelve a revisar');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  lines.splice(index, 0, `\\addbibresource{${resource}} % Biblioteca de Estudio TFG`);
  return lines.join(eol);
}
function generatedBib(refs: Reference[]) {
  const support: Record<string, string> = {},
    auxiliary: Record<string, string> = {};
  for (const r of refs.filter((r) => r.authority === 'library')) {
    Object.assign(support, r.support);
    Object.assign(auxiliary, r.auxiliary);
  }
  return (
    '% Salida gestionada por Estudio TFG. Edita las fichas de Biblioteca y actualiza explícitamente.\n' +
    Object.values(support).join('\n') +
    '\n' +
    Object.values(auxiliary).join('\n') +
    '\n' +
    refs
      .filter((r) => r.authority === 'library')
      .map((r) => r.body)
      .join('\n\n') +
    '\n'
  );
}
async function resource(ctx: Ctx, id: string) {
  if (!UUID.test(id)) throw badRequest('Identidad de recurso no válida');
  const matches = (await listResources(ctx.cfg)).items.filter((r) => r.id === id);
  if (matches.length !== 1 || matches[0].libraryError)
    throw new HttpError(409, 'La ficha no existe, necesita migración o tiene una identidad duplicada');
  return readResourceFile(ctx.cfg, matches[0].path);
}
const view = (op: Integration) => ({
  operationId: op.operationId,
  libraryId: op.libraryId,
  instanceId: op.instanceId,
  state: op.state,
  result: op.result,
  files: op.preview,
  warnings: op.warnings,
});
async function readOperation(ctx: Ctx, id: string): Promise<Integration> {
  const file = path.join(operationDir(ctx, id), 'operation.json');
  try {
    const st = await fs.stat(file);
    if (st.size > 20 * 1024 * 1024) throw badRequest('Registro de integración demasiado grande');
    const op = JSON.parse(await fs.readFile(file, 'utf8')) as Integration;
    if (
      op.version !== 1 ||
      op.operationId !== id ||
      !['prepared', 'done'].includes(op.state) ||
      !Array.isArray(op.writes) ||
      op.writes.length > 4 ||
      !UUID.test(op.resourceId) ||
      op.writes.some(
        (w) =>
          !w ||
          typeof w.path !== 'string' ||
          (w.path !== ctx.cfg.memoriaMain && w.path !== LIBRARY_BIB && w.path !== LIBRARY_MANIFEST && !w.path.startsWith(FIGURES)) ||
          (w.stage !== undefined && w.stage !== 'asset') ||
          (w.baseRev !== null && (typeof w.baseRev !== 'string' || !/^[a-f0-9]{16}$/.test(w.baseRev))) ||
          typeof w.afterRev !== 'string' ||
          !/^[a-f0-9]{16}$/.test(w.afterRev) ||
          (typeof w.text === 'string') === (w.stage === 'asset') ||
          (w.text !== undefined && rev(w.text) !== w.afterRev),
      )
    )
      throw badRequest('Registro de integración no válido');
    return op;
  } catch (e: any) {
    if (e.code === 'ENOENT') throw notFound('Vista previa no encontrada; prepárala de nuevo');
    throw e;
  }
}
export async function integrationPreview(ctx: Ctx, input: any) {
  if (input?.libraryId !== libraryId(ctx.cfg) || input?.instanceId !== instanceId(ctx.cfg))
    throw new HttpError(409, 'La Biblioteca o la memoria de destino cambió');
  if (!UUID.test(input.operationId) || !['reference', 'figure'].includes(input.kind)) throw badRequest('Integración no válida');
  const inputHash = sourceHash(JSON.stringify(input)),
    dir = operationDir(ctx, input.operationId);
  try {
    const existing = await readOperation(ctx, input.operationId);
    if (existing.fingerprint !== inputHash) throw new HttpError(409, 'La operación ya tiene otra vista previa');
    return view(existing);
  } catch (e) {
    if (!(e instanceof HttpError && e.statusCode === 404)) throw e;
  }
  return ctx.locks.run(treeKey('memoria'), async () => {
    const file = await resource(ctx, input.resourceId);
    if (file.rev !== input.baseRev) throw new HttpError(409, 'La ficha cambió; recárgala antes de preparar la integración');
    const stored = await manifest(ctx),
      next: Manifest = structuredClone(stored.value),
      writes: Write[] = [],
      preview: Integration['preview'] = [],
      warnings: string[] = [];
    const result: Integration['result'] = { snippet: '' };
    const addText = async (rel: string, text: string) => {
      const f = await readMemory(ctx, rel);
      writes.push({ path: rel, baseRev: f.revision, afterRev: rev(text), text });
      preview.push({ path: rel, baseRev: f.revision, before: f.bytes?.toString('utf8') ?? '', after: text });
      return f;
    };
    let asset: Buffer | undefined, bibPath: string | undefined;
    if (input.kind === 'reference') {
      const bib = file.item.bibliography;
      if (!bib) throw badRequest('Completa o importa los datos bibliográficos antes de citar');
      const previous = next.references.find((r) => r.id === file.item.id && r.libraryId === input.libraryId);
      if (previous && previous.authority !== bib.authority)
        throw new HttpError(
          409,
          'Esta memoria ya usa otra autoridad bibliográfica para la ficha; conserva su vínculo o crea una ficha independiente',
        );
      let key = previous?.key ?? bib.key;
      if (bib.authority === 'manual') {
        if (!citeKey.test(bib.key) || /[{}%#\r\n]/.test(bib.path))
          throw badRequest('La clave o el nombre del .bib manual no son seguros para LaTeX');
        if (previous && previous.key !== bib.key)
          throw new HttpError(409, 'La memoria ya utiliza la clave anterior; no se cambian sus citas silenciosamente');
        const manual = await readMemory(ctx, bib.path);
        if (!manual.bytes || !citasFromBib(manual.bytes.toString('utf8'), bib.path).some((c) => c.key === bib.key))
          throw badRequest('La clave no se encontró en el .bib manual; corrige el vínculo');
        key = bib.key;
        bibPath = bib.path;
        next.references = next.references.filter((r) => !(r.id === file.item.id && r.libraryId === input.libraryId));
        next.references.push({
          id: file.item.id!,
          libraryId: input.libraryId,
          key,
          fingerprint: fingerprint(file.item.title, bib),
          authority: 'manual',
          manualPath: bib.path,
          body: '',
          support: {},
          auxiliary: {},
        });
      } else {
        if (!key || !citeKey.test(key)) key = `ref${file.item.id!.replace(/-/g, '')}`;
        const keys = new Set((await buildRefs(ctx.cfg)).citas.map((c) => c.key));
        const manualKeys = new Set<string>();
        for (const f of (await walkFiles(ctx.cfg, 'memoria')).filter((f) => f.rel.endsWith('.bib') && f.rel !== LIBRARY_BIB)) {
          const data = await readMemory(ctx, f.rel);
          if (data.bytes)
            for (const c of citasFromBib(data.bytes.toString('utf8'), f.rel)) {
              keys.add(c.key);
              manualKeys.add(c.key);
            }
        }
        if (previous && manualKeys.has(key))
          throw new HttpError(
            409,
            'La clave utilizada ahora también aparece en un .bib manual; resuelve la colisión sin cambiar las citas existentes',
          );
        for (const r of next.references) keys.add(r.key);
        if (!previous) {
          const stem = key;
          let n = 2;
          while (keys.has(key)) key = `${stem}-${n++}`;
        }
        const rendered = await renderLibraryReference(ctx, file.item, key);
        next.references = next.references.filter((r) => !(r.id === file.item.id && r.libraryId === input.libraryId));
        next.references.push({
          id: file.item.id!,
          libraryId: input.libraryId,
          key,
          fingerprint: fingerprint(file.item.title, bib),
          authority: 'library',
          ...rendered,
        });
        const current = await readMemory(ctx, LIBRARY_BIB);
        if (current.bytes && !stored.file.bytes)
          throw new HttpError(409, 'Ya existe un .bib ajeno en la ruta gestionada; no se sobrescribió');
        if (current.bytes && stored.value.bibRev !== current.revision)
          warnings.push(
            'La salida .bib fue modificada fuera de Biblioteca; revisa la diferencia antes de regenerarla. Su versión anterior queda en el historial.',
          );
        const text = generatedBib(next.references);
        next.bibRev = rev(text);
        await addText(LIBRARY_BIB, text);
        bibPath = LIBRARY_BIB;
      }
      result.key = key;
      result.snippet = `\\cite{${key}}`;
    } else {
      if (
        typeof input.attachmentPath !== 'string' ||
        typeof input.caption !== 'string' ||
        typeof input.credit !== 'string' ||
        input.caption.length > 1000 ||
        input.credit.length > 2000 ||
        typeof input.label !== 'string' ||
        !/^fig:[A-Za-z0-9_:.-]{1,150}$/.test(input.label) ||
        !Number.isFinite(input.width) ||
        input.width < 5 ||
        input.width > 100
      )
        throw badRequest('Indica imagen, pie, etiqueta y ancho válidos');
      const attachment = file.attachments.find((a) => a.path === input.attachmentPath);
      if (!attachment?.path) throw badRequest('El adjunto no pertenece a esta ficha o no se puede resolver');
      const source = await resolveSafe(ctx.cfg, 'notes', attachment.path),
        st = await fs.stat(source.abs),
        ext = path.extname(source.rel).toLowerCase();
      if (!st.isFile() || st.size > 50 * 1024 * 1024) throw badRequest('La imagen supera 50 MiB o no es un archivo');
      asset = await fs.readFile(source.abs);
      const valid =
        ext === '.pdf'
          ? asset.subarray(0, 5).toString() === '%PDF-'
          : ['.jpg', '.jpeg'].includes(ext)
            ? asset[0] === 255 && asset[1] === 216
            : ext === '.png'
              ? asset.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : false;
      if (!valid) throw new HttpError(415, 'Usa una imagen PNG, JPG o PDF válido. Convierte SVG, WebP, GIF o EPS antes de insertarlos.');
      const hash = sourceHash(asset);
      let target = `${FIGURES}${file.item.id}-${hash.slice(0, 16)}${ext}`;
      let previous: Figure | undefined;
      if (input.replaceCopy !== undefined) {
        previous = next.figures.find((f) => f.id === file.item.id && f.libraryId === input.libraryId && f.path === input.replaceCopy);
        if (!previous || path.extname(previous.path).toLowerCase() !== ext)
          throw badRequest('Solo se actualizan copias registradas del mismo formato; para otro formato inserta una figura nueva');
        target = previous.path;
      }
      const before = await readMemory(ctx, target, 50 * 1024 * 1024);
      if (before.bytes && !input.replaceCopy && rev(before.bytes) !== rev(asset))
        throw new HttpError(409, 'La copia existente tiene otros bytes; revisa antes de sustituirla');
      if (before.bytes && input.replaceCopy && next.figures.find((f) => f.path === target)?.hash !== sourceHash(before.bytes))
        warnings.push(
          'La copia de imagen fue modificada fuera de Biblioteca. Revisa antes de sustituirla; conservaremos sus bytes anteriores en el historial.',
        );
      writes.push({ path: target, baseRev: before.revision, afterRev: rev(asset), stage: 'asset' });
      preview.push({ path: target, baseRev: before.revision });
      next.figures = next.figures.filter((f) => !(f.path === target && f.libraryId === input.libraryId));
      next.figures.push(
        previous
          ? { ...previous, hash, sourcePath: attachment.path }
          : {
              id: file.item.id!,
              libraryId: input.libraryId,
              path: target,
              hash,
              sourcePath: attachment.path,
              title: file.item.title,
              credit: input.credit,
              label: input.label,
            },
      );
      const width = input.width === 100 ? '\\textwidth' : `${input.width / 100}\\textwidth`,
        caption = input.caption + (input.credit ? ` Fuente: ${input.credit}` : '');
      result.figurePath = target;
      result.snippet = previous
        ? ''
        : [
            `% et:biblioteca-figura ${input.libraryId}/${file.item.id}`,
            '\\begin{figure}[htbp]',
            '  \\centering',
            `  \\includegraphics[width=${width}]{${target}}`,
            `  \\caption{${texEscape(caption)}}`,
            `  \\label{${input.label}}`,
            '\\end{figure}',
          ].join('\n');
    }
    if (bibPath) {
      const main = await readMemory(ctx, ctx.cfg.memoriaMain);
      if (!main.bytes) throw badRequest('No existe el documento principal de la memoria');
      const draft = input.mainDraft;
      if (
        draft !== undefined &&
        (typeof draft.content !== 'string' || draft.baseRev !== main.revision || Buffer.byteLength(draft.content) > 5 * 1024 * 1024)
      )
        throw new HttpError(409, 'El principal cambió; conserva su borrador y revisa antes de integrar bibliografía');
      const before = draft?.content ?? main.bytes.toString('utf8'),
        after = addBibResource(before, bibPath);
      if (after !== before) {
        if (draft) result.mainEdit = { path: ctx.cfg.memoriaMain, baseRev: main.revision!, before, after };
        else await addText(ctx.cfg.memoriaMain, after);
      }
    }
    await addText(LIBRARY_MANIFEST, JSON.stringify(next, null, 2) + '\n');
    const op: Integration = {
      version: 1,
      operationId: input.operationId,
      libraryId: input.libraryId,
      instanceId: input.instanceId,
      fingerprint: inputHash,
      state: 'prepared',
      resourceId: file.item.id!,
      resourcePath: file.path,
      resourceRev: file.rev,
      writes,
      result,
      preview,
      warnings,
    };
    if (Buffer.byteLength(JSON.stringify(op)) > 20 * 1024 * 1024)
      throw new HttpError(413, 'La integración supera 20 MiB de metadatos; reduce el lote o el tamaño de los campos');
    await fs.mkdir(dir, { recursive: true });
    if (asset && !(await createExclusive(path.join(dir, 'asset'), asset)))
      throw new HttpError(409, 'Ya existe el archivo temporal de esta operación; conserva su registro');
    if (!(await createExclusive(path.join(dir, 'operation.json'), JSON.stringify(op) + '\n')))
      throw new HttpError(409, 'La operación ya existe; recarga su vista previa');
    return view(op);
  });
}
export async function integrationApply(ctx: Ctx, input: any) {
  if (input?.libraryId !== libraryId(ctx.cfg) || input?.instanceId !== instanceId(ctx.cfg))
    throw new HttpError(409, 'La memoria o la Biblioteca de destino cambió');
  const op = await readOperation(ctx, input.operationId);
  if (op.instanceId !== input.instanceId || op.libraryId !== input.libraryId)
    throw new HttpError(409, 'Esta operación pertenece a otro destino');
  if (op.state === 'done') return view(op);
  if (
    !Array.isArray(input.revisions) ||
    JSON.stringify(input.revisions) !== JSON.stringify(op.writes.map((w) => ({ path: w.path, baseRev: w.baseRev })))
  )
    throw badRequest('Debes aplicar las revisiones de todos los archivos de la vista previa');
  return ctx.locks.run(treeKey('memoria'), async () => {
    const keys = [...op.writes.map((w) => `memoria:${w.path}`), `notes:${op.resourcePath}`].sort();
    const locked = async (index: number): Promise<ReturnType<typeof view>> =>
      index < keys.length ? ctx.locks.run(keys[index], () => locked(index + 1)) : run();
    const run = async () => {
      const current = await resource(ctx, op.resourceId);
      if (current.rev !== op.resourceRev || current.path !== op.resourcePath)
        throw new HttpError(409, 'La ficha cambió desde la vista previa; el registro de integración se conserva');
      for (const w of op.writes) {
        const f = await readMemory(ctx, w.path, w.stage ? 50 * 1024 * 1024 : 20 * 1024 * 1024);
        if (f.revision !== w.baseRev && f.revision !== w.afterRev)
          throw new HttpError(409, `Cambió ${w.path}; no se sobrescribió y la operación queda pendiente`);
      }
      for (const w of op.writes) {
        const f = await readMemory(ctx, w.path, w.stage ? 50 * 1024 * 1024 : 20 * 1024 * 1024);
        if (f.revision === w.afterRev) continue;
        if (f.revision !== w.baseRev) throw new HttpError(409, `Cambió ${w.path} durante la integración`);
        const bytes = w.stage ? await fs.readFile(path.join(operationDir(ctx, op.operationId), w.stage)) : Buffer.from(w.text!);
        if (rev(bytes) !== w.afterRev) throw new HttpError(409, 'El archivo temporal cambió; conserva el registro antes de repararlo');
        await fs.mkdir(path.dirname(f.r.abs), { recursive: true });
        await resolveSafe(ctx.cfg, 'memoria', w.path);
        if (f.bytes) {
          await backup(ctx.cfg, 'memoria', w.path, f.bytes);
          await atomicWrite(f.r.abs, bytes);
        } else if (!(await createExclusive(f.r.abs, bytes))) throw new HttpError(409, 'El destino fue ocupado; conserva la operación');
        ctx.bus.change({ root: 'memoria', path: w.path, kind: 'change' });
      }
      op.state = 'done';
      await atomicWrite(path.join(operationDir(ctx, op.operationId), 'operation.json'), JSON.stringify(op) + '\n');
      await fs.rm(path.join(operationDir(ctx, op.operationId), 'asset'), { force: true });
      return view(op);
    };
    return locked(0);
  });
}
export async function integrationOperation(ctx: Ctx, id: string) {
  return view(await readOperation(ctx, id));
}
export async function libraryUses(ctx: Ctx, id?: string, notesPath?: string) {
  try {
    await fs.realpath(ctx.cfg.memoriaDir);
  } catch (e: any) {
    if (e.code === 'ENOENT') return { available: false, uses: [], references: [], figures: [] };
    throw e;
  }
  const stored = (await manifest(ctx)).value,
    lib = libraryId(ctx.cfg),
    resources = (await listResources(ctx.cfg)).items;
  const ids = id
    ? [id]
    : resources.filter((r) => r.id && (!notesPath || r.path === notesPath || r.path.startsWith(notesPath + '/'))).map((r) => r.id!);
  if (ids.some((id) => !UUID.test(id))) throw badRequest('Identidad de recurso no válida');
  const references = stored.references.filter((r) => r.libraryId === lib && ids.includes(r.id)),
    figures = stored.figures.filter((f) => f.libraryId === lib && ids.includes(f.id));
  const uses: { id: string; kind: 'citation' | 'figure'; file: string; line: number; key?: string; path?: string }[] = [];
  for (const f of (await walkFiles(ctx.cfg, 'memoria')).filter((f) => f.rel.endsWith('.tex'))) {
    const st = await fs.stat(f.abs);
    if (st.size > 5 * 1024 * 1024) continue;
    const raw = await fs.readFile(f.abs, 'utf8'),
      lines = raw.split(/\r?\n/);
    let literal = false,
      marker: string | undefined;
    for (const [index, line] of lines.entries()) {
      if (/\\begin\{(?:verbatim\*?|Verbatim|lstlisting|minted|comment)\}/.test(stripComment(line))) literal = true;
      if (literal) {
        if (/\\end\{(?:verbatim\*?|Verbatim|lstlisting|minted|comment)\}/.test(stripComment(line))) literal = false;
        continue;
      }
      const mark = /%\s*et:biblioteca-figura ([a-f0-9]{32})\/([a-f0-9-]{36})/i.exec(line);
      if (mark) marker = mark[1] === lib ? mark[2] : undefined;
      const text = stripComment(line);
      const cite =
        /\\(?:[A-Za-z]*cite|citeauthor|citeyear|citeyearpar|citep|citet|citealp|bibentry)\*?(?![A-Za-z])\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]+)\}/g;
      for (const match of text.matchAll(cite))
        for (const r of references)
          if (
            match[1]
              .split(',')
              .map((k) => k.trim())
              .some((k) => k === r.key || k === '*')
          )
            uses.push({ id: r.id, kind: 'citation', file: f.rel, line: index + 1, key: r.key });
      const image = /\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/.exec(text);
      if (image)
        for (const r of figures) {
          const name = image[1].replace(/^\.\//, ''),
            stem = r.path.replace(/\.[^.]+$/, '');
          if (marker === r.id || [r.path, stem, r.path.slice('figuras/'.length), stem.slice('figuras/'.length)].includes(name))
            uses.push({ id: r.id, kind: 'figure', file: f.rel, line: index + 1, path: name });
        }
      if (/\\end\{figure\*?\}/.test(text)) marker = undefined;
    }
  }
  return {
    uses,
    references: references.map((r) => ({
      id: r.id,
      key: r.key,
      authority: r.authority,
      outdated:
        r.fingerprint !==
        fingerprint(resources.find((x) => x.id === r.id)?.title ?? '', resources.find((x) => x.id === r.id)?.bibliography),
    })),
    figures,
  };
}
