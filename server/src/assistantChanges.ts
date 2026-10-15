import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, badRequest } from './errors.ts';
import { atomicWrite } from './fsutil.ts';
import type { AssistantSource } from './assistantFiles.ts';

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
