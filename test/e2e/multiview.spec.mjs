import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { DIAGRAM_TEMPLATES } from '../../web/src/lib/diagramTemplates.ts';

const nav = page => page.getByRole('navigation', { name: 'Secciones' });
const space = (page, name) => page.getByRole('region', { name: `Espacio: ${name}`, exact: true });
async function append(editor, text) {
  await editor.click();
  await editor.press('ControlOrMeta+End');
  await editor.press('End');
  await editor.press('Enter');
  await editor.pressSequentially(text);
}
async function openNote(page) {
  await nav(page).getByRole('button', { name: 'Notas', exact: true }).click();
  const notes = space(page, 'Notas');
  await notes.getByRole('treeitem', { name: 'Nota.md', exact: true }).click();
  await notes.getByRole('button', { name: /^Editar \(/ }).click();
  await expect(notes.locator('.cm-content')).toBeVisible();
  return notes;
}

test('cada apartado conserva sus documentos y Multivista sitúa los menús en los extremos @smoke', async ({ studio, page }) => {
  await page.goto(studio.server.url);
  const memory = space(page, 'Memoria');
  await expect(memory.locator('.cm-content')).toBeVisible();
  await append(memory.locator('.cm-content'), '% Borrador ficticio de memoria');
  const notes = await openNote(page);
  await append(notes.locator('.cm-content'), 'Borrador ficticio de nota');
  await expect(memory).not.toBeVisible();
  await nav(page).getByRole('button', { name: 'Memoria', exact: true }).click();
  await expect(memory.locator('.cm-content')).toContainText('Borrador ficticio de memoria');
  await nav(page).getByRole('button', { name: 'Multivista', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Acciones del espacio de trabajo', exact: true })).toHaveCount(0);
  await page.getByLabel('Apartado derecho', { exact: true }).selectOption('notes');
  await expect(memory).toBeVisible();
  await expect(notes).toBeVisible();
  await expect(notes.locator('.cm-content')).toContainText('Borrador ficticio de nota');
  await expect(memory.getByRole('tab', { name: 'PDF', exact: true })).toBeVisible();
  const ml = await memory.getByRole('complementary').boundingBox();
  const mr = await memory.locator('main').boundingBox();
  const nl = await notes.locator('main').boundingBox();
  const nr = await notes.getByRole('complementary').boundingBox();
  expect(ml.x + ml.width).toBeLessThanOrEqual(mr.x + 1);
  expect(nl.x + nl.width).toBeLessThanOrEqual(nr.x + 1);
  await page.getByRole('separator', { name: 'Ancho de las vistas', exact: true }).press('ArrowRight');
  await expect(page.getByRole('separator', { name: 'Ancho de las vistas', exact: true })).toHaveAttribute('aria-valuenow', '55');
  const menuWidth = page.getByRole('complementary', { name: 'Panel lateral: Notas', exact: true }).getByRole('separator');
  const width = Number(await menuWidth.getAttribute('aria-valuenow'));
  await menuWidth.press('ArrowLeft');
  await expect(menuWidth).toHaveAttribute('aria-valuenow', String(width + 20));
  await page.getByRole('button', { name: 'Ocultar menú derecho', exact: true }).click();
  await expect(notes.getByRole('complementary')).not.toBeVisible();
  await expect(memory.getByRole('complementary')).toBeVisible();
  await page.getByLabel('Apartado izquierdo', { exact: true }).selectOption('notes');
  await expect(page.getByLabel('Apartado derecho', { exact: true })).toHaveValue('memoria');
  await expect(notes.locator('.cm-content')).toContainText('Borrador ficticio de nota');
  expect(await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8')).not.toContain('Borrador ficticio');
  expect(await fs.readFile(path.join(studio.root, 'notes/Nota.md'), 'utf8')).not.toContain('Borrador ficticio de nota');
  await page.setViewportSize({ width: 900, height: 650 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await nav(page).getByRole('button', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Restablecer distribución de Memoria', exact: true }).click();
  await expect(memory.getByRole('region', { name: 'PDF de Memoria', exact: true })).toBeVisible();
  await expect(memory.locator('.dv-tab')).toHaveCount(2);
  await nav(page).getByRole('button', { name: 'Notas', exact: true }).click();
  await expect(notes.locator('.cm-content')).toContainText('Borrador ficticio de nota');
});

test('los presets recuperan pestañas, tamaños y menús sin sobrescribir los borradores @smoke', async ({ studio, page }) => {
  await page.goto(studio.server.url);
  const memory = space(page, 'Memoria');
  await expect(memory.locator('.cm-content')).toBeVisible();
  await append(memory.locator('.cm-content'), '% Primera edición ficticia');
  const notes = await openNote(page);
  await append(notes.locator('.cm-content'), 'Nota pendiente ficticia');
  await nav(page).getByRole('button', { name: 'Multivista', exact: true }).click();
  await page.getByLabel('Apartado derecho', { exact: true }).selectOption('notes');
  const separator = page.getByRole('separator', { name: 'Ancho de las vistas', exact: true });
  await separator.press('ArrowRight');
  await separator.press('ArrowRight');
  await page.getByRole('button', { name: 'Ocultar menú derecho', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar vista', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'Guardar vista', exact: true });
  await prompt.getByLabel('Nombre de la vista').fill('Redacción y notas');
  await prompt.getByRole('button', { name: 'Guardar vista', exact: true }).click();
  await expect(page.getByText('Vista «Redacción y notas» guardada', { exact: true })).toBeVisible();
  const saved = page.getByLabel('Vista guardada', { exact: true });
  const id = await saved.inputValue();
  await page.getByLabel('Apartado izquierdo', { exact: true }).selectOption('diagramas');
  await page.getByLabel('Apartado derecho', { exact: true }).selectOption('resources');
  await nav(page).getByRole('button', { name: 'Memoria', exact: true }).click();
  await append(memory.locator('.cm-content'), '% Segunda edición posterior al preset');
  await nav(page).getByRole('button', { name: 'Multivista', exact: true }).click();
  await saved.selectOption(id);
  await expect(page.getByLabel('Apartado izquierdo', { exact: true })).toHaveValue('memoria');
  await expect(page.getByLabel('Apartado derecho', { exact: true })).toHaveValue('notes');
  await expect(separator).toHaveAttribute('aria-valuenow', '60');
  await expect(notes.getByRole('complementary')).not.toBeVisible();
  await expect(memory.locator('.cm-content')).toContainText('Segunda edición posterior al preset');
  await expect(notes.locator('.cm-content')).toContainText('Nota pendiente ficticia');
  await expect(memory.getByRole('tab', { name: 'PDF', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByLabel('Apartado derecho', { exact: true })).toHaveValue('notes');
  await expect(separator).toHaveAttribute('aria-valuenow', '60');
  await memory.getByRole('button', { name: 'Restaurar borrador', exact: true }).click();
  await notes.getByRole('button', { name: 'Restaurar borrador', exact: true }).click();
  await expect(memory.locator('.cm-content')).toContainText('Segunda edición posterior al preset');
  await expect(notes.locator('.cm-content')).toContainText('Nota pendiente ficticia');
  await saved.selectOption(id);
  await page.getByRole('button', { name: 'Eliminar vista guardada', exact: true }).click();
  await page.getByRole('dialog', { name: 'Eliminar vista guardada', exact: true }).getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(saved.locator('option')).toHaveCount(1);
  await expect(memory.locator('.cm-content')).toContainText('Segunda edición posterior al preset');
});

test('separa las pestañas del layout anterior entre Memoria, Notas y Diagramas', async ({ studio, page }) => {
  await fs.mkdir(path.join(studio.root, 'memoria/diagramas'), { recursive: true });
  await fs.writeFile(path.join(studio.root, 'memoria/diagramas/ejemplo.mmd'), 'flowchart LR\n  A[Inicio] --> B[Fin]\n');
  const { instanceId } = await studio.json('/api/status');
  await page.addInitScript(({ instanceId }) => {
    localStorage.setItem(`et:layout:v1:${instanceId}`, JSON.stringify({
      grid: { width: 1440, height: 900, orientation: 'HORIZONTAL', root: { type: 'branch', data: [
        { type: 'leaf', size: 720, data: { id: 'editor', views: ['latex:tfg.tex', 'note:Nota.md', 'diagram:diagramas/ejemplo.mmd'], activeView: 'latex:tfg.tex' } },
        { type: 'leaf', size: 720, data: { id: 'pdf', views: ['pdf'], activeView: 'pdf' } },
      ] } },
      panels: {
        'latex:tfg.tex': { id: 'latex:tfg.tex', contentComponent: 'latex', title: 'tfg.tex', params: { root: 'memoria', path: 'tfg.tex' } },
        'note:Nota.md': { id: 'note:Nota.md', contentComponent: 'note', title: 'Nota.md', params: { root: 'notes', path: 'Nota.md' } },
        'diagram:diagramas/ejemplo.mmd': { id: 'diagram:diagramas/ejemplo.mmd', contentComponent: 'diagram', title: 'ejemplo.mmd', params: { root: 'memoria', path: 'diagramas/ejemplo.mmd' } },
        pdf: { id: 'pdf', contentComponent: 'pdf', title: 'PDF', renderer: 'always' },
      }, activeGroup: 'editor',
    }));
  }, { instanceId });
  await page.goto(studio.server.url);
  await expect(space(page, 'Memoria').locator('.dv-tab')).toHaveCount(2);
  await nav(page).getByRole('button', { name: 'Notas', exact: true }).click();
  await expect(space(page, 'Notas').getByRole('tab', { name: 'Nota.md', exact: true })).toBeVisible();
  await nav(page).getByRole('button', { name: 'Diagramas', exact: true }).click();
  await expect(space(page, 'Diagramas').getByRole('tab', { name: 'ejemplo.mmd', exact: true })).toBeVisible();
});

test('restaurar un preset conserva también los campos de diagrama sin aplicar', async ({ studio, page }) => {
  const dir = path.join(studio.root, 'memoria/diagramas');
  await fs.mkdir(dir, { recursive: true });
  const source = DIAGRAM_TEMPLATES.find(t => t.id === 'sectores').source;
  const file = path.join(dir, 'campos.mmd');
  await fs.writeFile(file, source);
  await page.goto(studio.server.url);
  await page.keyboard.press('ControlOrMeta+k');
  const open = page.getByRole('dialog', { name: 'Abrir o buscar', exact: true });
  await open.getByLabel('Buscar', { exact: true }).fill('campos.mmd');
  await open.getByRole('option').filter({ hasText: 'diagramas/campos.mmd' }).first().click();
  const form = page.getByRole('region', { name: 'Formulario de Sectores' });
  const label = form.getByLabel('Etiqueta', { exact: true }).first();
  await label.fill('Primer campo pendiente');
  await nav(page).getByRole('button', { name: 'Multivista', exact: true }).click();
  await page.getByLabel('Apartado derecho', { exact: true }).selectOption('diagramas');
  await page.getByRole('button', { name: 'Guardar vista', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'Guardar vista', exact: true });
  await prompt.getByLabel('Nombre de la vista').fill('Memoria y figuras');
  await prompt.getByRole('button', { name: 'Guardar vista', exact: true }).click();
  await label.fill('Campo posterior al preset');
  await page.getByRole('button', { name: 'Restaurar vista guardada', exact: true }).click();
  await expect(label).toHaveValue('Campo posterior al preset');
  expect(await fs.readFile(file, 'utf8')).toBe(source);
});
