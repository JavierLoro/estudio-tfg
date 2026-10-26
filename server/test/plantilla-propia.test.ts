import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setup, multipart, canSymlink, type TestEnv } from './helpers.ts';
import { zipFixture } from '../../test/zip-fixture.ts';
import { extraerPlantilla, MAX_ZIP } from '../src/plantilla-propia.ts';

const main = String.raw`\documentclass{article}
\begin{document}
\section{Apartado ficticio}
Texto propio de la plantilla.
\end{document}
`;
let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { vi.restoreAllMocks(); await t?.close(); });
const post = (url: string, payload: unknown) => t.app.inject({ method: 'POST', url, payload: payload as object });
async function upload(buffer: Buffer, name = 'plantilla.zip') {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buffer)]), name);
  return t.app.inject({ method: 'POST', url: '/api/templates/upload', ...(await multipart(fd)) });
}
const archive = () => zipFixture([
  { name: 'plantilla/main.tex', text: main, compressed: true },
  { name: 'plantilla/estilo/propio.cls', text: '% Clase propia ficticia\n' },
  { name: '__MACOSX/._main.tex', text: 'Metadatos ficticios' },
]);

it('inspecciona una carpeta y la abre conservando sus fuentes y el resto de ajustes', async () => {
  const dir = path.join(t.dir, 'proyecto');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'propio.tex'), main);
  await fs.writeFile(path.join(dir, 'fragmento.tex'), 'Texto de un capítulo.\n');
  const preview = await post('/api/templates/inspect', { dir });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toMatchObject({ principal: 'propio.tex', archivos: [
    { path: 'propio.tex', principal: true, compatible: false }, { path: 'fragmento.tex', principal: false, compatible: false },
  ] });
  const notes = t.cfg.notesDir;
  expect((await post('/api/templates/use', { dir, main: 'propio.tex' })).statusCode).toBe(200);
  expect(t.cfg.memoriaDir).toBe(dir);
  expect(t.cfg.memoriaMain).toBe('propio.tex');
  expect(t.cfg.notesDir).toBe(notes);
  expect(await fs.readFile(path.join(dir, 'propio.tex'), 'utf8')).toBe(main);
  expect(await fs.readdir(dir)).toEqual(['fragmento.tex', 'propio.tex']);
});
it('distingue los controles compatibles y no reconoce una clase incluida que el principal no utiliza', async () => {
  const own = await post('/api/templates/inspect', { dir: t.cfg.memoriaDir });
  expect(own.statusCode).toBe(200);
  expect(own.json().archivos.find((f: { path: string }) => f.path === 'tfg.tex').compatible).toBe(true);
  await fs.writeFile(path.join(t.cfg.memoriaDir, 'otro.tex'), main);
  expect((await post('/api/templates/use', { dir: t.cfg.memoriaDir, main: 'otro.tex' })).statusCode).toBe(200);
  expect((await t.app.inject('/api/memoria/plantilla')).json().estado).toBe('desconocida');
});
it('deja elegir el principal cuando hay varios y no cambia ajustes si no pertenece al proyecto', async () => {
  const dir = path.join(t.dir, 'varios');
  await fs.mkdir(dir);
  for (const name of ['primero.tex', 'segundo.tex']) await fs.writeFile(path.join(dir, name), main);
  const preview = (await post('/api/templates/inspect', { dir })).json();
  expect(preview.principal).toBeNull();
  const before = t.cfg.memoriaDir;
  for (const file of ['ausente.tex', '../primero.tex', '/primero.tex']) expect((await post('/api/templates/use', { dir, main: file })).statusCode).toBe(400);
  expect(t.cfg.memoriaDir).toBe(before);
});
it('importa un ZIP con carpeta envolvente, conserva su clase y exige un destino nuevo', async () => {
  const result = await upload(archive());
  expect(result.statusCode, result.body).toBe(200);
  const preview = result.json();
  expect(preview.principal).toBe('main.tex');
  const dir = path.join(t.dir, 'importada');
  await fs.mkdir(dir);
  const before = t.cfg.memoriaDir;
  expect((await post('/api/templates/use', { id: preview.id, dir, main: 'main.tex' })).statusCode).toBe(409);
  expect(t.cfg.memoriaDir).toBe(before);
  const target = path.join(t.dir, 'nueva');
  const used = await post('/api/templates/use', { id: preview.id, dir: target, main: 'main.tex' });
  expect(used.statusCode, used.body).toBe(200);
  expect(await fs.readFile(path.join(target, 'main.tex'), 'utf8')).toBe(main);
  expect(await fs.readFile(path.join(target, 'estilo/propio.cls'), 'utf8')).toContain('Clase propia ficticia');
  await expect(fs.stat(path.join(target, 'estilo/memoria.cls'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await post('/api/templates/use', { id: preview.id, dir: path.join(t.dir, 'segunda'), main: 'main.tex' })).statusCode).toBe(410);
});
it('rechaza rutas peligrosas, enlaces, nombres ambiguos y ZIP dañados sin cambiar la memoria', async () => {
  const before = t.cfg.memoriaDir;
  const cases = [
    ...['../fuera.tex', '/absoluto.tex', 'C:/x.tex', 'a\\b.tex', 'CON.tex', '.git/config'].map((name) => [{ name, text: main }]),
    [{ name: 'link.tex', text: main, mode: 0o120777 }],
    [{ name: 'main.tex', text: main }, { name: 'MAIN.tex', text: main }],
    [{ name: 'café.tex', text: main }, { name: 'cafe\u0301.tex', text: main }],
    [{ name: 'main.tex', text: main, crc: 0 }],
    [{ name: 'main.tex', text: main, compressed: true, size: 201 * 1024 * 1024 }],
  ];
  for (const entries of cases) {
    const result = await upload(zipFixture(entries));
    expect([400, 413], result.body).toContain(result.statusCode);
  }
  expect((await upload(Buffer.from('No es ZIP'))).statusCode).toBe(400);
  expect((await upload(archive(), 'otro.txt')).statusCode).toBe(400);
  expect(t.cfg.memoriaDir).toBe(before);
  expect((await upload(archive())).statusCode).toBe(200);
});
it('limita las revisiones pendientes, permite cancelarlas y rechaza las caducadas', async () => {
  const previews = [];
  for (let i = 0; i < 3; i++) {
    const r = await upload(archive());
    expect(r.statusCode).toBe(200); previews.push(r.json());
  }
  expect((await upload(archive())).statusCode).toBe(429);
  expect((await t.app.inject({ method: 'DELETE', url: '/api/templates/uploads/' + previews[0].id })).statusCode).toBe(200);
  expect((await upload(archive())).statusCode).toBe(200);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  expect((await post('/api/templates/use', { id: previews[1].id, dir: path.join(t.dir, 'caducada'), main: 'main.tex' })).statusCode).toBe(410);
  await expect(fs.stat(path.join(t.dir, 'caducada'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await upload(archive())).statusCode).toBe(200);
});
it('limita el tamaño comprimido y el número de entradas antes de extraer archivos', async () => {
  const dir = path.join(t.dir, 'limites');
  await fs.mkdir(dir);
  await expect(extraerPlantilla(Buffer.alloc(MAX_ZIP + 1), dir)).rejects.toMatchObject({ statusCode: 413 });
  const files = Array.from({ length: 5001 }, (_, i) => ({ name: 'archivo' + i + '.tex' }));
  expect((await upload(zipFixture(files))).statusCode).toBe(400);
  expect(await fs.readdir(dir)).toEqual([]);
});
it('respeta las carpetas permitidas y la autorización administrativa', async () => {
  expect((await post('/api/templates/inspect', { dir: path.dirname(t.dir) })).statusCode).toBe(400);
  expect((await t.app.inject({ method: 'POST', url: '/api/templates/inspect', remoteAddress: '192.0.2.1', payload: { dir: t.cfg.memoriaDir } })).statusCode).toBe(403);
  expect((await post('/api/templates/inspect', { dir: t.cfg.notesDir })).statusCode).toBe(400);
});
it.skipIf(!(await canSymlink()))('no ofrece principales enlazados fuera de la carpeta del proyecto', async () => {
  const dir = path.join(t.dir, 'enlace');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(t.dir, 'fuera.tex'), main);
  await fs.symlink(path.join(t.dir, 'fuera.tex'), path.join(dir, 'main.tex'));
  expect((await post('/api/templates/inspect', { dir })).statusCode).toBe(400);
  expect((await post('/api/templates/use', { dir, main: 'main.tex' })).statusCode).toBe(400);
});
