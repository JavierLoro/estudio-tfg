import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error Resolución bundler del cliente; Vitest transpila estos módulos.
import { api, ApiError, NetworkError } from '../../web/src/api';
// @ts-expect-error Resolución bundler del cliente.
import { captureStorage } from '../../web/src/lib/captureStorage';
// @ts-expect-error Resolución bundler del cliente.
import { useUI } from '../../web/src/state/ui';
// @ts-expect-error Resolución bundler del cliente.
import { submitCapture, flushCaptureQueue, editCapture, assignCaptureDestination, discardCapture, useCaptureQueue, initCaptureQueue } from '../../web/src/state/captureQueue';

let disk: any[];
beforeEach(() => {
  vi.useFakeTimers();
  disk = [];
  useCaptureQueue.setState({ items: [], busy: false, error: null });
  useUI.setState({ status: { libraryId: 'destino-A', notesDir: '/vault-A', resourcesSubdir: 'Recursos' } as any });
  vi.spyOn(captureStorage, 'migrate').mockResolvedValue();
  vi.spyOn(captureStorage, 'read').mockImplementation(async () => structuredClone(disk));
  vi.spyOn(captureStorage, 'put').mockImplementation(async (item: any) => { disk = [...disk.filter((x) => x.id !== item.id), structuredClone(item)]; });
  vi.spyOn(captureStorage, 'delete').mockImplementation(async (id: string) => { disk = disk.filter((x) => x.id !== id); });
  vi.spyOn(api, 'status').mockResolvedValue({ libraryId: 'destino-A' } as any);
  vi.spyOn(api, 'capture').mockResolvedValue({ path: 'Recursos/prueba.md', title: 'Prueba' });
  vi.spyOn(useUI.getState(), 'refreshResources').mockResolvedValue();
  vi.spyOn(useUI.getState(), 'toast').mockReturnValue(1);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

it('persiste texto y adjunto antes de enviar y reenvía el mismo ID tras perder respuesta', async () => {
  const capture = vi.mocked(api.capture).mockImplementationOnce(async (form: FormData) => {
    expect(disk).toHaveLength(1);
    expect(disk[0].id).toBe(form.get('operationId'));
    throw new NetworkError('Respuesta perdida');
  }).mockResolvedValue({ path: 'Recursos/prueba.md', title: 'Prueba' });
  const file = new File(['imagen ficticia'], 'prueba.png', { type: 'image/png' });
  expect((await submitCapture({ note: 'Texto conservado', file })).kind).toBe('queued');
  const id = disk[0].id;
  expect(await disk[0].file.blob.text()).toBe('imagen ficticia');
  // Simular recarga del estado en memoria: el reintento lee la copia durable.
  useCaptureQueue.setState({ items: [] });
  await flushCaptureQueue();
  expect(capture.mock.calls[1][0].get('operationId')).toBe(id);
  expect(capture.mock.calls[1][0].get('libraryId')).toBe('destino-A');
  expect(disk).toEqual([]);
});

it.each([400, 401, 409, 422])('conserva contenido ante HTTP %i y permite reintento explícito', async (status) => {
  const capture = vi.mocked(api.capture).mockRejectedValueOnce(new ApiError(status, 'Error ficticio', {}));
  expect((await submitCapture({ note: 'No perder', title: 'Prueba' })).kind).toBe('queued');
  expect(disk[0]).toMatchObject({ note: 'No perder', blocked: true });
  await flushCaptureQueue();
  expect(capture).toHaveBeenCalledTimes(1);
  await flushCaptureQueue(disk[0].id);
  expect(capture).toHaveBeenCalledTimes(2);
  expect(disk).toEqual([]);
});

it('cuota agotada no anuncia guardado, no envía ni conserva un envío oculto en memoria', async () => {
  vi.mocked(captureStorage.put).mockRejectedValue(new Error('QuotaExceededError'));
  const result = await submitCapture({ note: 'El formulario debe conservarme' });
  expect(result.kind).toBe('error');
  expect(api.capture).not.toHaveBeenCalled();
  expect(useCaptureQueue.getState().items).toEqual([]);
  expect(disk).toEqual([]);
  await flushCaptureQueue();
  expect(api.capture).not.toHaveBeenCalled();
});

it('si falla retirar el recibo, conserva el ID para recuperar sin anunciar éxito', async () => {
  vi.mocked(captureStorage.delete).mockRejectedValueOnce(new Error('Disco lleno'));
  expect((await submitCapture({ note: 'n' })).kind).toBe('queued');
  expect(disk).toHaveLength(1);
  const id = disk[0].id;
  await flushCaptureQueue(id);
  expect(vi.mocked(api.capture).mock.calls[1][0].get('operationId')).toBe(id);
  expect(disk).toEqual([]);
});

it('un cambio de vault nunca redirige un pendiente', async () => {
  vi.mocked(api.capture).mockRejectedValueOnce(new NetworkError('Offline'));
  await submitCapture({ note: 'Destino A' });
  vi.mocked(api.status).mockResolvedValue({ libraryId: 'destino-B' } as any);
  useUI.setState({ status: { libraryId: 'destino-B', notesDir: '/vault-B' } as any });
  await flushCaptureQueue(disk[0].id);
  expect(api.capture).toHaveBeenCalledTimes(1);
  expect(disk[0]).toMatchObject({ libraryId: 'destino-A', destination: '/vault-A/Recursos', blocked: true });
});

it('una captura antigua exige asignación explícita y conserva el adjunto', async () => {
  disk = [{ id: 'captura-antigua', createdAt: 1, note: 'Legado', blocked: true, file: { name: 'legado.txt', type: 'text/plain', blob: new Blob(['bytes antiguos']) } }];
  await flushCaptureQueue();
  expect(api.capture).not.toHaveBeenCalled();
  await assignCaptureDestination('captura-antigua');
  expect(disk[0].libraryId).toBe('destino-A');
  expect(disk[0].blocked).toBe(true);
  expect(await disk[0].file.blob.text()).toBe('bytes antiguos');
  await flushCaptureQueue('captura-antigua');
  expect(api.capture).toHaveBeenCalledOnce();
});

it('edita pendientes rechazados y evita alterar operaciones ya recibidas', async () => {
  vi.mocked(api.capture).mockRejectedValueOnce(new ApiError(400, 'Falta nota', {}));
  await submitCapture({ note: '' });
  const id = disk[0].id;
  vi.spyOn(api, 'captureOperation').mockResolvedValueOnce({ state: 'unknown' }).mockResolvedValue({ state: 'done' });
  expect(await editCapture(id, { note: 'Corregida' })).toBe(true);
  expect(disk[0]).toMatchObject({ id, note: 'Corregida', blocked: true });
  expect(await editCapture(id, { note: 'No sobreescribir' })).toBe(false);
  expect(disk[0].note).toBe('Corregida');
  expect(useCaptureQueue.getState().error).toContain('ya recibió');
});

it('descartar falla sin borrar la copia ni el estado visible', async () => {
  vi.mocked(api.capture).mockRejectedValueOnce(new ApiError(401, 'Acceso', {}));
  await submitCapture({ note: 'Conservar' });
  const id = disk[0].id;
  vi.mocked(captureStorage.delete).mockRejectedValueOnce(new Error('Fallo de persistencia'));
  await discardCapture(id);
  expect(disk[0].note).toBe('Conservar');
  expect(useCaptureQueue.getState().items[0].note).toBe('Conservar');
  await discardCapture(id);
  expect(disk).toEqual([]);
});
