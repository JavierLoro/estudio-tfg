import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

const flatten = items => items.flatMap(item => [item, ...flatten(item.children)]);
const read = (studio, file) => fs.readFile(path.join(studio.root, 'memoria', file), 'utf8');
const outline = async studio => flatten((await studio.json('/api/memoria/outline')).items);

async function prepare(studio, page) {
  for (const [file, content] of Object.entries({
    'uno.tex': '\\chapter{Uno}\\label{cap:uno}\nTexto inicial.\n\\section{Primera}\\label{sec:primera}\nTexto primero.\n\\section{Segunda}\\label{sec:segunda}\nTexto segundo con \\ref{sec:primera}.\n',
    'dos.tex': '\\chapter{Dos}\\label{cap:dos}\nTexto dos.\n',
  })) await studio.json('/api/file', { method: 'POST', data: { root: 'memoria', path: file, content } });
  const current = await studio.json('/api/file?root=memoria&path=tfg.tex');
  await studio.json('/api/file', { method: 'PUT', data: {
    root: 'memoria', path: 'tfg.tex', baseRev: current.rev,
    content: '\\documentclass{book}\n\\begin{document}\n\\mainmatter\n\\include{uno}\n\\include{dos}\n\\end{document}\n',
  } });
  await page.goto(studio.server.url);
  await page.getByRole('tab', { name: 'Apartados', exact: true }).click();
  const tree = page.getByRole('tree', { name: 'Estructura de la memoria' });
  await expect(tree.getByText('Primera', { exact: true })).toBeVisible();
  return tree;
}

async function action(tree, page, title, label) {
  const button = tree.getByRole('button', { name: 'Acciones de ' + title, exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('organizador: crear, renombrar, mover, cambiar nivel y activar sin perder texto @smoke', async ({ studio, page }, info) => {
  const tree = await prepare(studio, page);
  await action(tree, page, 'Primera', '+ Subsección');
  const create = page.getByRole('dialog', { name: 'Nueva subsección', exact: true });
  await create.getByRole('textbox').fill('Detalle');
  await create.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect.poll(async () => (await outline(studio)).find(item => item.title === 'Detalle')?.number).toBe('1.1.1');
  const parent = tree.getByRole('treeitem').filter({ has: page.getByText('Primera', { exact: true }) });
  await parent.getByRole('button', { name: 'Desplegar', exact: true }).click();
  await expect(tree.getByText('Detalle', { exact: true })).toBeVisible();

  await action(tree, page, 'Detalle', 'Cambiar título…');
  const rename = page.getByRole('dialog', { name: 'Cambiar título', exact: true });
  await rename.getByRole('textbox').fill('Detalle revisado');
  await rename.getByRole('button', { name: 'Cambiar título', exact: true }).click();
  await expect(tree.getByText('Detalle revisado', { exact: true })).toBeVisible();
  await expect.poll(() => read(studio, 'uno.tex')).toContain('\\subsection{Detalle revisado}\\label{sec:detalle}');

  await action(tree, page, 'Detalle revisado', 'Convertir en sección');
  await expect.poll(async () => (await outline(studio)).find(item => item.title === 'Detalle revisado')?.kind).toBe('section');
  await action(tree, page, 'Detalle revisado', 'Convertir en subsección');
  await expect.poll(async () => (await outline(studio)).find(item => item.title === 'Detalle revisado')?.number).toBe('1.1.1');
  const section = tree.getByRole('treeitem').filter({ has: page.getByText('Primera', { exact: true }) });
  if (await section.getByRole('button', { name: 'Desplegar', exact: true }).count()) await section.getByRole('button', { name: 'Desplegar', exact: true }).click();

  const before = await read(studio, 'uno.tex');
  await action(tree, page, 'Primera', 'Desactivar apartado');
  await expect.poll(async () => (await outline(studio)).find(item => item.title === 'Primera')?.enabled).toBe(false);
  await expect(tree.getByText('Detalle revisado', { exact: true })).toHaveCount(0);
  await action(tree, page, 'Primera', 'Activar apartado');
  await expect.poll(() => read(studio, 'uno.tex')).toBe(before);

  await action(tree, page, 'Primera', 'Bajar apartado');
  await expect.poll(async () => (await outline(studio)).find(item => item.title === 'Primera')?.number).toBe('1.2');
  await action(tree, page, 'Primera', 'Subir apartado');
  await expect.poll(() => read(studio, 'uno.tex')).toBe(before);
  await action(tree, page, 'Dos', 'Subir apartado');
  await expect.poll(async () => (await outline(studio)).find(item => item.title === 'Dos')?.number).toBe('1');
  await action(tree, page, 'Dos', 'Desactivar apartado');
  await expect.poll(async () => (await outline(studio)).find(item => item.title === 'Dos')?.enabled).toBe(false);
  await action(tree, page, 'Dos', 'Activar apartado');
  await expect.poll(async () => (await outline(studio)).find(item => item.title === 'Dos')?.enabled).toBe(true);
  expect(await read(studio, 'uno.tex')).toContain('\\ref{sec:primera}');
  expect(await read(studio, 'dos.tex')).toBe('\\chapter{Dos}\\label{cap:dos}\nTexto dos.\n');
  await page.screenshot({ path: info.outputPath('organizador.png') });
});

test('organizador conserva borradores y rechaza una estructura que cambió mientras se elegía el título', async ({ studio, page }) => {
  const tree = await prepare(studio, page);
  await tree.getByText('Primera', { exact: true }).click();
  const editor = page.locator('.cm-content').filter({ hasText: '\\chapter{Uno}' });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nTexto pendiente de guardar.');
  const original = await read(studio, 'uno.tex');
  await action(tree, page, 'Primera', 'Cambiar título…');
  let dialog = page.getByRole('dialog', { name: 'Cambiar título', exact: true });
  await dialog.getByRole('textbox').fill('Título nuevo');
  await dialog.getByRole('button', { name: 'Cambiar título', exact: true }).click();
  await expect(page.getByText(/Guarda o resuelve los cambios de/)).toBeVisible();
  expect(await read(studio, 'uno.tex')).toBe(original);
  await expect(editor).toContainText('Texto pendiente de guardar.');
  await editor.press('ControlOrMeta+s');
  await expect.poll(() => read(studio, 'uno.tex')).toContain('Texto pendiente de guardar.');
  await expect.poll(async () => (await outline(studio)).find(item => item.title === 'Primera')?.title).toBe('Primera');
  await action(tree, page, 'Primera', 'Cambiar título…');
  dialog = page.getByRole('dialog', { name: 'Cambiar título', exact: true });
  const current = await studio.json('/api/file?root=memoria&path=uno.tex');
  await studio.json('/api/file', { method: 'PUT', data: { root: 'memoria', path: 'uno.tex', baseRev: current.rev, content: current.content + '\nCambio externo conservado.\n' } });
  await dialog.getByRole('textbox').fill('Otro título');
  await dialog.getByRole('button', { name: 'Cambiar título', exact: true }).click();
  await expect(page.getByText(/La memoria cambió; recarga la estructura/)).toBeVisible();
  const after = await read(studio, 'uno.tex');
  expect(after).toContain('Cambio externo conservado.');
  expect(after).toContain('Texto pendiente de guardar.');
  expect(after).toContain('\\section{Primera}');
});
