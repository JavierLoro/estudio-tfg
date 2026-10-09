import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error El cliente usa la resolución bundler de Vite; Vitest lo transpila.
import { api, ConflictError } from '../../web/src/api';
// @ts-expect-error Resolución bundler del cliente.
import { useUI } from '../../web/src/state/ui';
// @ts-expect-error Resolución bundler del cliente.
import { setResourceTags, useResourceEdit, reloadResourceConflict, reapplyResourceConflict } from '../../web/src/state/resources';

beforeEach(() => {
  useUI.setState({ status: { notesDir: '/vault' } as any, resources: [{ path: 'r.md', rev: '1111111111111111', tags: ['recurso'] } as any] });
  useResourceEdit.setState({ pending: null, busy: false, error: null });
  vi.spyOn(useUI.getState(), 'refreshResources').mockResolvedValue();
  vi.spyOn(useUI.getState(), 'toast').mockReturnValue(1);
});
afterEach(() => vi.restoreAllMocks());

it('conserva la intención, exige recarga explícita y usa su revisión', async () => {
  const patch = vi.spyOn(api, 'patchResource').mockRejectedValueOnce(new ConflictError('status: revisado', '2222222222222222', {})).mockResolvedValue({} as any);
  const read = vi.spyOn(api, 'readFile').mockResolvedValue({ content: 'status: revisado', rev: '3333333333333333' } as any);
  await setResourceTags('r.md', ['recurso', 'nuevo']);
  expect(useResourceEdit.getState().pending?.changes.tags).toEqual(['recurso', 'nuevo']);
  await reapplyResourceConflict();
  expect(patch).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
  await reloadResourceConflict();
  await reapplyResourceConflict();
  expect(patch).toHaveBeenLastCalledWith({ path: 'r.md', tags: ['recurso', 'nuevo'], baseRev: '3333333333333333' });
  expect(useResourceEdit.getState().pending).toBeNull();
});

it('no reaplica una edición al cambiar de vault', async () => {
  const patch = vi.spyOn(api, 'patchResource').mockRejectedValueOnce(new ConflictError('actual', '2222222222222222', {}));
  await setResourceTags('r.md', ['nuevo']);
  useUI.setState({ status: { notesDir: '/otro-vault' } as any });
  const read = vi.spyOn(api, 'readFile');
  await reloadResourceConflict();
  expect(read).not.toHaveBeenCalled();
  expect(patch).toHaveBeenCalledTimes(1);
  expect(useResourceEdit.getState().pending?.changes.tags).toEqual(['nuevo']);
});
