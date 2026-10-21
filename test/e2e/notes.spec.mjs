import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

test('las notas muestran Vista previa y Editar sin un acceso duplicado al asistente @smoke', async ({ studio, page }) => {
  await page.route('**/api/desktop/setup', route => route.fulfill({ json: { needsSetup: false, engine: {
    phase: 'ready', available: true, installed: true, current: true, received: 0, total: 0,
    message: null, version: 'texlive-ficticio', variant: 'online',
  } } }));
  await page.goto(studio.server.url);
  const navigation = page.getByRole('navigation', { name: 'Secciones' });
  await expect(navigation.getByRole('button', { name: 'Asistente', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Notas', exact: true }).click();
  const notes = page.getByRole('region', { name: 'Espacio: Notas', exact: true });
  await notes.getByRole('treeitem', { name: 'Nota.md', exact: true }).click();
  const mode = notes.getByRole('group', { name: 'Modo de la nota', exact: true });
  const preview = mode.getByRole('button', { name: /^Vista previa \(/ });
  const edit = mode.getByRole('button', { name: /^Editar \(/ });
  await expect(preview).toHaveText('Vista previa');
  await expect(edit).toHaveText('Editar');
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  await expect(notes.getByRole('button', { name: 'Enviar selección o documento al asistente', exact: true })).toHaveCount(0);
  await edit.click();
  await expect(edit).toHaveAttribute('aria-pressed', 'true');
  const editor = notes.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press('ControlOrMeta+End');
  await editor.press('Enter');
  await editor.pressSequentially('Cambio pendiente ficticio');
  await preview.click();
  await expect(notes.getByText('Cambio pendiente ficticio', { exact: true })).toBeVisible();
  await edit.click();
  await expect(editor).toContainText('Cambio pendiente ficticio');
  await editor.press('ControlOrMeta+e');
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  expect(await fs.readFile(path.join(studio.root, 'notes/Nota.md'), 'utf8')).not.toContain('Cambio pendiente ficticio');
  await navigation.getByRole('button', { name: 'Multivista', exact: true }).click();
  await page.getByLabel('Apartado derecho', { exact: true }).selectOption('notes');
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(preview).toBeVisible();
  await expect(edit).toBeVisible();
  await expect.poll(async () => { const bounds = await mode.boundingBox(); return bounds ? bounds.x + bounds.width : Infinity; }).toBeLessThanOrEqual(900);
});
