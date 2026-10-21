import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { DIAGRAM_TEMPLATES } from '../../web/src/lib/diagramTemplates.ts';

test.use({ viewport: { width: 2000, height: 1100 } });

async function create(page, studio, id) {
  const template = DIAGRAM_TEMPLATES.find(t => t.id === id);
  await studio.biblioteca();
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diagramas', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo diagrama', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo diagrama' });
  await dialog.getByLabel('Nombre', { exact: true }).fill(`controles-${id}`);
  const picker = dialog.getByRole('group', { name: 'Tipo de diagrama' });
  await picker.focus();
  for (let i = 0; i < DIAGRAM_TEMPLATES.indexOf(template); i++) await picker.press('ArrowRight');
  await expect(picker.getByRole('heading', { name: template.label, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.et-canvas .mw-svg-host svg:visible')).toBeVisible();
  return path.join(studio.root, `memoria/diagramas/controles-${id}.mmd`);
}

async function save(page, file, expected) {
  await page.getByRole('button', { name: /^Guardar \(/ }).click();
  await expect.poll(() => fs.readFile(file, 'utf8')).toMatch(expected);
}

async function reopen(page, id) {
  const name = `controles-${id}.mmd`;
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.hover();
  await tab.getByRole('button', { name: /^Cerrar / }).click();
  await page.keyboard.press('ControlOrMeta+k');
  const open = page.getByRole('dialog', { name: 'Abrir o buscar' });
  await open.getByLabel('Buscar', { exact: true }).fill(name);
  await open.getByRole('option').filter({ hasText: name }).first().click();
  await expect(page.locator('.et-canvas .mw-svg-host svg:visible')).toBeVisible();
}

async function select(page, label) {
  const show = page.getByRole('button', { name: 'Mostrar las propiedades del bloque', exact: true });
  if (await show.isVisible()) await show.click();
  await page.getByLabel('Elemento del diagrama', { exact: true }).selectOption({ label });
}

async function commit(page, label, value) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press('Enter');
  await expect(field).toHaveValue(value);
}

test('Actor seguido de Mensaje conserva un identificador seguro y permite guardar @smoke', async ({ studio, page }) => {
  const file = await create(page, studio, 'secuencia');
  const palette = page.getByRole('toolbar', { name: 'Bloques', exact: true });
  await palette.getByRole('button', { name: 'Actor', exact: true }).click();
  await expect(page.locator('.et-canvas .mw-svg-host svg:visible')).toContainText('Actor');
  await page.keyboard.press('Escape');
  await palette.getByRole('button', { name: 'Mensaje', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.et-canvas .mw-svg-host svg:visible')).toContainText('Mensaje');
  await expect(palette.getByRole('button', { name: 'Actor', exact: true })).toBeEnabled();
  await save(page, file, /actor P\d+ as Actor/);
  const source = await fs.readFile(file, 'utf8');
  const actor = /actor (P\d+) as Actor/.exec(source)[1];
  expect(source).toMatch(new RegExp(`${actor}->>U: Mensaje`));
  expect(source).not.toContain('Actor->>');
  await reopen(page, 'secuencia');
  await expect(page.locator('.et-canvas .mw-svg-host svg:visible')).toContainText('Actor');
  await expect(page.locator('.et-canvas .mw-svg-host svg:visible')).toContainText('Mensaje');
});

test('ER permite editar y borrar atributos y modificar cardinalidad sin código @smoke', async ({ studio, page }, info) => {
  const file = await create(page, studio, 'er');
  await select(page, 'USUARIO');
  const original = await fs.readFile(file, 'utf8');
  const type = page.getByLabel('Tipo del atributo 1', { exact: true });
  await type.fill('tipo imposible');
  await type.press('Enter');
  await expect(page.getByText('No se pudo aplicar el cambio: produciría un diagrama inválido. Se conserva el diagrama anterior.', { exact: true })).toBeVisible();
  await expect(type).toHaveValue('int');
  expect(await fs.readFile(file, 'utf8')).toBe(original);
  await page.getByRole('alert').filter({ hasText: 'No se pudo aplicar el cambio: produciría un diagrama inválido.' }).getByRole('button', { name: 'Cerrar aviso', exact: true }).click();
  await select(page, 'USUARIO');
  await commit(page, 'Nombre del atributo 2', 'alias');
  await commit(page, 'Tipo del atributo 2', 'varchar');
  await page.getByLabel('UK del atributo 2', { exact: true }).check();
  await expect(page.getByLabel('UK del atributo 2', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Borrar atributo 3', exact: true }).click();
  await expect(page.getByLabel('Nombre del atributo 3', { exact: true })).toHaveCount(0);
  await save(page, file, /varchar alias UK/);
  expect(await fs.readFile(file, 'utf8')).not.toContain('string email');
  await page.getByRole('button', { name: /^Deshacer \(/ }).click();
  await select(page, 'USUARIO');
  await expect(page.getByLabel('Nombre del atributo 3', { exact: true })).toHaveValue('email');
  await page.getByRole('button', { name: /^Deshacer \(/ }).focus();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await select(page, 'USUARIO');
  await expect(page.getByLabel('Nombre del atributo 3', { exact: true })).toHaveCount(0);
  await select(page, 'USUARIO → PEDIDO: realiza');
  await page.getByLabel('Cardinalidad de origen', { exact: true }).selectOption({ label: 'Cero o uno' });
  await page.getByLabel('Cardinalidad de destino', { exact: true }).selectOption({ label: 'Uno o varios' });
  await page.getByLabel('Tipo de relación', { exact: true }).selectOption({ label: 'No identificadora' });
  await save(page, file, /USUARIO \|o\.\.\|\{ PEDIDO/);
  await reopen(page, 'er');
  await select(page, 'USUARIO');
  await expect(page.getByLabel('Nombre del atributo 2', { exact: true })).toHaveValue('alias');
  await expect(page.getByLabel('UK del atributo 2', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Nombre del atributo 3', { exact: true })).toHaveCount(0);
  await info.attach('er-atributos.png', { body: await page.screenshot(), contentType: 'image/png' });
});

test('clases permite editar miembros, borrarlos y elegir relación y cardinalidad @smoke', async ({ studio, page }, info) => {
  const file = await create(page, studio, 'clases');
  await select(page, 'Usuario');
  await commit(page, 'Nombre del miembro 1', 'alias');
  await commit(page, 'Tipo del miembro 1', 'String');
  await page.getByLabel('Visibilidad del miembro 1', { exact: true }).selectOption({ label: 'Privado' });
  await page.getByRole('button', { name: 'Borrar miembro 2', exact: true }).click();
  await expect(page.getByLabel('Nombre del miembro 2', { exact: true })).toHaveValue('iniciarSesion');
  await select(page, 'Usuario → Pedido: realiza');
  await page.getByLabel('Tipo de relación', { exact: true }).selectOption({ label: 'Agregación' });
  await commit(page, 'Cardinalidad de origen', '0..1');
  await commit(page, 'Cardinalidad de destino', '1..*');
  await save(page, file, /Usuario "0\.\.1" o-- "1\.\.\*" Pedido/);
  const source = await fs.readFile(file, 'utf8');
  expect(source).toContain('-String alias');
  expect(source).not.toContain('+String email');
  await reopen(page, 'clases');
  await select(page, 'Usuario');
  await expect(page.getByLabel('Nombre del miembro 1', { exact: true })).toHaveValue('alias');
  await expect(page.getByLabel('Visibilidad del miembro 1', { exact: true })).toHaveValue('-');
  await info.attach('clases-miembros.png', { body: await page.screenshot(), contentType: 'image/png' });
});

test('sectores añade nombres únicos y rechaza etiquetas duplicadas sin perder la fuente @smoke', async ({ studio, page }) => {
  const file = await create(page, studio, 'sectores');
  const form = page.getByRole('region', { name: 'Formulario de Sectores', exact: true });
  for (let i = 0; i < 2; i++) {
    await form.getByRole('button', { name: 'Añadir sector', exact: true }).click();
    await expect(form.getByRole('status')).toContainText('Diagrama actualizado');
    await expect(form.getByRole('button', { name: 'Añadir sector', exact: true })).toBeEnabled();
  }
  const labels = form.getByLabel('Etiqueta', { exact: true });
  await expect(labels).toHaveCount(5);
  await expect(labels.nth(3)).toHaveValue('Nuevo sector');
  await expect(labels.nth(4)).toHaveValue('Nuevo sector 2');
  await save(page, file, /"Nuevo sector 2"\s*:\s*10/);
  const before = await fs.readFile(file, 'utf8');
  await labels.nth(4).fill('Nuevo sector');
  await form.getByRole('button', { name: 'Aplicar cambios', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Cada sector debe tener una etiqueta diferente');
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  await expect(page.locator('.et-canvas .mw-svg-host svg:visible')).toContainText('Nuevo sector 2');
  await form.getByRole('button', { name: 'Descartar campos', exact: true }).click();
  await reopen(page, 'sectores');
  await expect(labels.nth(4)).toHaveValue('Nuevo sector 2');
});

test('cerrar desde un atributo pendiente conserva el cambio del blur como borrador @smoke', async ({ studio, page }) => {
  const file = await create(page, studio, 'er');
  await select(page, 'USUARIO');
  await page.getByLabel('Nombre del atributo 2', { exact: true }).fill('alias_recuperable');
  await reopen(page, 'er');
  const restore = page.getByRole('button', { name: 'Restaurar borrador', exact: true });
  await select(page, 'USUARIO');
  const field = page.getByLabel('Nombre del atributo 2', { exact: true });
  await expect.poll(async () => await restore.isVisible() || await field.inputValue() === 'alias_recuperable').toBe(true);
  if (await restore.isVisible()) {
    await restore.click();
    await select(page, 'USUARIO');
  }
  await expect(field).toHaveValue('alias_recuperable');
  await expect(page.locator('.et-canvas .mw-svg-host svg:visible')).toContainText('alias_recuperable');
  await save(page, file, /string alias_recuperable/);
});
