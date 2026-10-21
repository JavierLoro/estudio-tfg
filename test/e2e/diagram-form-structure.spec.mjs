import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { DIAGRAM_TEMPLATES } from '../../web/src/lib/diagramTemplates.ts';

async function create(page, id, name) {
  const section = page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diagramas', exact: true });
  if (await section.getAttribute('aria-pressed') !== 'true') await section.click();
  await page.getByRole('button', { name: 'Nuevo diagrama', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo diagrama' });
  await dialog.getByLabel('Nombre', { exact: true }).fill(name);
  const picker = dialog.getByRole('group', { name: 'Tipo de diagrama' });
  await picker.focus();
  for (let i = 0; i < DIAGRAM_TEMPLATES.findIndex(t => t.id === id); i++) await picker.press('ArrowRight');
  await dialog.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const form = page.getByRole('region', { name: /^Formulario de / });
  await expect(form).toBeVisible();
  return form;
}
async function rowByValue(form, label, value) {
  for (const row of await form.locator('fieldset fieldset').all()) {
    const fields = row.getByLabel(label, { exact: true });
    if (await fields.count() && await fields.first().inputValue() === value) return row;
  }
  throw new Error(`No se encuentra la fila ${label}: ${value}`);
}
async function changed(form) {
  await expect(form.getByRole('status')).toContainText('Diagrama actualizado');
  await expect(form.getByRole('alert')).toHaveCount(0);
}
async function apply(form) {
  await form.getByRole('button', { name: 'Aplicar cambios', exact: true }).click();
  await changed(form);
}
async function saved(page, file) {
  await page.getByRole('button', { name: /^Guardar \(/ }).click();
  await expect(page.getByText('Todo guardado', { exact: true })).toBeVisible();
  return fs.readFile(file, 'utf8');
}

test('Gantt edita estado, hito, dependencias y secciones solo con controles @smoke', async ({ studio, page }) => {
  test.setTimeout(90_000);
  await studio.biblioteca();
  const form = await create(page, 'gantt', 'gantt-controles');
  const file = path.join(studio.root, 'memoria/diagramas/gantt-controles.mmd');
  let task = await rowByValue(form, 'Nombre', 'Implementación');
  await task.getByLabel('Estado de tarea', { exact: true }).selectOption('active');
  await task.getByLabel('Prioridad de tarea', { exact: true }).selectOption('crit');
  await task.getByLabel('Tipo de tarea', { exact: true }).selectOption('milestone');
  await task.getByLabel('Dependencias', { exact: true }).selectOption(['diseno']);
  await task.getByLabel('Fin o duración', { exact: true }).fill('0d');
  await task.getByLabel('Fin o duración', { exact: true }).press('Enter');
  await changed(form);
  expect(await saved(page, file)).toContain('active, crit, milestone, codigo, after diseno, 0d');
  await form.getByRole('button', { name: 'Añadir sección', exact: true }).click();
  await changed(form);
  task = await rowByValue(form, 'Nombre', 'Implementación');
  await task.getByLabel('Mover a', { exact: true }).selectOption({ label: 'Nueva sección' });
  await task.getByRole('button', { name: 'Mover', exact: true }).click();
  await changed(form);
  const moved = await saved(page, file);
  expect(moved).toMatch(/section Nueva sección\r?\n\s*Implementación/);
  const section = await rowByValue(form, 'Nombre de sección', 'Nueva sección');
  await section.getByRole('button', { name: 'Subir', exact: true }).click();
  await changed(form);
  const reordered = await saved(page, file);
  expect(reordered.indexOf('section Nueva sección')).toBeLessThan(reordered.indexOf('section Desarrollo'));
  const first = await rowByValue(form, 'Nombre', 'Diseño');
  await first.getByLabel('Dependencias', { exact: true }).selectOption(['codigo']);
  await form.getByRole('button', { name: 'Aplicar cambios', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('ciclo');
  expect(await fs.readFile(file, 'utf8')).toBe(reordered);
  await form.getByRole('button', { name: 'Descartar campos', exact: true }).click();
});

test('Kanban y mapa mental mueven y reordenan subárboles solo con controles @smoke', async ({ studio, page }) => {
  test.setTimeout(90_000);
  await studio.biblioteca();
  let form = await create(page, 'kanban', 'kanban-controles');
  let file = path.join(studio.root, 'memoria/diagramas/kanban-controles.mmd');
  let row = await rowByValue(form, 'Texto', 'Documentar la API');
  await row.getByLabel('Mover a', { exact: true }).selectOption({ label: 'En curso' });
  await row.getByRole('button', { name: 'Mover', exact: true }).click();
  await changed(form);
  expect(await saved(page, file)).toMatch(/en_curso\[En curso\]\r?\n\s*implementar[^\r\n]+\r?\n\s*documentar/);
  row = await rowByValue(form, 'Texto', 'Documentar la API');
  await row.getByRole('button', { name: 'Subir', exact: true }).click();
  await changed(form);
  expect(await saved(page, file)).toMatch(/en_curso\[En curso\]\r?\n\s*documentar/);
  const column = await rowByValue(form, 'Texto', 'Terminado');
  await column.getByRole('button', { name: 'Subir', exact: true }).click();
  await changed(form);
  const kanban = await saved(page, file);
  expect(kanban.indexOf('terminado[')).toBeLessThan(kanban.indexOf('en_curso['));
  form = await create(page, 'mapa-mental', 'mapa-controles');
  file = path.join(studio.root, 'memoria/diagramas/mapa-controles.mmd');
  row = await rowByValue(form, 'Texto', 'Investigación');
  await expect(row.getByLabel('Mover a', { exact: true }).locator('option', { hasText: 'Bibliografía' })).toHaveCount(0);
  await row.getByLabel('Mover a', { exact: true }).selectOption({ label: 'Desarrollo' });
  await row.getByRole('button', { name: 'Mover', exact: true }).click();
  await changed(form);
  const moved = await saved(page, file);
  expect(moved).toContain('      Investigación\n        Bibliografía\n        Entrevistas');
  row = await rowByValue(form, 'Texto', 'Investigación');
  await row.getByRole('button', { name: 'Subir', exact: true }).click();
  await changed(form);
  const reordered = await saved(page, file);
  expect(reordered.indexOf('      Investigación')).toBeLessThan(reordered.indexOf('      Validación'));
  const root = await rowByValue(form, 'Texto', 'Proyecto');
  await expect(root.getByRole('button', { name: 'Mover', exact: true })).toHaveCount(0);
  await expect(root.getByRole('button', { name: 'Eliminar', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Guardar \(/ }).focus();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await saved(page, file)).toBe(moved);
});

test('elimina nodos C4 y requisitos junto con sus relaciones sin código @smoke', async ({ studio, page }) => {
  await studio.biblioteca();
  let form = await create(page, 'c4', 'c4-controles');
  let file = path.join(studio.root, 'memoria/diagramas/c4-controles.mmd');
  await form.getByRole('group', { name: 'Persona o sistema: biblioteca', exact: true }).getByRole('button', { name: 'Eliminar', exact: true }).click();
  await changed(form);
  let source = await saved(page, file);
  expect(source).not.toContain('biblioteca');
  expect(source).toContain('Person(usuario');
  expect(source).toContain('System(app');
  form = await create(page, 'requisitos', 'requisitos-controles');
  file = path.join(studio.root, 'memoria/diagramas/requisitos-controles.mmd');
  await form.getByRole('group', { name: 'Elemento: visor', exact: true }).getByRole('button', { name: 'Eliminar', exact: true }).click();
  await changed(form);
  source = await saved(page, file);
  expect(source).not.toContain('visor');
  expect(source).not.toContain('satisfies');
  expect(source).toContain('requirement acceso');
  await expect(page.locator('.et-canvas .mw-svg-host svg:visible').last()).toContainText('RF1');
});
