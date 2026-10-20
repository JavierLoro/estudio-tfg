import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { DIAGRAM_TEMPLATES } from '../../web/src/lib/diagramTemplates.ts';

const cases = [
  ['gantt', 'Nombre', 'Diseño', 'Diseño revisado'],
  ['cronologia', 'Periodo', 'Enero', 'Inicio'],
  ['mapa-mental', 'Texto', 'Bibliografía', 'Referencias'],
  ['c4', 'Nombre', 'Aplicación', 'Editor'],
  ['kanban', 'Texto', 'Documentar la API', 'Documentar el editor'],
  ['requisitos', 'Descripción', 'El usuario puede consultar documentos', 'El usuario puede leer notas'],
  ['sectores', 'Etiqueta', 'Investigación', 'Lectura'],
  ['cuadrantes', 'Etiqueta', 'Buscador', 'Biblioteca'],
  ['sankey', 'Origen', 'Fuentes', 'Recursos'],
];

test('crea y edita los nueve tipos por formulario, teclado y código @smoke', async ({ studio, page }, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  await studio.biblioteca();
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diagramas', exact: true }).click();
  for (const [id, label, before, after] of cases) {
    const template = DIAGRAM_TEMPLATES.find(t => t.id === id);
    await page.getByRole('button', { name: 'Nuevo diagrama', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo diagrama' });
    await dialog.getByLabel('Nombre', { exact: true }).fill(`prueba-${id}`);
    const picker = dialog.getByRole('group', { name: 'Tipo de diagrama' });
    await picker.focus();
    for (let i = 0; i < DIAGRAM_TEMPLATES.indexOf(template); i++) await picker.press('ArrowRight');
    await expect(picker.getByRole('heading', { name: template.label, exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Crear', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const file = path.join(studio.root, `memoria/diagramas/prueba-${id}.mmd`);
    const form = page.getByRole('region', { name: /^Formulario de / });
    await expect(form).toBeVisible();
    await expect.poll(() => fs.readFile(file, 'utf8')).toBe(template.source);
    const fields = form.getByLabel(label, { exact: true });
    const field = fields.filter({ visible: true });
    let target;
    for (const candidate of await field.all()) if (await candidate.inputValue() === before) { target = candidate; break; }
    expect(target, `${id}: campo editable`).toBeTruthy();
    await target.fill(after);
    await target.press('Enter');
    await expect(form.getByRole('status')).toContainText('Diagrama actualizado');
    await expect(target).toBeFocused();
    await page.getByRole('button', { name: /^Guardar \(/ }).click();
    const edited = template.source.replace(before, after);
    await expect.poll(() => fs.readFile(file, 'utf8')).toBe(edited);
    await page.getByRole('button', { name: /^Deshacer \(/ }).click();
    await page.getByRole('button', { name: /^Guardar \(/ }).click();
    await expect.poll(() => fs.readFile(file, 'utf8')).toBe(template.source);
    const codeButton = page.getByRole('button', { name: 'Código', exact: true });
    if (await codeButton.getAttribute('aria-pressed') !== 'true') await codeButton.click();
    const editor = page.locator('.cm-content:visible').last();
    await editor.fill(edited);
    await editor.press('ControlOrMeta+s');
    await expect.poll(() => fs.readFile(file, 'utf8')).toBe(edited);
    await expect.poll(() => form.getByLabel(label, { exact: true }).evaluateAll(nodes => nodes.map(node => node.value))).toContain(after);
    await codeButton.click();
    await expect(editor).not.toBeVisible();
    const [add, added] = {
      gantt: ['Añadir tarea', 'Nueva tarea'], cronologia: ['Añadir hito', 'Nuevo acontecimiento'],
      'mapa-mental': ['Añadir rama', 'Nueva idea'], c4: ['Añadir persona', 'Nueva persona'],
      kanban: ['Añadir hijo', 'nuevo1[Nueva tarjeta]'], requisitos: ['Añadir requisito', 'Nuevo requisito'],
      sectores: ['Añadir sector', 'Nuevo sector'], cuadrantes: ['Añadir punto', 'Nuevo punto'],
      sankey: ['Añadir flujo', 'Nuevo origen'],
    }[id];
    await form.getByRole('button', { name: add, exact: true }).first().click();
    await expect(form.getByRole('status')).toContainText('Diagrama actualizado');
    await page.getByRole('button', { name: /^Guardar \(/ }).click();
    await expect.poll(() => fs.readFile(file, 'utf8')).toContain(added);
    await expect(page.locator('.et-canvas .mw-svg-host svg:visible').last()).toContainText(id === 'kanban' ? 'Nueva tarjeta' : added);
    await info.attach(`${id}-formulario.png`, { body: await page.screenshot(), contentType: 'image/png' });
  }
});

test('los campos inválidos no modifican la fuente y ocultar el formulario conserva los pendientes @smoke', async ({ studio, page }) => {
  const dir = path.join(studio.root, 'memoria/diagramas');
  await fs.mkdir(dir);
  const source = DIAGRAM_TEMPLATES.find(t => t.id === 'sectores').source;
  const file = path.join(dir, 'prueba.mmd');
  await fs.writeFile(file, source);
  await studio.biblioteca();
  await page.keyboard.press('ControlOrMeta+k');
  const open = page.getByRole('dialog', { name: 'Abrir o buscar' });
  await open.getByLabel('Buscar', { exact: true }).fill('prueba.mmd');
  await open.getByRole('option').filter({ hasText: 'prueba.mmd' }).first().click();
  const form = page.getByRole('region', { name: 'Formulario de Sectores' });
  const first = form.getByLabel('Etiqueta', { exact: true }).first();
  await first.fill('Texto " inválido');
  await form.getByRole('button', { name: 'Aplicar cambios', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('delimitadores');
  await expect(form.getByRole('button', { name: 'Añadir sector' })).toBeDisabled();
  await page.getByRole('button', { name: 'Ocultar formulario', exact: true }).click();
  await page.getByRole('button', { name: 'Mostrar formulario', exact: true }).click();
  await expect(first).toHaveValue('Texto " inválido');
  expect(await fs.readFile(file, 'utf8')).toBe(source);
  await fs.writeFile(file, source + '%% Cambio externo ficticio\n');
  await expect(form.getByRole('alert').filter({ hasText: 'La fuente cambió' })).toBeVisible();
  await expect(first).toHaveValue('Texto " inválido');
  await expect(form.getByRole('button', { name: 'Aplicar cambios' })).toBeDisabled();
  await form.getByRole('button', { name: 'Descartar campos', exact: true }).click();
  await expect(first).toHaveValue('Investigación');
  await form.getByRole('button', { name: 'Añadir sector', exact: true }).click();
  await expect(form.getByLabel('Etiqueta', { exact: true }).last()).toHaveValue('Nuevo sector');
  await form.getByRole('button', { name: 'Eliminar', exact: true }).last().click();
  await expect(form.getByLabel('Etiqueta', { exact: true })).toHaveCount(3);
});

test('Sankey explica la limitación de Unicode sin modificar la fuente @smoke', async ({ studio, page }) => {
  const source = DIAGRAM_TEMPLATES.find(t => t.id === 'sankey').source;
  const dir = path.join(studio.root, 'memoria/diagramas');
  await fs.mkdir(dir);
  const file = path.join(dir, 'sankey.mmd');
  await fs.writeFile(file, source);
  await studio.biblioteca();
  await page.keyboard.press('ControlOrMeta+k');
  const open = page.getByRole('dialog', { name: 'Abrir o buscar' });
  await open.getByLabel('Buscar', { exact: true }).fill('sankey.mmd');
  await open.getByRole('option').filter({ hasText: 'sankey.mmd' }).first().click();
  const form = page.getByRole('region', { name: 'Formulario de Sankey' });
  await form.getByLabel('Origen', { exact: true }).first().fill('Investigación');
  await form.getByRole('button', { name: 'Aplicar cambios' }).click();
  await expect(form.getByRole('alert')).toContainText('ASCII');
  expect(await fs.readFile(file, 'utf8')).toBe(source);
});
