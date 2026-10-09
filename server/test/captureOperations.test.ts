import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { libraryId, recoverCaptures } from '../src/captureOperations.ts';
import { multipart, setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { vi.restoreAllMocks(); await t.close(); });
const journal = (id = 'operacion-prueba') => path.join(t.dir, 'data/captures', libraryId(t.cfg), id, 'operation.json');
async function post(id = 'operacion-prueba', changes: Record<string, string> = {}, file = true) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ operationId: id, libraryId: libraryId(t.cfg), note: 'Nota ficticia', title: 'Prueba', ...changes })) fd.set(k, v);
  if (file) fd.set('file', new Blob(['adjunto ficticio']), 'prueba.txt');
  return t.app.inject({ method: 'POST', url: '/api/capture', ...await multipart(fd) });
}
const resources = () => fs.readdir(path.join(t.cfg.notesDir, 'Recursos'));

it('respuesta perdida, reenvío y concurrencia crean una sola ficha y adjunto', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => post()));
  expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
  expect(new Set(results.map((r) => r.body)).size).toBe(1);
  expect((await resources()).filter((p) => p.endsWith('.md'))).toHaveLength(1);
  expect(await fs.readdir(path.join(t.cfg.notesDir, 'Recursos/adjuntos'))).toEqual(['prueba.txt']);
  const receipt = JSON.parse(await fs.readFile(journal(), 'utf8'));
  expect(receipt.state).toBe('done');
  expect(receipt.markdown).toBeUndefined();
  await expect(fs.stat(path.join(path.dirname(journal()), 'attachment'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('recuerda el resultado tras reiniciar y no reescribe una ficha ya editada', async () => {
  const first = await post();
  await t.app.close();
  const file = path.join(t.cfg.notesDir, first.json().path);
  await fs.writeFile(file, 'Edición posterior que debe sobrevivir');
  const next = await buildApp(t.cfg, { watch: false, serveWeb: false });
  t.app = next.app;
  await t.app.ready();
  expect((await post()).json()).toEqual(first.json());
  expect(await fs.readFile(file, 'utf8')).toBe('Edición posterior que debe sobrevivir');
});

it('rechaza reutilizar un ID con otro texto o adjunto', async () => {
  expect((await post()).statusCode).toBe(200);
  const different = await post('operacion-prueba', { note: 'Otra nota' });
  expect(different.statusCode).toBe(409);
  expect(different.json().code).toBe('capture_id_conflict');
  expect((await post('operacion-prueba', {}, false)).statusCode).toBe(409);
  expect((await resources()).filter((p) => p.endsWith('.md'))).toHaveLength(1);
});

it('exige destino y rechaza cambiar de vault sin enviar al nuevo', async () => {
  const original = libraryId(t.cfg);
  const other = path.join(t.dir, 'otro-vault');
  await fs.mkdir(other);
  t.cfg.notesDir = other;
  const response = await post('operacion-prueba', { libraryId: original });
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe('capture_destination_changed');
  expect(await fs.readdir(other)).toEqual(['Recursos']); // temporal de subida, sin archivos publicados
  expect(await fs.readdir(path.join(other, 'Recursos/adjuntos'))).toEqual([]);
  const missing = await t.app.inject({ method: 'POST', url: '/api/capture', payload: { operationId: 'otra-operacion', note: 'n' } });
  expect(missing.statusCode).toBe(400);
});

it('401 y validación no publican ni registran una operación', async () => {
  t.cfg.authToken = 'token-ficticio';
  expect((await post()).statusCode).toBe(401);
  t.cfg.authToken = '';
  expect((await post('operacion-prueba', { note: '' }, false)).statusCode).toBe(400);
  await expect(fs.stat(journal())).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['registro', 'stage', 'adjunto', 'ficha', 'recibo'])('recupera un fallo en %s sin duplicados', async (stage) => {
  let failed = false;
  const rename = fs.rename.bind(fs);
  const link = fs.link.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    const dst = String(to);
    const record = dst.endsWith('operation.json');
    let trigger = stage === 'stage' && path.basename(dst) === 'attachment';
    if (record && stage === 'registro') trigger = true;
    if (record && stage === 'recibo') {
      const payload = JSON.parse(await fs.readFile(from, 'utf8'));
      trigger = payload.state === 'done';
    }
    if (trigger && !failed) { failed = true; throw Object.assign(new Error('Fallo ficticio'), { code: 'EIO' }); }
    return rename(from, to);
  });
  vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
    const dst = String(to);
    const trigger = (stage === 'adjunto' && dst.endsWith('prueba.txt')) || (stage === 'ficha' && dst.endsWith('Prueba.md'));
    if (trigger && !failed) { failed = true; throw Object.assign(new Error('Fallo ficticio'), { code: 'EIO' }); }
    return link(from, to);
  });
  const failedResponse = await post();
  expect(failed).toBe(true);
  expect(failedResponse.statusCode).toBe(500);
  vi.restoreAllMocks();
  // Reinicio intenta completar incluso sin reenvío; si faltaba stage, lo conserva para reintentar.
  await t.app.close();
  t.app = (await buildApp(t.cfg, { watch: false, serveWeb: false })).app;
  await t.app.ready();
  expect((await post()).statusCode).toBe(200);
  expect((await resources()).filter((p) => p.endsWith('.md'))).toHaveLength(1);
  expect(await fs.readdir(path.join(t.cfg.notesDir, 'Recursos/adjuntos'))).toEqual(['prueba.txt']);
  expect(JSON.parse(await fs.readFile(journal(), 'utf8')).state).toBe('done');
});

