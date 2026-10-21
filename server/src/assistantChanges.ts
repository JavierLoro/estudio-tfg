import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Ctx } from './context.ts';
import { badRequest, HttpError } from './errors.ts';
import { atomicWrite, backup, rev } from './fsutil.ts';
import { resolveSafe } from './paths.ts';
import { treeKey } from './fileops.ts';
import { instanceId } from './settings.ts';
import { canEdit, readSource, type AssistantScope, type AssistantSource } from './assistantFiles.ts';
import { buildRefs, citasFromBib } from './refs.ts';

export interface AssistantChange { source: AssistantSource; before: string; after: string; baseRev: string; afterRev: string; applied: boolean }
export interface AssistantProposal { id: string; thread: string; account: string; instance: string; state: 'prepared' | 'applying' | 'done' | 'undoing' | 'undone'; files: AssistantChange[]; error?: string }
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export async function privateJson(file: string, value: unknown) {
  const serialized = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(serialized) > 40 * 1024 * 1024) throw new HttpError(413, 'El registro del asistente supera 40 MiB. Inicia una conversación nueva.');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await atomicWrite(file, serialized); await fs.chmod(file, 0o600);
}
export async function readPrivate(file: string, max = 40 * 1024 * 1024): Promise<any> {
  if ((await fs.stat(file)).size > max) throw badRequest('Registro del asistente demasiado grande');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function prepareChanges(ctx: Ctx, scope: AssistantScope, sources: AssistantSource[], input: any, owner: { thread: string; account: string; instance: string }, dirty: string[]) {
  if (scope.prepareChanges !== true) throw new HttpError(403, 'Autoriza preparar cambios antes de solicitar una propuesta');
  if (!Array.isArray(input?.files) || !input.files.length || input.files.length > 20) throw badRequest('Una propuesta necesita entre 1 y 20 archivos');
  const files: AssistantChange[] = [];
  const needsRefs = input.files.some((item: any) => sources.some(s => s.id === item.id && s.root === 'memoria' && s.path.endsWith('.tex')));
  const refs = new Set(needsRefs ? (await buildRefs(ctx.cfg)).citas.map(c => c.key) : []);
  for (const item of input.files) {
    const source = sources.find(s => s.id === item.id);
    if (!source?.rev || !canEdit(ctx, scope, source) || typeof item.after !== 'string' || item.after.length > 100_000) throw badRequest('Solo se pueden modificar textos existentes y consultados, dentro del alcance');
    if (files.some(f => f.source.id === source.id)) throw badRequest('Archivo repetido en la propuesta');
    if (dirty.includes(`${source.root}:${source.path}`)) throw new HttpError(409, `Guarda el borrador de ${source.path} antes de preparar cambios`);
    const current = await readSource(ctx, scope, source);
    if (current.actual !== source.path) throw badRequest('Edita el archivo original, sin enlaces simbólicos');
    if (current.version !== source.rev) throw new HttpError(409, `Cambió ${source.path}; vuelve a consultarlo`);
    if (source.path.endsWith('.bib')) {
      const original = new Set(citasFromBib(current.text, source.path).map(c => c.key));
      const proposed = citasFromBib(item.after, source.path);
      if (!proposed.length && item.after.trim()) throw badRequest('Bibliografía propuesta no válida');
      if (proposed.some(c => !original.has(c.key))) throw badRequest('Añade las referencias nuevas mediante Biblioteca antes de citarlas');
    }
    if (source.path.endsWith('.tex')) {
      const citations = /\\(?:[A-Za-z]*cite[A-Za-z]*)\*?(?:\[[^\]]*\])*\{([^}]+)\}/g;
      const previous = new Set([...current.text.matchAll(citations)].flatMap(match => match[1].split(',').map(key => key.trim())));
      for (const match of item.after.matchAll(citations))
        if (match[1].split(',').some((key: string) => key.trim() !== '*' && !refs.has(key.trim()) && !previous.has(key.trim()))) throw badRequest('La propuesta contiene una clave bibliográfica que no existe');
    }
    files.push({ source, before: current.text, after: item.after, baseRev: current.version, afterRev: rev(item.after), applied: false });
  }
  return { id: crypto.randomUUID(), ...owner, state: 'prepared', files } satisfies AssistantProposal;
}

