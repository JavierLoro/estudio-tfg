import { create } from 'zustand';
import { assistantRequest, useAssistant } from './assistant';
import { useUI } from './ui';
import { useDesktop } from './desktop';
import type { ContextView, ContextSelection, ContextPath } from '../../../shared/assistant';
export type { ContextView, ContextSelection, ContextSnapshot, ContextProposal, ContextFragment, DiagramGeneration } from '../../../shared/assistant';
export const useProjectContext = create<{ value: ContextView | null; owner: string; error: string }>(() => ({ value: null, owner: '', error: '' }));
const owner = () => JSON.stringify([useUI.getState().status?.instanceId, useAssistant.getState().account?.active]);
export async function refreshProjectContext() {
  if (!useDesktop.getState().info) return;
  const expected = owner();
  if (expected !== useProjectContext.getState().owner) useProjectContext.setState({ value: null, owner: expected, error: '' });
  const value = await assistantRequest<ContextView>('/context');
  if (expected === owner() && (!useAssistant.getState().account || value.account === useAssistant.getState().account?.active)) useProjectContext.setState({ value, owner: expected, error: '' });
  return value;
}
export function contextBody(value: ContextView) { return { baseRev: value.rev, project: value.project, account: value.account }; }
export async function changeProjectContext(patch: object, value = useProjectContext.getState().value) {
  if (!value || useProjectContext.getState().owner !== owner()) throw new Error('Vuelve a consultar el contexto del proyecto actual');
  const expected = owner();
  const result = await assistantRequest<ContextView>('/context', { ...contextBody(value), ...patch });
  if (result.project === value.project && result.account === value.account && expected === owner()) useProjectContext.setState({ value: result });
  return result;
}
const under = (parent: ContextPath, child: ContextPath) => parent.root === child.root && (!parent.path || parent.path === child.path || child.path.startsWith(parent.path + '/'));
export function noteIncluded(selection: ContextSelection, source: ContextPath) {
  return !selection.excluded.some(e => under(e, source)) && (selection.mode === 'all' || selection.scopes.includes('notes') || selection.folders.some(e => under(e, source)) || selection.files.some(e => e.root === source.root && e.path === source.path));
}
export function noteSelection(selection: ContextSelection, source: ContextPath, checked: boolean): ContextSelection {
  if (checked && selection.excluded.some(e => under(e, source) && e.path !== source.path)) throw new Error('La carpeta está excluida. Revisa su exclusión en Ajustes antes de incluir esta nota.');
  const all = selection.mode === 'all';
  return { ...selection, mode: all && !checked ? 'partial' : selection.mode,
    scopes: all && !checked ? ['notes', 'memoria', 'library', 'diagrams'] : selection.scopes,
    files: checked && !selection.files.some(e => e.root === source.root && e.path === source.path) ? [...selection.files, source] : selection.files.filter(e => checked || e.root !== source.root || e.path !== source.path),
    excluded: checked ? selection.excluded.filter(e => !under(e, source)) : [...selection.excluded.filter(e => e.root !== source.root || e.path !== source.path), source] };
}
let timer: ReturnType<typeof setTimeout> | undefined;
export function refreshContextSoon() {
  if (!useProjectContext.getState().value || !useDesktop.getState().info) return;
  clearTimeout(timer); timer = setTimeout(() => void refreshProjectContext().catch(() => {}), 300);
}
