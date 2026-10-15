import { create } from 'zustand';
import { json, type Root } from '../api';

export interface ChatGPTAccountView { accounts: { id: string; label: string; connected: boolean; enabled: boolean }[]; active: string | null; pending: boolean; error: string; persistent: boolean }
export interface AssistantContext { root: Root; path: string; text?: string }
export interface AssistantSource { id: string; root: Root; path: string; title: string; rev?: string }
export interface AssistantProposal { id: string; state: 'prepared' | 'applying' | 'done' | 'undoing' | 'undone'; error?: string;
  files: { source: AssistantSource; before: string; after: string; baseRev: string; afterRev: string; applied: boolean }[] }
export interface AssistantThread { id: string; account: string; instance: string; title: string; model: string; scope: { memoria: boolean; library: boolean; notes: string[] };
  messages: { role: 'user' | 'assistant' | 'tool'; text: string }[]; sources: AssistantSource[]; proposals: AssistantProposal[]; state: 'idle' | 'running' | 'error' | 'cancelled'; error?: string; errorCode?: string; archived?: boolean }
export function assistantRequest<T>(url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  return json<T>('/api/assistant' + url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
}
export const useAssistant = create<{
  account: ChatGPTAccountView | null; context: AssistantContext[]; thread: AssistantThread | null; draft: string;
}>(() => ({ account: null, context: [], thread: null, draft: '' }));
export async function refreshAssistantAccount() {
  const account = await assistantRequest<ChatGPTAccountView>('/account');
  const old = useAssistant.getState().account;
  if (old && old.active !== account.active) useAssistant.setState({ thread: null, context: [], draft: '' });
  useAssistant.setState({ account }); return account;
}
export function addAssistantContext(context: AssistantContext) {
  const previous = useAssistant.getState().context;
  useAssistant.setState({ context: previous.filter(c => c.root !== context.root || c.path !== context.path).concat(context) });
}
