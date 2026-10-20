import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { DIAGRAM_TEMPLATES } from '../../web/src/lib/diagramTemplates.ts';

async function open(page) {
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Abrir o buscar' });
  await dialog.getByLabel('Buscar', { exact: true }).fill('borrador.mmd');
  await dialog.getByRole('option').filter({ hasText: 'borrador.mmd' }).first().click();
}

test('recupera campos sin aplicar al cerrar y recargar, sin guardarlos como fuente @smoke', async ({ studio, page }) => {
  const source = DIAGRAM_TEMPLATES.find(t => t.id === 'sectores').source;
  const dir = path.join(studio.root, 'memoria/diagramas');
  await fs.mkdir(dir);
  const file = path.join(dir, 'borrador.mmd');
  await fs.writeFile(file, source);
  await studio.biblioteca();
  await open(page);
  const form = page.getByRole('region', { name: 'Formulario de Sectores' });
  const label = form.getByLabel('Etiqueta', { exact: true }).first();
  await label.fill('Borrador sin aplicar');
  await expect(page.getByRole('button', { name: /1 sin guardar/ })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+s');
  expect(await fs.readFile(file, 'utf8')).toBe(source);
  const close = page.getByRole('button', { name: 'Cerrar borrador.mmd', exact: true });
  await page.locator('.dv-tab').filter({ hasText: 'borrador.mmd' }).hover();
  await close.click();
  await open(page);
  await page.getByRole('button', { name: 'Restaurar borrador', exact: true }).click();
  await expect(label).toHaveValue('Borrador sin aplicar');
  await expect(page.getByRole('button', { name: /1 sin guardar/ })).toBeVisible();
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  if (!await page.getByRole('button', { name: 'Restaurar borrador', exact: true }).isVisible()) await open(page);
  await page.getByRole('button', { name: 'Restaurar borrador', exact: true }).click();
  await expect(label).toHaveValue('Borrador sin aplicar');
  expect(await fs.readFile(file, 'utf8')).toBe(source);
  await form.getByRole('button', { name: 'Aplicar cambios', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Diagrama actualizado');
  await page.getByRole('button', { name: /^Guardar \(/ }).click();
  await expect.poll(() => fs.readFile(file, 'utf8')).toBe(source.replace('Investigación', 'Borrador sin aplicar'));
});

test('un cambio externo de tipo permite descartar campos antiguos sin resucitar el borrador @smoke', async ({ studio, page }) => {
  const dir = path.join(studio.root, 'memoria/diagramas');
  await fs.mkdir(dir);
  const file = path.join(dir, 'borrador.mmd');
  await fs.writeFile(file, DIAGRAM_TEMPLATES.find(t => t.id === 'sectores').source);
  await studio.biblioteca();
  await open(page);
  const form = page.getByRole('region', { name: 'Formulario de Sectores' });
  await form.getByLabel('Etiqueta', { exact: true }).first().fill('Campo pendiente ficticio');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('et:draft:'))
    .map(k => JSON.parse(localStorage.getItem(k))).some(draft => !!draft.form))).toBe(true);
  const source = DIAGRAM_TEMPLATES.find(t => t.id === 'flujo').source;
  await fs.writeFile(file, source);
  await expect(form).not.toBeVisible();
  await page.getByRole('button', { name: 'Descartar campos', exact: true }).click();
  const close = page.getByRole('button', { name: 'Cerrar borrador.mmd', exact: true });
  await page.locator('.dv-tab').filter({ hasText: 'borrador.mmd' }).hover();
  await close.click();
  await open(page);
  await expect(page.getByRole('button', { name: 'Restaurar borrador', exact: true })).not.toBeVisible();
  await expect(page.getByText('Todo guardado', { exact: true })).toBeVisible();
  expect(await fs.readFile(file, 'utf8')).toBe(source);
});
