import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { multipart, setup, type TestEnv } from './helpers.ts';
import { instanceId } from '../src/settings.ts';
import { parseExcalidraw, MAX_SCENE_BYTES, sceneFingerprint } from '../../shared/excalidraw.ts';
import { readMeta } from '../src/diagramFiles.ts';
import { rev } from '../src/fsutil.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { await t.close(); });
const scene = () => JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} });
const create = (file: string, content = scene()) => t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'memoria', path: file, content } });

it('crea y edita escenas con revisión e historial; las lista como diagramas Excalidraw', async () => {
  const file = 'diagramas/prueba.excalidraw';
  const first = await create(file);
  expect(first.statusCode).toBe(200);
  const current = (await t.app.inject({ url: '/api/file?root=memoria&path=' + file })).json();
  expect(current.content).toBe(scene());
  const content = scene().replace('#ffffff', '#ff0000');
  const update = { root: 'memoria', path: file, content, baseRev: current.rev };
  expect((await t.app.inject({ method: 'PUT', url: '/api/file', payload: update })).statusCode).toBe(200);
  expect((await t.app.inject({ method: 'PUT', url: '/api/file', payload: update })).statusCode).toBe(409);
  const list = (await t.app.inject({ url: '/api/diagramas/estado' })).json();
  expect(list.items).toContainEqual(expect.objectContaining({ path: file, formato: 'excalidraw', estado: 'sin-exportar' }));
  expect(await fs.readFile(path.join(t.cfg.memoriaDir, file), 'utf8')).toBe(content);
});

it('rechaza escenas dañadas, contenido remoto, imágenes ausentes y exceso de tamaño conservando el original', async () => {
  const file = 'diagramas/valido.excalidraw';
  await create(file);
  const element = { id: 'a', type: 'image', x: 0, y: 0, width: 10, height: 10, angle: 0, opacity: 100, fileId: 'f' };
  const damaged = [{ ...element, type: 'rectangle', groupIds: {} }, { ...element, type: 'rectangle', boundElements: 'no es una lista' }];
  for (const content of ['{', JSON.stringify({ ...JSON.parse(scene()), elements: [element] }), ...damaged.map(e => JSON.stringify({ ...JSON.parse(scene()), elements: [e] })), JSON.stringify({ ...JSON.parse(scene()), files: { f: { id: 'f', dataURL: 'https://example.org/x.png' } } })]) {
    expect((await t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'memoria', path: file, content, baseRev: rev(scene()) } })).statusCode).toBe(400);
  }
  expect(() => parseExcalidraw(' '.repeat(MAX_SCENE_BYTES + 1))).toThrow('10 MiB');
  expect(await fs.readFile(path.join(t.cfg.memoriaDir, file), 'utf8')).toBe(scene());
});

it('reserva el nombre entre formatos incluso al crear simultáneamente o renombrar', async () => {
  const results = await Promise.all([create('diagramas/igual.mmd', 'graph TD; A-->B'), create('diagramas/igual.excalidraw')]);
  expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
  await create('diagramas/otro.excalidraw');
  await create('diagramas/destino.mmd', 'graph TD; A-->B');
  expect((await t.app.inject({ method: 'POST', url: '/api/move', payload: { root: 'memoria', from: 'diagramas/otro.excalidraw', to: 'diagramas/destino.excalidraw' } })).statusCode).toBe(409);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir, 'diagramas/otro.excalidraw'), 'utf8')).toBe(scene());
  expect((await create('diagramas/Árbol.MMD', 'graph TD; A-->B')).statusCode).toBe(200);
  expect((await create('diagramas/A\u0301RBOL.excalidraw')).statusCode).toBe(409);
});

