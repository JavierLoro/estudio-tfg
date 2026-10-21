import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Ctx } from './context.ts';
import { badRequest, HttpError } from './errors.ts';
import { resolveSafe, isInside, type RootName } from './paths.ts';
import { rev } from './fsutil.ts';
import { search } from './search.ts';
import { listResources, readResourceFile } from './resources.ts';

export interface AssistantScope {
  memoria: boolean; library: boolean; notes: string[];
  diagrams?: boolean; attachments?: boolean; prepareChanges?: boolean;
  documents?: { root: RootName; path: string }[];
}
export interface AssistantSource { id: string; root: RootName; path: string; title: string; rev?: string }
export const sourceId = (root: RootName, rel: string) => crypto.createHash('sha256').update(root + ':' + rel).digest('hex').slice(0, 24);
const under = (root: string, rel: string) => !root || root === rel || rel.startsWith(root + '/');

export async function validateScope(ctx: Ctx, value: any): Promise<AssistantScope> {
  if (!value || typeof value.memoria !== 'boolean' || typeof value.library !== 'boolean' || !Array.isArray(value.notes) || value.notes.length > 30) throw badRequest('Elige el alcance de la conversación');
  for (const key of ['diagrams', 'attachments', 'prepareChanges']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw badRequest('Permiso del asistente no válido');
  if (Object.keys(value).some(key => !['memoria', 'library', 'notes', 'diagrams', 'attachments', 'prepareChanges', 'documents'].includes(key))) throw badRequest('Permiso del asistente no disponible');
  const notes: string[] = [];
  for (const dir of value.notes) {
    if (typeof dir !== 'string') throw badRequest('Carpeta de notas no válida');
    if (dir === '') { notes.push(''); continue; }
    const file = await resolveSafe(ctx.cfg, 'notes', dir);
    if (!file.exists || !(await fs.stat(file.abs)).isDirectory()) throw badRequest('La carpeta de notas no existe');
    notes.push(file.rel);
  }
  const documents: NonNullable<AssistantScope['documents']> = [];
  if (value.documents !== undefined && (!Array.isArray(value.documents) || value.documents.length > 30)) throw badRequest('Elige como máximo 30 documentos');
  for (const item of value.documents ?? []) {
    if (!['memoria', 'notes'].includes(item?.root) || typeof item.path !== 'string') throw badRequest('Documento no válido');
    const file = await resolveSafe(ctx.cfg, item.root, item.path);
    const base = await fs.realpath(item.root === 'notes' ? ctx.cfg.notesDir : ctx.cfg.memoriaDir);
    const actual = path.relative(base, file.abs).split(path.sep).join('/');
    if (!file.exists || !(await fs.stat(file.abs)).isFile() || actual !== file.rel || file.rel.split('/').some(p => p.startsWith('.'))) throw badRequest('Elige un archivo existente y sin enlaces simbólicos');
    if (!['.tex', '.md', '.bib', '.txt', '.mmd', '.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(file.rel).toLowerCase())) throw badRequest('Tipo de documento no compatible');
    if (!documents.some(d => d.root === item.root && d.path === file.rel)) documents.push({ root: item.root, path: file.rel });
  }
  return { memoria: value.memoria, library: value.library, notes: [...new Set(notes)], documents,
    diagrams: value.diagrams === true, attachments: value.attachments === true, prepareChanges: value.prepareChanges === true };
}

export function permitted(ctx: Ctx, scope: AssistantScope, root: RootName, rel: string) {
  if (rel.split('/').some(p => p.startsWith('.'))) return false;
  if (scope.documents?.some(d => d.root === root && d.path === rel)) return true;
  if (root === 'memoria' && /\.mmd$/i.test(rel)) return scope.diagrams === true;
  if (root === 'memoria') return scope.memoria;
  const resource = under(ctx.cfg.resourcesSubdir.replaceAll('\\', '/'), rel);
  return resource ? scope.library : scope.notes.some(dir => under(dir, rel));
}

export async function findSources(ctx: Ctx, scope: AssistantScope, query: unknown): Promise<(AssistantSource & { snippet?: string })[]> {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) throw badRequest('Búsqueda no válida');
  const items = await search(ctx.cfg, query, ['notes', ...(scope.memoria || scope.diagrams || scope.documents?.some(d => d.root === 'memoria') ? ['memoria' as const] : [])], undefined, async (root, rel) => {
    try { await resolveSource(ctx, scope, { root, path: rel }); return true; } catch { return false; }
  });
  const results: (AssistantSource & { snippet?: string })[] = [];
  for (const item of items) {
    if (!permitted(ctx, scope, item.root, item.path) || results.some(r => r.root === item.root && r.path === item.path)) continue;
    results.push({ id: sourceId(item.root, item.path), root: item.root, path: item.path, title: path.posix.basename(item.path), snippet: item.snippet });
    if (results.length === 20) break;
  }
  if (scope.library && results.length < 20) {
    const resources = (await listResources(ctx.cfg)).items;
    for (const item of resources) {
      if (!JSON.stringify(item).toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')) || results.some(r => r.path === item.path && r.root === 'notes')) continue;
      try { await resolveSource(ctx, scope, { root: 'notes', path: item.path }); } catch { continue; }
      results.push({ id: sourceId('notes', item.path), root: 'notes', path: item.path, title: item.title });
      if (results.length === 20) break;
    }
  }
  return results;
}

async function resolveSource(ctx: Ctx, scope: AssistantScope, source: Pick<AssistantSource, 'root' | 'path'>) {
  if (!permitted(ctx, scope, source.root, source.path)) throw new HttpError(403, 'Fuente fuera del alcance autorizado');
  const file = await resolveSafe(ctx.cfg, source.root, source.path);
  const base = await fs.realpath(source.root === 'notes' ? ctx.cfg.notesDir : ctx.cfg.memoriaDir);
  const actual = path.relative(base, file.abs).split(path.sep).join('/');
  if (!isInside(base, file.abs) || !permitted(ctx, scope, source.root, actual)) throw new HttpError(403, 'El enlace sale del alcance autorizado');
  return { ...file, actual };
}

export async function readSource(ctx: Ctx, scope: AssistantScope, source: AssistantSource, binary = false) {
  if (binary && scope.attachments !== true) throw new HttpError(403, 'Autoriza la consulta de PDF e imágenes por separado');
  const file = await resolveSource(ctx, scope, source);
  const st = await fs.stat(file.abs);
  if (!st.isFile() || st.size > (binary ? 20 : 2) * 1024 * 1024) throw badRequest('La fuente no es un archivo válido o supera el límite');
  const bytes = await fs.readFile(file.abs);
  if (bytes.length > (binary ? 20 : 2) * 1024 * 1024) throw badRequest('La fuente supera el límite');
  const version = rev(bytes), ext = path.extname(file.rel).toLowerCase();
  if (!binary) {
    if (!['.tex', '.md', '.bib', '.txt', '.mmd'].includes(ext)) throw badRequest('Consulta este documento como adjunto');
    return { version, text: bytes.toString('utf8'), bytes, mime: 'text/plain', actual: file.actual };
  }
  const mime = ext === '.pdf' && bytes.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
    : ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : ['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg'
    : ext === '.webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : '';
  if (!mime) throw badRequest('Usa un PDF, PNG, JPEG o WebP válido');
  return { version, text: '', bytes, mime, actual: file.actual };
}

export async function attachmentSources(ctx: Ctx, scope: AssistantScope, source: AssistantSource) {
  if (source.root !== 'notes' || !scope.attachments || !under(ctx.cfg.resourcesSubdir.replaceAll('\\', '/'), source.path)) return [];
  if (!permitted(ctx, scope, source.root, source.path)) return [];
  const file = await readResourceFile(ctx.cfg, source.path);
  return file.attachments.filter(a => a.path && permitted(ctx, scope, 'notes', a.path)).map(a => ({ id: sourceId('notes', a.path!), root: 'notes' as const, path: a.path!, title: path.posix.basename(a.path!) }));
}

export function canEdit(ctx: Ctx, scope: AssistantScope, source: AssistantSource) {
  if (scope.prepareChanges !== true) return false;
  if (!permitted(ctx, scope, source.root, source.path)) return false;
  const ext = path.extname(source.path).toLowerCase();
  if (source.root === 'notes') return ext === '.md' && !under(ctx.cfg.resourcesSubdir.replaceAll('\\', '/'), source.path);
  return ['.tex', '.bib'].includes(ext) && !['estilo', 'biblioteca', 'figuras'].some(dir => under(dir, source.path));
}
