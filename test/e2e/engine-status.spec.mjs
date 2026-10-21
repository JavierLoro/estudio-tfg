import { test, expect } from './fixtures.mjs';

test('el aviso del motor explica el fallo de Docker y abre Ajustes @smoke @sin-herramientas', async ({ studio, page }) => {
  const { motor } = await studio.json('/api/status');
  expect(motor.mensaje).toBe('El servidor no pudo conectar con el servicio de compilación de Docker.');
  await page.goto(studio.server.url);
  const indicator = page.getByRole('button', { name: 'Motor PDF no disponible: ver motivo', exact: true });
  await expect(indicator).toHaveAttribute('title', `${motor.mensaje} Pulsa para ver los detalles.`);
  await indicator.click();
  const dialog = page.getByRole('dialog', { name: 'Motor PDF no disponible', exact: true });
  await expect(dialog.getByText(motor.mensaje, { exact: true })).toBeVisible();
  await expect(dialog.getByText(/no en este navegador/)).toBeVisible();
  await expect(page.locator('.dv-tab')).toHaveCount(2);
  await dialog.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(indicator).toBeFocused();
  await indicator.click();
  await dialog.getByRole('button', { name: 'Abrir Ajustes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const settings = page.getByRole('dialog', { name: 'Ajustes', exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByText(motor.mensaje, { exact: true })).toBeVisible();
  await expect(page.locator('.dv-tab')).toHaveCount(2);
});

test('el aviso de TeX local muestra las herramientas ausentes @sin-herramientas', async ({ studio, page }) => {
  await studio.json('/api/settings', { method: 'PUT', data: { compileEngine: 'local' } });
  const { motor } = await studio.json('/api/status');
  await page.goto(studio.server.url);
  await page.getByRole('button', { name: 'Motor PDF no disponible: ver motivo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Motor PDF no disponible', exact: true });
  await expect(dialog.getByText(motor.mensaje, { exact: true })).toBeVisible();
  await expect(dialog).toContainText('latexmk, biber, pdflatex');
  await expect(dialog).toContainText('Detectar herramientas');
});
