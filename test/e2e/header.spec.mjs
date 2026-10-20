import { test, expect } from './fixtures.mjs';

test('Buscar abre el acceso rápido sin cambiar el lateral ni las pestañas @smoke', async ({ studio, page }) => {
  await page.goto(studio.server.url);
  await expect(page.locator('.cm-editor')).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Secciones' });
  const quick = navigation.getByRole('button', { name: 'Buscar', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Abrir o buscar', exact: true });
  const sidebar = page.getByRole('complementary', { name: 'Panel lateral: Memoria', exact: true });
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole('group', { name: 'Acciones del espacio de trabajo', exact: true })).toHaveCount(0);
  expect((await page.locator('header.et-header').boundingBox()).height).toBeLessThanOrEqual(50);
  await sidebar.getByRole('button', { name: 'Ocultar panel lateral', exact: true }).click();
  await expect(sidebar).not.toBeVisible();
  await page.getByRole('button', { name: 'Mostrar panel lateral', exact: true }).click();
  await expect(sidebar).toBeVisible();
  const tabs = await page.locator('.dv-tab').count();
  expect(await navigation.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))))
    .toEqual(['Inicio', 'Memoria', 'Notas', 'Diagramas', 'Biblioteca', 'Multivista', 'Buscar', 'Ajustes']);
  const home = navigation.getByRole('button', { name: 'Inicio', exact: true });
  await expect(home.locator('img')).toBeVisible();
  await home.click();
  await expect(page.getByRole('main', { name: 'Inicio', exact: true })).toBeVisible();
  await home.click();
  await expect(sidebar).toBeVisible();
  await expect(page.locator('.dv-tab')).toHaveCount(tabs);
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    const row = await page.locator('.et-main-nav').boundingBox();
    const search = await quick.boundingBox();
    expect(row.height).toBeLessThanOrEqual(50);
    expect(search.y).toBeGreaterThanOrEqual(row.y);
    expect(search.y + search.height).toBeLessThanOrEqual(row.y + row.height);
    expect(search.x + search.width).toBeLessThanOrEqual(width);
    await quick.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Buscar', exact: true }).press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(sidebar).toBeVisible();
    await expect(page.locator('.dv-tab')).toHaveCount(tabs);
  }
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Buscar', exact: true }).press('Escape');
  await navigation.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Biblioteca', exact: true })).toBeVisible();
  await quick.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Buscar', exact: true }).press('Escape');
  await expect(page.getByRole('main', { name: 'Biblioteca', exact: true })).toBeVisible();
  expect((await page.locator('header.et-header').boundingBox()).height).toBeLessThanOrEqual(50);
  await page.locator('header.et-header').getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Añadir a Biblioteca', exact: true })).toBeVisible();
});

test('la preferencia antigua de búsqueda lateral recupera Memoria', async ({ studio, page }) => {
  await page.addInitScript(() => localStorage.setItem('et:sidebar', JSON.stringify({ section: 'search', open: true })));
  await page.goto(studio.server.url);
  await expect(page.getByRole('complementary', { name: 'Panel lateral: Memoria', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Panel lateral: Buscar', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Buscar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Abrir o buscar', exact: true });
  const input = dialog.getByRole('combobox', { name: 'Buscar', exact: true });
  await input.fill('ficticio');
  await dialog.getByRole('option', { name: /Buscar «ficticio» en todo/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Buscar', exact: true })).toHaveValue('ficticio');
});