export async function applyChanges(ctx: Ctx, scope: AssistantScope, op: AssistantProposal, save: () => Promise<void>, selected: unknown, undo = false, guard = () => {}) {
  guard();
  if (!undo && scope.prepareChanges !== true) throw new HttpError(403, 'Esta conversación no tiene permiso para preparar cambios');
  if (op.instance !== instanceId(ctx.cfg)) throw new HttpError(409, 'El proyecto de la propuesta cambió');
  if (op.state === (undo ? 'undone' : 'done')) return op;
  if (undo ? !['done', 'applying', 'undoing'].includes(op.state) : !['prepared', 'applying'].includes(op.state)) throw new HttpError(409, 'La operación no admite esta acción');
  if (op.state === 'prepared') {
    if (!Array.isArray(selected) || !selected.length || selected.some(id => typeof id !== 'string' || !op.files.some(f => f.source.id === id)) || new Set(selected).size !== selected.length) throw badRequest('Selecciona los archivos revisados');
  }
  const files = op.state === 'prepared' ? op.files.filter(f => (selected as string[]).includes(f.source.id)) : op.files;
  const keys = [...new Set(files.map(f => treeKey(f.source.root)))].sort().concat([...new Set(files.map(f => `${f.source.root}:${f.source.path}`))].sort());
  const locked = async (i: number): Promise<AssistantProposal> => i < keys.length ? ctx.locks.run(keys[i], () => locked(i + 1)) : run();
  const run = async () => {
    guard();
    if (op.state === (undo ? 'undone' : 'done')) return op;
    for (const f of files) {
      // Deshacer conserva la recuperación de cambios aplicados antes de separar los permisos.
      if (!canEdit(ctx, undo ? { ...scope, prepareChanges: true } : scope, f.source) || rev(f.before) !== f.baseRev || rev(f.after) !== f.afterRev) throw badRequest('Propuesta no válida');
      const current = await readSource(ctx, scope, f.source);
      if (current.actual !== f.source.path) throw badRequest('El destino de la propuesta cambió a un enlace simbólico');
      if (![f.baseRev, f.afterRev].includes(current.version) || (op.state === 'prepared' && current.version !== f.baseRev)) throw new HttpError(409, `Cambió ${f.source.path}; no se sobrescribió`);
    }
    op.files = files; op.state = undo ? 'undoing' : 'applying'; delete op.error; await save();
    try {
      for (const f of files) {
        guard();
        const current = await readSource(ctx, scope, f.source);
        if (current.actual !== f.source.path) throw badRequest('El destino de la propuesta cambió a un enlace simbólico');
        const target = undo ? f.before : f.after, targetRev = undo ? f.baseRev : f.afterRev;
        if (current.version !== targetRev) {
          if (current.version !== (undo ? f.afterRev : f.baseRev)) throw new HttpError(409, `Cambió ${f.source.path} durante la operación`);
          const resolved = await resolveSafe(ctx.cfg, f.source.root, f.source.path);
          await backup(ctx.cfg, f.source.root, f.source.path, current.bytes);
          guard();
          await atomicWrite(resolved.abs, target);
          ctx.bus.change({ root: f.source.root, path: f.source.path, kind: 'change' });
        }
        f.applied = !undo; await save();
      }
      op.state = undo ? 'undone' : 'done'; await save(); return op;
    } catch (error: any) { op.error = 'La operación quedó pendiente. Revisa sus archivos antes de completarla o revertirla.'; await save(); throw error; }
  };
  return locked(0);
}
