import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { zipFixture } from '../zip-fixture.ts';

const principal = String.raw`\documentclass{estilo/universidad}
\input{datos}
\begin{document}
\chapter{Introducción ficticia}
\input{capitulo}
\end{document}
`;
const clase = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{estilo/universidad}[2026/10/23 Clase ficticia de prueba]
\LoadClass[oneside]{book}
`;
const source = () => zipFixture([
  { name: 'universidad/memoria.tex', text: principal, compressed: true },
  { name: 'universidad/ejemplo.tex', text: '\\documentclass{article}\n\\begin{document}Ejemplo\\end{document}\n' },
  { name: 'universidad/estilo/universidad.cls', text: clase },
  { name: 'universidad/datos.tex', text: '% Datos gestionados por la plantilla externa.\n' },
  { name: 'universidad/capitulo.tex', text: 'Texto ficticio que debe conservarse.\n' },
]);
async function start(studio, page) {
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Usar una plantilla propia…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Usar una plantilla propia', exact: true });
}
test('plantilla propia: ZIP, principal explícito y formato externo conservado @smoke', async ({ studio, page }, info) => {
  const dialog = await start(studio, page);
  const before = await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8');
  await dialog.getByLabel('Archivo ZIP de la plantilla').setInputFiles({ name: 'universidad.zip', mimeType: 'application/zip', buffer: source() });
  await expect(dialog.getByLabel('Archivo principal', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Importar y abrir', exact: true })).toBeDisabled();
  await dialog.getByLabel('Archivo principal', { exact: true }).selectOption('memoria.tex');
  await expect(dialog.getByText('Código LaTeX', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Elegir ubicación…', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Guardar la plantilla importada', exact: true });
  await picker.getByRole('button', { name: 'Usar esta ubicación', exact: true }).click();
  await page.screenshot({ path: info.outputPath('plantilla-zip.png') });
  await dialog.getByRole('button', { name: 'Importar y abrir', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const dir = path.join(studio.root, 'mi-memoria');
  expect((await studio.json('/api/settings')).values).toMatchObject({ memoriaDir: dir, memoriaMain: 'memoria.tex' });
  expect(await fs.readFile(path.join(dir, 'memoria.tex'), 'utf8')).toBe(principal);
  expect(await fs.readFile(path.join(dir, 'estilo/universidad.cls'), 'utf8')).toBe(clase);
  expect(await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8')).toBe(before);
  await expect(page.getByRole('tab', { name: 'memoria.tex', exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Apartados', exact: true }).click();
  await page.getByRole('tree', { name: 'Estructura de la memoria' }).getByText('Datos del trabajo', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Formato de la plantilla', exact: true })).toBeVisible();
  await expect(page.getByLabel('Fuente del texto', { exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Autor/a', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Editar código', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'memoria.tex', exact: false })).toBeVisible();
});
test('plantilla propia: abre una carpeta y cancelar un ZIP conserva la selección actual', async ({ studio, page }, info) => {
  const dir = path.join(studio.root, 'otra-plantilla');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'trabajo.tex'), '\\documentclass{book}\n\\begin{document}\\chapter{Ficticio}Texto\\end{document}\n');
  const dialog = await start(studio, page);
  await dialog.getByRole('button', { name: 'Elegir carpeta…', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Carpeta de la plantilla', exact: true });
  await picker.getByRole('button', { name: 'otra-plantilla', exact: true }).click();
  await picker.getByRole('button', { name: 'Usar esta carpeta', exact: true }).click();
  await expect(dialog.getByLabel('Archivo principal', { exact: true })).toHaveValue('trabajo.tex');
  await dialog.getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await studio.json('/api/settings')).values.memoriaDir).toBe(dir);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Usar una plantilla propia…', exact: true }).click();
  await page.setViewportSize({ width: 480, height: 850 });
  await dialog.getByLabel('Archivo ZIP de la plantilla').setInputFiles({ name: 'universidad.zip', mimeType: 'application/zip', buffer: source() });
  await dialog.getByLabel('Archivo principal', { exact: true }).selectOption('memoria.tex');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('plantilla-estrecha.png') });
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect((await studio.json('/api/settings')).values.memoriaDir).toBe(dir);
  expect(await fs.readdir(dir)).toEqual(['trabajo.tex']);
});
test('plantilla propia: un ZIP rechazado permite reintentar sin modificar la memoria', async ({ studio, page }) => {
  const dialog = await start(studio, page);
  await dialog.getByLabel('Archivo ZIP de la plantilla').setInputFiles({ name: 'roto.zip', mimeType: 'application/zip', buffer: zipFixture([{ name: '../salida.tex', text: principal }]) });
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect((await studio.json('/api/settings')).values.memoriaDir).toBe(path.join(studio.root, 'memoria'));
  await dialog.getByLabel('Archivo ZIP de la plantilla').setInputFiles({ name: 'universidad.zip', mimeType: 'application/zip', buffer: source() });
  await expect(dialog.getByLabel('Archivo principal', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('alert')).not.toBeVisible();
});
test('plantilla propia: el ZIP importado compila con su clase original @worker', async ({ studio }) => {
  test.skip(!process.env.E2E_WORKER_URL, 'Requiere un worker de prueba real');
  const response = await studio.json('/api/templates/upload', { method: 'POST', multipart: {
    file: { name: 'universidad.zip', mimeType: 'application/zip', buffer: source() },
  } });
  const dir = path.join(studio.root, 'importada');
  await studio.json('/api/templates/use', { method: 'POST', data: { id: response.id, dir, main: 'memoria.tex' } });
  const result = await studio.json('/api/compile', { method: 'POST' });
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  expect(result.diagnostics).toEqual([]);
  const log = await fs.readFile(path.join(process.env.E2E_WORKER_OUT, result.buildId, 'main.log'), 'utf8');
  expect(log).not.toMatch(/LaTeX Font Warning:|Missing character:/);
  expect(await fs.readFile(path.join(dir, 'estilo/universidad.cls'), 'utf8')).toBe(clase);
});
