import { emptyContext } from './context-fixture.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

async function desktop(page) {
  const calls = [];
  await page.route('**/api/desktop/setup', route => route.fulfill({ json: { needsSetup: false, engine: { phase: 'ready', available: true, installed: true, current: true } } }));
  await page.route('**/api/assistant/**', route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === '/api/assistant/account') return route.fulfill({ json: { active: null, accounts: [], pending: false, error: '', persistent: false } });
    calls.push(endpoint); return route.abort();
  });
  return calls;
}

async function memory(studio, page) {
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Memoria', exact: true }).click();
  await page.getByRole('button', { name: 'Código', exact: true }).click();
  const editor = page.locator('.cm-content:visible').first();
  await expect(editor).toBeVisible(); return editor;
}

test('selección de memoria: copiar, cortar, deshacer y pegar respetan el borrador y el foco', async ({ studio, page }, info) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const editor = await memory(studio, page);
  const original = await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8');
  await editor.click(); await editor.press('ControlOrMeta+Home'); await editor.press('Shift+End');
  await editor.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Texto seleccionado · Memoria', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Deshacer', exact: true })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Copiar', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('\\documentclass{article}');
  await expect(editor).toBeFocused();
  await editor.press('Shift+F10'); await menu.getByRole('menuitem', { name: 'Cortar', exact: true }).click();
  await expect(editor).not.toContainText('\\documentclass{article}');
  await editor.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Deshacer', exact: true }).click();
  await expect(editor).toContainText('\\documentclass{article}');
  await editor.press('ControlOrMeta+End');
  await page.evaluate(() => navigator.clipboard.writeText('\nPegado desde el menú contextual.'));
  await editor.press('Shift+F10'); await page.getByRole('menuitem', { name: 'Pegar', exact: true }).click();
  await expect(editor).toContainText('Pegado desde el menú contextual.');
  expect(await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8')).toBe(original);
  await page.setViewportSize({ width: 620, height: 440 });
  await editor.press('Shift+F10');
  const smallMenu = page.getByRole('menu');
  const rect = await smallMenu.boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(620); expect(rect.y + rect.height).toBeLessThanOrEqual(440);
  await smallMenu.press('End');
  await expect(smallMenu.getByRole('menuitem').last()).toBeFocused();
  await page.screenshot({ path: info.outputPath('menu-texto.png') });
  await smallMenu.press('Escape'); await expect(editor).toBeFocused();
});

test('el menú del editor prepara una consulta sobre la selección sin enviar ni conceder permisos', async ({ studio, page }) => {
  const calls = await desktop(page);
  const editor = await memory(studio, page);
  await editor.click(); await editor.press('ControlOrMeta+Home'); await editor.press('Shift+End');
  await editor.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Asistente: explicar la selección', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'Asistente', exact: true });
  await expect(assistant.getByRole('textbox', { name: 'Mensaje al asistente' })).toHaveValue(/Explica la selección/);
  await expect(assistant.getByRole('textbox', { name: 'Mensaje al asistente' })).toBeFocused();
  await expect(assistant.getByRole('list', { name: 'Contexto adjunto' })).toContainText('tfg.tex · selección');
  await expect(assistant.getByText('Falta permiso para tfg.tex.', { exact: true })).toBeVisible();
  await expect(assistant.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
  expect(calls).toEqual([]);
});

test('copiar y pegar desde el menú visual conservan los filtros de LaTeX', async ({ studio, page }) => {
  const source = 'Antes \\textbf{texto} después.\n';
  const file = path.join(studio.root, 'memoria/tfg.tex');
  await fs.writeFile(file, source);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const editor = await memory(studio, page);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await editor.click(); await editor.press('ControlOrMeta+a'); await editor.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Copiar', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Antes texto después.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain('textbf');
  await editor.press('ControlOrMeta+End');
  await page.evaluate(() => navigator.clipboard.writeText(' 50%'));
  await editor.press('Shift+F10'); await page.getByRole('menuitem', { name: 'Pegar', exact: true }).click();
  await expect(editor).toContainText('50');
  await page.getByRole('button', { name: 'Código', exact: true }).click();
  await expect(editor).toContainText('50\\%');
  expect(await fs.readFile(file, 'utf8')).toBe(source);
});

test('los menús existentes del árbol conservan Abrir al lado y el cierre con Escape', async ({ studio, page }) => {
  await memory(studio, page);
  const tree = page.getByRole('complementary', { name: 'Panel lateral: Memoria', exact: true });
  await tree.getByRole('treeitem', { name: /^capitulo\.tex/ }).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /^Abrir al lado/ })).toBeVisible();
  await menu.press('Escape'); await expect(menu).toHaveCount(0);
  await tree.getByRole('treeitem', { name: /^capitulo\.tex/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Abrir al lado/ }).click();
  await expect(page.getByRole('tab', { name: 'capitulo.tex', exact: true })).toBeVisible();
});

