import { create } from 'zustand';
import { json, type Root } from '../api';
import { useUI } from './ui';
import type { ContextSnapshot } from '../../../shared/assistant';
import type { AssistantContext, AssistantScope } from '../lib/assistant';
export type { AssistantContext, AssistantScope } from '../lib/assistant';

export interface ChatGPTAccountView { accounts: { id: string; label: string; connected: boolean; enabled: boolean }[]; active: string | null; pending: boolean; error: string; persistent: boolean }
export interface AssistantSource { id: string; root: Root; path: string; title: string; rev?: string }
interface AssistantPermissions { memoria: boolean; library: boolean; allNotes: boolean; folders: string; diagrams: boolean; attachments: boolean; prepareChanges: boolean; documents: { root: Root; path: string }[] }
const NO_PERMISSIONS: AssistantPermissions = { memoria: false, library: false, allNotes: false, folders: '', diagrams: false, attachments: false, prepareChanges: false, documents: [] };
export function scopeSummary(scope: AssistantScope) {
  return [scope.memoria && 'memoria', scope.library && 'fichas de Biblioteca', scope.notes.length > 0 && 'notas', scope.diagrams && 'diagramas', scope.documents?.length && `${scope.documents.length} ${scope.documents.length === 1 ? 'archivo concreto' : 'archivos concretos'}`, scope.attachments && 'PDF e imágenes'].filter(Boolean).join(', ') || 'sin fuentes';
}
export interface AssistantProposal { id: string; state: 'prepared' | 'applying' | 'done' | 'undoing' | 'undone'; error?: string;
  files: { source: AssistantSource; before: string; after: string; baseRev: string; afterRev: string; applied: boolean }[] }
export interface AssistantThread { projectContexts?: ContextSnapshot[]; id: string; account: string; instance: string; title: string; model: string; scope: AssistantScope;
  messages: { role: 'user' | 'assistant' | 'tool'; text: string }[]; sources: AssistantSource[]; proposals: AssistantProposal[]; state: 'idle' | 'running' | 'error' | 'cancelled'; error?: string; errorCode?: string; archived?: boolean; revoked?: boolean; permissionsOutdated?: boolean }
export function assistantRequest<T>(url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  return json<T>('/api/assistant' + url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
}
export const useAssistant = create<{
  account: ChatGPTAccountView | null; context: AssistantContext[]; thread: AssistantThread | null; draft: string;
  scopeOverride: AssistantScope | null;
  opened: boolean; visible: boolean; minimized: boolean;
  focusRequest: number;
  permissions: { owner: string; value: AssistantPermissions } | null;
}>(() => ({ account: null, context: [], thread: null, draft: '', scopeOverride: null, opened: false, visible: false, minimized: false, focusRequest: 0, permissions: null }));

export function useAssistantPermissions() {
  const account = useAssistant(s => s.account?.active);
  const instance = useUI(s => s.status?.instanceId);
  const stored = useAssistant(s => s.permissions);
  const owner = JSON.stringify([account, instance]);
  const permissions = stored?.owner === owner ? stored.value : NO_PERMISSIONS;
  const setPermissions = (patch: Partial<AssistantPermissions>) => useAssistant.setState({ permissions: { owner, value: { ...permissions, ...patch } } });
  return { permissions, setPermissions };
}
export async function refreshAssistantAccount() {
  const account = await assistantRequest<ChatGPTAccountView>('/account');
  const old = useAssistant.getState().account;
  if (old && old.active !== account.active) useAssistant.setState({ thread: null, context: [], draft: '', scopeOverride: null });
  useAssistant.setState({ account }); return account;
}
export function addAssistantContext(context: AssistantContext) {
  const previous = useAssistant.getState().context;
  useAssistant.setState({ context: previous.filter(c => c.root !== context.root || c.path !== context.path).concat(context) });
}
