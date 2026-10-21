import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
async function desktop(page) {
  await page.route('**/api/desktop/setup', r => r.fulfill({ json: { needsSetup: false, engine: { phase: 'ready', available: true, installed: true, current: true } } }));
  await page.addInitScript(() => localStorage.setItem('et:chatgpt:welcome:cuenta-contexto-ficticia', 'true'));
}
const body = v => ({ baseRev: v.rev, project: v.project, account: v.account });
test('contexto desactivado, selección sin frontmatter, revisión y exclusión @contexto', async ({ studio, page }) => {
  await desktop(page); await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Notas', exact: true }).click();
  await page.getByRole('treeitem', { name: 'Nota.md', exact: true }).click();
  const check = page.getByRole('checkbox', { name: 'Incluir en el contexto del TFG', exact: true });
  await expect(check).toBeVisible(); await check.check();
  const original = await fs.readFile(path.join(studio.root, 'notes/Nota.md'), 'utf8');
  expect(original).not.toContain('contexto:'); expect((await studio.json('/api/assistant/context')).selection.mode).toBe('off');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Ajustes', exact: true });
  await settings.getByRole('tab', { name: 'Asistente', exact: true }).click();
  const ctx = settings.getByRole('region', { name: 'Contexto del TFG', exact: true });
  await ctx.getByLabel('Tema', { exact: true }).fill('Tema ficticio confirmado');
  await ctx.getByLabel('Modo del contexto').selectOption('partial');
  await ctx.getByRole('button', { name: 'Guardar ficha y selección' }).click();
  await ctx.getByRole('checkbox', { name: 'Elaborar propuestas desde las fuentes seleccionadas' }).click();
  await expect(ctx.getByRole('checkbox', { name: 'Elaborar propuestas desde las fuentes seleccionadas' })).toBeChecked();
  await ctx.getByRole('checkbox', { name: 'Usar el contexto revisado en acciones elegidas' }).click();
  await expect(ctx.getByRole('checkbox', { name: 'Usar el contexto revisado en acciones elegidas' })).toBeChecked();
  await ctx.getByLabel('Modelo para contexto').selectOption('modelo-contexto-ficticio');
  await ctx.getByRole('button', { name: 'Actualizar contexto', exact: true }).click();
  await expect(ctx.getByRole('button', { name: 'Aceptar actualización' })).toBeVisible();
  await ctx.getByRole('textbox', { name: 'Corregir contexto Nota.md 0' }).fill('Contexto corregido ficticio');
  await ctx.getByRole('button', { name: 'Aceptar actualización' }).click();
  await expect.poll(async () => (await studio.json('/api/assistant/context')).effective.text).toContain('Contexto corregido ficticio');
  await settings.getByRole('button', { name: 'Cerrar ajustes' }).click();
  await check.uncheck();
  await expect.poll(async () => (await studio.json('/api/assistant/context')).effective.text).not.toContain('Contexto corregido ficticio');
  expect(await fs.readFile(path.join(studio.root, 'notes/Nota.md'), 'utf8')).toBe(original);
  await page.reload(); expect((await studio.json('/api/assistant/context')).profile.topic).toBe('Tema ficticio confirmado');
});

test('diagrama propuesto, render seguro, sintaxis inválida y creación exclusiva @contexto', async ({ studio, page }) => {
  await desktop(page); let v = await studio.json('/api/assistant/context');
  await studio.json('/api/assistant/context', { method: 'POST', data: { ...body(v), grants: { ...v.grants, prepareDiagrams: true } } });
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diagramas', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo diagrama', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo diagrama', exact: true });
  await dialog.getByLabel('Nombre', { exact: true }).fill('propuesta-ficticia');
  await dialog.getByRole('button', { name: 'Con asistente', exact: true }).click();
  await dialog.getByLabel('Descripción del diagrama').fill('Un proceso ficticio');
  await dialog.getByLabel('Modelo para diagrama').selectOption('modelo-contexto-ficticio');
  const create = dialog.getByRole('button', { name: 'Crear diagrama', exact: true });
  await expect(create).toBeDisabled(); await dialog.getByRole('button', { name: 'Generar propuesta', exact: true }).click();
  await expect(dialog.getByLabel('Vista previa de la propuesta')).toBeVisible(); await expect(create).toBeEnabled();
  const target = path.join(studio.root, 'memoria/diagramas/propuesta-ficticia.mmd');
  await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  const code = dialog.getByLabel('Código de la propuesta'), original = await code.inputValue();
  await code.fill('diagrama que no existe'); await expect(create).toBeDisabled();
  await expect(dialog.getByText('No se puede dibujar la propuesta.', { exact: false })).toBeVisible();
  await code.fill(original); await expect(create).toBeEnabled();
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, 'flowchart LR\n ocupado-->intacto\n');
  await create.click(); await expect(dialog).toBeVisible(); expect(await fs.readFile(target, 'utf8')).toContain('ocupado-->intacto');
  await dialog.getByLabel('Nombre', { exact: true }).fill('propuesta-final'); await create.click();
  await expect(dialog).not.toBeVisible(); expect(await fs.readFile(path.join(studio.root, 'memoria/diagramas/propuesta-final.mmd'), 'utf8')).toBe(original.endsWith('\n') ? original : original + '\n');
  await expect(fs.stat(path.join(studio.root, 'memoria/figuras/diagramas/propuesta-final.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('las propuestas de los quince tipos se recuperan y se dibujan @contexto', async ({ studio, page }) => {
  test.setTimeout(120_000); await desktop(page);
  let v = await studio.json('/api/assistant/context');
  await studio.json('/api/assistant/context', { method: 'POST', data: { ...body(v), grants: { ...v.grants, prepareDiagrams: true } } });
  const types = ['flujo', 'secuencia', 'estados', 'arquitectura', 'er', 'clases', 'gantt', 'cronologia', 'mapa-mental', 'c4', 'kanban', 'requisitos', 'sectores', 'cuadrantes', 'sankey'];
  const ids = [];
  for (const type of types) {
    v = await studio.json('/api/assistant/context');
    const r = await studio.json('/api/assistant/diagram-generations', { method: 'POST', data: { ...body(v), model: 'modelo-contexto-ficticio', name: 'tipo-' + type, type, description: 'Ejemplo ficticio' } }); ids.push(r.id);
    await expect.poll(async () => (await studio.json('/api/assistant/diagram-generations')).items.find(d => d.id === r.id)?.state).toBe('prepared');
  }
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diagramas', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo diagrama', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo diagrama', exact: true });
  await dialog.getByRole('button', { name: 'Con asistente', exact: true }).click();
  await dialog.getByLabel('Nombre', { exact: true }).fill('ficticio');
  for (const id of ids) {
    await dialog.getByLabel('Propuestas de diagramas guardadas').selectOption(id);
    await expect(dialog.getByLabel('Vista previa de la propuesta')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Crear diagrama', exact: true })).toBeEnabled();
  }
  await expect(fs.stat(path.join(studio.root, 'memoria/diagramas/ficticio.mmd'))).rejects.toMatchObject({ code: 'ENOENT' });
});