test('vista previa de nota: menú propio, selección, consulta y paso a editar', async ({ studio, page }) => {
  await desktop(page);
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Notas', exact: true }).click();
  await page.getByRole('treeitem', { name: 'Nota.md', exact: true }).click();
  const content = page.getByLabel('Contenido de la nota', { exact: true });
  await content.focus(); await content.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Nota · Vista previa', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Copiar selección', exact: true })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Cortar', exact: true })).toHaveCount(0);
  await menu.press('End'); await expect(menu.getByRole('menuitem').last()).toBeFocused();
  await menu.press('Escape'); await expect(content).toBeFocused();
  await content.press('Shift+F10'); await menu.getByRole('menuitem', { name: 'Seleccionar contenido', exact: true }).click();
  await content.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Asistente: resumir la selección', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'Asistente', exact: true });
  await expect(assistant.getByRole('list', { name: 'Contexto adjunto' })).toContainText('Nota.md · selección');
  await assistant.getByRole('button', { name: 'Cerrar asistente', exact: true }).click();
  await content.focus(); await content.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Editar nota', exact: true }).click();
  await expect(page.locator('.cm-content:visible')).toBeVisible();
  await page.locator('.cm-content:visible').press('Shift+F10');
  await expect(page.getByRole('menu', { name: /Notas|Nota/ })).toBeVisible();
});

test('las notas de Biblioteca preparan consultas y abren su editor gestionado', async ({ studio, page }) => {
  const calls = await desktop(page);
  await studio.biblioteca();
  await page.getByRole('button', { name: 'Añadir', exact: true }).last().click();
  const add = page.getByRole('dialog', { name: 'Añadir a Biblioteca', exact: true });
  await add.getByLabel('Título', { exact: true }).fill('Recurso ficticio contextual');
  await add.getByLabel('Notas', { exact: true }).fill('Aportación ficticia del recurso.');
  await add.getByRole('button', { name: 'Añadir', exact: true }).click();
  await add.getByRole('button', { name: 'Abrir ficha', exact: true }).click();
  const content = page.getByLabel('Notas de la ficha', { exact: true });
  await content.focus(); await content.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Biblioteca', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Asistente: mejorar redacción', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Asistente: explicar la ficha', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'Asistente', exact: true });
  await expect(assistant.getByRole('textbox', { name: 'Mensaje al asistente' })).toHaveValue(/Explica la ficha/);
  expect(calls).toEqual([]);
  await assistant.getByRole('button', { name: 'Cerrar asistente', exact: true }).click();
  await content.focus(); await content.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Editar ficha', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Editar ficha', exact: true })).toBeVisible();
});

test('el menú visual actúa sobre el bloque pulsado, una conexión o el fondo, con deshacer', async ({ studio, page }, info) => {
  const calls = await desktop(page);
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diagramas', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo diagrama', exact: true }).first().click();
  const create = page.getByRole('dialog', { name: 'Nuevo diagrama', exact: true });
  await create.getByLabel('Nombre', { exact: true }).fill('contextual');
  await create.getByRole('button', { name: 'Crear', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Lienzo del diagrama', exact: true });
  await expect(canvas.locator('.mw-svg-host svg:visible')).toBeVisible();
  const element = page.getByLabel('Elemento del diagrama', { exact: true });
  await element.selectOption({ label: 'Fin' });
  const start = canvas.locator('[data-mw-entity="node:inicio"]').first();
  await start.click({ button: 'right' });
  let menu = page.getByRole('menu', { name: 'Bloque: Inicio', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Borrar conexión', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Asistente: explicar este bloque', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'Asistente', exact: true });
  await expect(assistant.getByRole('textbox', { name: 'Mensaje al asistente' })).toHaveValue(/el bloque «Inicio» \(inicio\)/);
  await expect(assistant.getByRole('list', { name: 'Contexto adjunto' })).toContainText('contextual.mmd');
  expect(calls).toEqual([]);
  await assistant.getByRole('button', { name: 'Cerrar asistente', exact: true }).click();
  await start.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: info.outputPath('menu-bloque.png') });
  await menu.getByRole('menuitem', { name: 'Cambiar texto del bloque…', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'Texto del bloque', exact: true });
  await prompt.getByRole('textbox').fill('Inicio contextual');
  await prompt.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await expect(canvas.locator('.mw-svg-host svg:visible')).toContainText('Inicio contextual');
  await expect(canvas.locator('.mw-svg-host svg:visible')).toContainText('Fin');
  const file = path.join(studio.root, 'memoria/diagramas/contextual.mmd');
  expect(await fs.readFile(file, 'utf8')).not.toContain('Inicio contextual');
  await canvas.focus(); await canvas.press('Shift+F10'); await page.getByRole('menuitem', { name: 'Deshacer', exact: true }).click();
  await expect(canvas.locator('.mw-svg-host svg:visible')).not.toContainText('Inicio contextual');
  await element.selectOption({ label: 'Inicio → Leer los datos' });
  await canvas.focus(); await canvas.press('Shift+F10');
  menu = page.getByRole('menu', { name: 'Conexión: Inicio → Leer los datos', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Borrar bloque', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Cambiar etiqueta de la conexión…', exact: true }).click();
  const label = page.getByRole('dialog', { name: 'Etiqueta de la conexión', exact: true });
  await label.getByRole('textbox').fill('Paso revisado');
  await label.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await expect(canvas.locator('.mw-svg-host svg:visible')).toContainText('Paso revisado');
  await page.getByRole('button', { name: /^Guardar \(/ }).click();
  await expect.poll(() => fs.readFile(file, 'utf8')).toContain('Paso revisado');
  await element.selectOption(''); await canvas.focus(); await canvas.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Diagrama', exact: true }).getByRole('menuitem', { name: 'Añadir elemento…', exact: true })).toBeVisible();
});