it('un conflicto de recuperación conserva stage y texto sin sobrescribir el archivo ajeno', async () => {
  const link = fs.link.bind(fs);
  vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
    if (String(to).endsWith('Prueba.md')) throw Object.assign(new Error('Interrupción'), { code: 'EIO' });
    return link(from, to);
  });
  expect((await post()).statusCode).toBe(500);
  vi.restoreAllMocks();
  const record = JSON.parse(await fs.readFile(journal(), 'utf8'));
  await fs.writeFile(path.join(t.cfg.notesDir, record.result.path), 'Contenido ajeno');
  const problems = await recoverCaptures(t.cfg);
  expect(problems).toHaveLength(1);
  expect((await post()).statusCode).toBe(409);
  expect(await fs.readFile(path.join(t.cfg.notesDir, record.result.path), 'utf8')).toBe('Contenido ajeno');
  expect(await fs.readFile(path.join(path.dirname(journal()), 'attachment'), 'utf8')).toBe('adjunto ficticio');
  // Los nombres pendientes no se reutilizan en una nueva operación.
  expect((await post('otra-operacion')).statusCode).toBe(200);
  expect((await resources()).filter((p) => p.endsWith('.md'))).toHaveLength(2);
});

it('el endpoint de consulta diferencia operación desconocida y terminada', async () => {
  const url = `/api/capture/operation?operationId=operacion-prueba&libraryId=${libraryId(t.cfg)}`;
  expect((await t.app.inject({ url })).json()).toEqual({ state: 'unknown' });
  await post();
  expect((await t.app.inject({ url })).json()).toEqual({ state: 'done' });
});

it('usa la misma raíz aunque Ajustes cambie mientras se recibe el archivo', async () => {
  const original = t.cfg.notesDir;
  const alternative = path.join(t.dir, 'nuevo-vault');
  await fs.mkdir(alternative);
  const read = fs.readFile.bind(fs);
  vi.spyOn(fs, 'readFile').mockImplementation((async (...args: any[]) => {
    if (String(args[0]).includes('.upload-')) t.cfg.notesDir = alternative;
    return (read as any)(...args);
  }) as typeof fs.readFile);
  const response = await post();
  expect(response.statusCode).toBe(200);
  expect(await fs.readFile(path.join(original, response.json().path), 'utf8')).toContain('Nota ficticia');
  expect(await fs.readdir(alternative)).toEqual([]);
});

it.each([{operationId: 3}, {libraryId: false}, {operationId: '../escape'}])('rechaza identificadores mal formados: %j', async (changes) => {
  const response = await t.app.inject({method: 'POST', url: '/api/capture', payload: {operationId: 'operacion-prueba', libraryId: libraryId(t.cfg), note: 'n', ...changes}});
  expect(response.statusCode).toBe(400);
  expect((await resources()).filter((p) => p.endsWith('.md'))).toEqual([]);
});


it('un recibo dañado no borra contenido ni impide consultar la biblioteca', async () => {
  const first = await post();
  await fs.writeFile(journal(), '{roto');
  const problems = await recoverCaptures(t.cfg);
  expect(problems).toHaveLength(1);
  await t.app.close();
  t.app = (await buildApp(t.cfg, {watch:false,serveWeb:false})).app;
  expect((await t.app.inject({url:'/api/resources'})).statusCode).toBe(200);
  expect(await fs.readFile(path.join(t.cfg.notesDir, first.json().path), 'utf8')).toContain('Nota ficticia');
  expect((await post()).statusCode).toBe(500);
  expect(await fs.readFile(journal(), 'utf8')).toBe('{roto');
});