it('exportar exige revisión, SVG local y PDF; no pisa una figura ajena', async () => {
  const file = 'diagramas/figura.excalidraw'; await create(file);
  const payload = { path: file, rev: rev(scene()), svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M0 0L10 10"/></svg>' };
  expect((await t.app.inject({ method: 'POST', url: '/api/diagramas/exportar', payload })).statusCode).toBe(400);
  const pdf = Buffer.from('%PDF-1.4\n% fixture ficticio\n%%EOF').toString('base64');
  expect((await t.app.inject({ method: 'POST', url: '/api/diagramas/exportar', payload: { ...payload, pdf, rev: 'otra' } })).statusCode).toBe(409);
  expect((await t.app.inject({ method: 'POST', url: '/api/diagramas/exportar', payload: { ...payload, pdf, svg: '<svg><image href="https://example.org/x.png"/></svg>' } })).statusCode).toBe(400);
  expect((await t.app.inject({ method: 'POST', url: '/api/diagramas/exportar', payload: { ...payload, pdf } })).statusCode).toBe(200);
  expect((await t.app.inject({ url: '/api/diagramas/estado?path=' + file })).json().estado).toBe('exportado');
  await fs.writeFile(path.join(t.cfg.memoriaDir, 'diagramas/figura.mmd'), 'graph TD; A-->B');
  expect((await t.app.inject({ method: 'POST', url: '/api/diagramas/exportar', payload: { ...payload, pdf } })).statusCode).toBe(409);
});

it('renombrar conserva el propietario de la figura y permite volver a exportar', async () => {
  const from = 'diagramas/antes.excalidraw', to = 'diagramas/despues.excalidraw';
  await create(from);
  const payload = { path: from, rev: rev(scene()), svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M0 0L10 10"/></svg>', pdf: Buffer.from('%PDF-1.4\n% fixture ficticio\n%%EOF').toString('base64') };
  expect((await t.app.inject({ method: 'POST', url: '/api/diagramas/exportar', payload })).statusCode).toBe(200);
  expect((await t.app.inject({ method: 'POST', url: '/api/move', payload: { root: 'memoria', from, to } })).statusCode).toBe(200);
  expect(readMeta(await fs.readFile(path.join(t.cfg.memoriaDir, 'figuras/diagramas/antes.svg'), 'utf8'))?.fuente).toBe(to);
  expect((await t.app.inject({ method: 'POST', url: '/api/diagramas/exportar', payload: { ...payload, path: to } })).statusCode).toBe(200);
});

it('bloquea crear, guardar y exportar con identidad de otro proyecto', async () => {
  const file = 'diagramas/proyecto.excalidraw'; await create(file);
  for (const [method, url, payload] of [
    ['POST', '/api/file', { root: 'memoria', path: 'diagramas/ajeno.excalidraw', content: scene() }],
    ['PUT', '/api/file', { root: 'memoria', path: file, content: scene(), baseRev: rev(scene()) }],
    ['POST', '/api/diagramas/exportar', { path: file, rev: rev(scene()), svg: '<svg/>', pdf: '' }],
  ] as const) expect((await t.app.inject({ method, url, payload: { ...payload, instanceId: 'otro-proyecto' } })).statusCode).toBe(409);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir, file), 'utf8')).toBe(scene());
});

it('la huella conserva cambios de contenido e ignora revisiones internas', () => {
  const a = JSON.parse(scene());
  a.elements = [{ id: 'a', type: 'text', text: 'Antes', version: 1, updated: 1 }];
  const b = structuredClone(a); b.elements[0].version++; b.elements[0].updated++;
  expect(sceneFingerprint(a)).toBe(sceneFingerprint(b));
  b.elements[0].text = 'Después'; expect(sceneFingerprint(a)).not.toBe(sceneFingerprint(b));
});

it('importar valida la escena y elige otro nombre si el otro formato lo ocupa', async () => {
  await create('diagramas/importado.mmd', 'graph TD; A-->B');
  async function upload(content: string) {
    const form = new FormData(); form.append('file', new Blob([content], { type: 'application/json' }), 'importado.excalidraw');
    return t.app.inject({ method: 'POST', url: '/api/files/import?root=memoria&directory=diagramas&instanceId=' + instanceId(t.cfg), ...await multipart(form) });
  }
  expect((await upload('{')).statusCode).toBe(400);
  const first = await upload(scene());
  expect(first.statusCode).toBe(200); expect(first.json().path).toBe('diagramas/importado 2.excalidraw');
  const second = await upload(scene());
  expect(second.json()).toMatchObject({ path: first.json().path, reused: true });
  expect(await fs.readFile(path.join(t.cfg.memoriaDir, 'diagramas/importado.mmd'), 'utf8')).toBe('graph TD; A-->B');
});
