import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { DIAGRAM_TEMPLATES } from '../../web/src/lib/diagramTemplates.ts';

async function openPicker(page) {
  const section = page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diagramas', exact: true });
  if (await section.getAttribute('aria-pressed') !== 'true') await section.click();
  await page.getByRole('button', { name: 'Nuevo diagrama', exact: true }).first().click();
  return page.getByRole('dialog', { name: 'Nuevo diagrama' });
}

test('el selector muestra nombre y ejemplo de los quince tipos @smoke', async ({ studio, page }, info) => {
  await studio.biblioteca();
  const dialog = await openPicker(page);
  const picker = dialog.getByRole('group', { name: 'Tipo de diagrama' });
  for (const template of DIAGRAM_TEMPLATES) {
    await expect(picker.getByRole('heading', { name: template.label, exact: true })).toBeVisible();
    const example = picker.getByRole('img', { name: `Ejemplo de ${template.label}`, exact: true });
    await expect(example).toBeVisible();
    await expect(example.locator('svg')).toHaveCount(1);
    expect(await example.textContent()).not.toBe('');
    const box = await example.boundingBox();
    expect(box.height).toBeGreaterThan(100);
    expect(box.height).toBeLessThan(250);
    if (template.id === 'gantt') await expect(example).not.toContainText('2026-');
    if (['flujo', 'clases', 'gantt'].includes(template.id))
      await info.attach(`${template.id}-selector.png`, { body: await dialog.screenshot(), contentType: 'image/png' });
    await picker.getByRole('button', { name: 'Tipo siguiente', exact: true }).click();
  }
  await expect(picker.getByRole('heading', { name: 'Flujo', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Tipo anterior', exact: true }).click();
  await expect(picker.getByRole('heading', { name: 'Sankey', exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await picker.focus();
  await picker.press('Home');
  await expect(picker.getByRole('img', { name: 'Ejemplo de Flujo', exact: true })).toBeVisible();
  await info.attach('selector-oscuro.png', { body: await dialog.screenshot(), contentType: 'image/png' });
});

test('el teclado recorre el selector y Crear usa la última selección @smoke', async ({ studio, page }) => {
  await studio.biblioteca();
  const dialog = await openPicker(page);
  const picker = dialog.getByRole('group', { name: 'Tipo de diagrama' });
  const name = dialog.getByLabel('Nombre', { exact: true });
  await name.fill('selector-ficticio');
  await name.press('ArrowLeft');
  await expect(picker.getByRole('heading', { name: 'Flujo', exact: true })).toBeVisible();
  await picker.focus();
  await picker.press('ArrowLeft');
  await expect(picker.getByRole('heading', { name: 'Sankey', exact: true })).toBeVisible();
  await picker.press('Home');
  await picker.press('End');
  await picker.press('ArrowRight');
  await picker.press('ArrowRight');
  await picker.press('ArrowRight');
  await expect(picker.getByRole('heading', { name: 'Estados', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await fs.readFile(path.join(studio.root, 'memoria/diagramas/selector-ficticio.mmd'), 'utf8'))
    .toBe(DIAGRAM_TEMPLATES.find(t => t.id === 'estados').source);
  const reopened = await openPicker(page);
  await expect(reopened.getByRole('heading', { name: 'Flujo', exact: true })).toBeVisible();
  await expect(reopened.getByLabel('Nombre', { exact: true })).toHaveValue('');
});
