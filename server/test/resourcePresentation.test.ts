import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { itemFromContent, resourcePresentation } from '../src/resources.ts';
import { newLibraryData } from '../src/libraryModel.ts';
import { setup, type TestEnv } from './helpers.ts';
let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { await t.close(); });
const item = () => itemFromContent('Recursos/ficha.md', '---\ntitle: Ficha\n---\nDescripción ficticia', new Date());
it('proyecta desde la autoridad actual, sin convertir el tipo en formato', async () => {
  const r = { ...item(), kind: 'article' as const, attachments: ['articulo.pdf'],
    bibliography: { authority: 'library' as const, entryType: 'article', fields: { author: 'Ejemplo, Ana and Prueba, Luis', year: '2026', journal: 'Revista ficticia' } } };
  expect(await resourcePresentation(t.cfg, r)).toMatchObject({ authors: 'Ejemplo, Ana and Prueba, Luis', year: '2026', publication: 'Revista ficticia', pdf: true, formats: ['PDF'] });
  expect(r.kind).toBe('article');
  expect(await resourcePresentation(t.cfg, item())).toMatchObject({ description: 'Descripción ficticia', pdf: false, formats: [] });
});
it('lee el .bib manual vigente y no guarda una copia de los campos', async () => {
  const manual = path.join(t.cfg.memoriaDir, 'manual.bib');
  const r = { ...item(), bibliography: { authority: 'manual' as const, path: 'manual.bib', key: 'Prueba' } };
  await fs.writeFile(manual, '@book{Prueba,title={Libro},author={Ejemplo},year={2024},publisher={Editorial},edition={2}}');
  expect(await resourcePresentation(t.cfg, r)).toMatchObject({ authors: 'Ejemplo', year: '2024', publisher: 'Editorial', edition: '2' });
  await fs.writeFile(manual, '@book{Prueba,title={Libro},year={2026}}');
  expect(await resourcePresentation(t.cfg, r)).toMatchObject({ year: '2026' });
  expect((await resourcePresentation(t.cfg, r)).authors).toBeUndefined();
  expect(r.bibliography).not.toHaveProperty('fields');
  await fs.unlink(manual);
  expect((await resourcePresentation(t.cfg, r)).warning).toContain('manual');
});
it('un vínculo manual inválido o ambiguo no filtra archivos ajenos ni inventa datos', async () => {
  const r = { ...item(), bibliography: { authority: 'manual' as const, path: '../fuera.bib', key: 'Prueba' } };
  expect((await resourcePresentation(t.cfg, r)).warning).toBeTruthy();
  expect(newLibraryData({ kind: 'book', attachments: ['libro.epub'] }).kind).toBe('book');
});
