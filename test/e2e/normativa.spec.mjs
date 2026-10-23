import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { pdfFixture } from '../pdf-fixture.ts';

const body = r => ({ account: r.account, project: r.project, baseRev: r.rev });
async function desktop(page) {
  await page.route('**/api/desktop/setup', r => r.fulfill({ json: { needsSetup: false, engine: { phase: 'ready', available: true, installed: true, current: true } } }));
}
async function start(studio, page) {
  await desktop(page); await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Crear desde normativa…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Crear plantilla desde normativa', exact: true });
}
test('normativa: PDF, dudas, revisión editable y creación guiada @contexto @smoke', async ({ studio, page }, info) => {
  const original = await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8');
  const dialog = await start(studio, page);
  await dialog.getByLabel('Documento de normativa', { exact: true }).setInputFiles({ name: 'normativa-ficticia.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await dialog.getByLabel('Modelo para normativa', { exact: true }).selectOption('modelo-contexto-ficticio');
  const analyze = dialog.getByRole('button', { name: 'Analizar con ChatGPT', exact: true });
  await expect(analyze).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Enviar esta normativa a ChatGPT para preparar una plantilla', exact: true }).check();
  await analyze.click();
  await expect(dialog.getByText('Lista para revisar', { exact: true })).toBeVisible();
  const review = dialog.getByRole('button', { name: 'Revisar configuración', exact: true });
  await expect(review).toBeDisabled();
  await expect(dialog.getByRole('table')).toContainText('Margen interior');
  expect(await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8')).toBe(original);
  await dialog.getByRole('button', { name: 'Ver normativa', exact: true }).click();
  const source = page.getByRole('dialog', { name: 'normativa-ficticia.pdf', exact: true });
  await expect(source.locator('.page[data-page-number="1"]')).toBeVisible();
  await source.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await dialog.getByRole('button', { name: '20 mm', exact: true }).click();
  await dialog.getByRole('button', { name: 'Analizar respuestas con ChatGPT', exact: true }).click();
  await expect(dialog.getByRole('group', { name: 'Dudas por resolver', exact: true })).not.toBeVisible();
  await expect(dialog.getByText('Lista para revisar', { exact: true })).toBeVisible();
  await expect(review).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'He revisado estas limitaciones', exact: true }).check();
  await expect(review).toBeEnabled();
  await page.screenshot({ path: info.outputPath('normativa-propuesta.png') });
  await review.click();
  const wizard = page.getByRole('dialog', { name: 'Revisar plantilla de la normativa', exact: true });
  await wizard.getByLabel('Título del trabajo', { exact: true }).fill('Memoria ficticia desde normativa');
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(wizard.getByLabel('Izquierdo', { exact: true })).toHaveValue('35');
  await expect(wizard.getByLabel('Derecho', { exact: true })).toHaveValue('20');
  await wizard.getByLabel('Superior', { exact: true }).fill('28');
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(wizard.getByLabel('Fuente del texto', { exact: true })).toHaveValue('latinmodern');
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(wizard.getByText('Evaluación', { exact: true })).toBeVisible();
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await wizard.getByRole('button', { name: 'Elegir ubicación…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Guardar la nueva memoria', exact: true }).getByRole('button', { name: 'Usar esta ubicación', exact: true }).click();
  await wizard.getByRole('button', { name: 'Crear memoria', exact: true }).click();
  await expect(wizard).not.toBeVisible(); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('tab', { name: 'tfg.tex', exact: false })).toBeVisible();
  const data = await studio.json('/api/memoria/datos');
  expect(data.datos.titulo).toBe('Memoria ficticia desde normativa');
  expect(data.institucion).toMatchObject({ margenInterior: '35mm', margenExterior: '20mm', margenSuperior: '28mm', fuenteTexto: 'latinmodern' });
  expect(await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8')).toBe(original);
  const dir = (await studio.json('/api/settings')).values.memoriaDir;
  expect(await fs.readdir(path.join(dir, '1-capitulos'))).toHaveLength(3);
});
test('normativa: cerrar conserva la propuesta y cambiar de análisis retira el consentimiento @contexto', async ({ studio, page }, info) => {
  const dialog = await start(studio, page);
  await page.setViewportSize({ width: 480, height: 850 });
  await dialog.getByLabel('Documento de normativa').setInputFiles({ name: 'normativa.txt', mimeType: 'text/plain', buffer: Buffer.from('Normativa ficticia: 35 mm de margen interior.') });
  await dialog.getByLabel('Modelo para normativa').selectOption('modelo-contexto-ficticio');
  await dialog.getByRole('checkbox', { name: 'Enviar esta normativa a ChatGPT para preparar una plantilla', exact: true }).check();
  await dialog.getByRole('button', { name: 'Analizar con ChatGPT', exact: true }).click();
  await expect(dialog.getByText('Lista para revisar', { exact: true })).toBeVisible();
  const id = (await studio.json('/api/assistant/template-generations')).items[0].id;
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('normativa-estrecha.png') });
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Crear desde normativa…', exact: true }).click();
  await expect(dialog.getByText('Lista para revisar', { exact: true })).toBeVisible();
  expect((await studio.json('/api/assistant/template-generations')).items[0].id).toBe(id);
  await dialog.getByLabel('Propuestas de normativa guardadas').selectOption('');
  await expect(dialog.getByRole('checkbox', { name: 'Enviar esta normativa a ChatGPT para preparar una plantilla', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Analizar con ChatGPT', exact: true })).toBeDisabled();
  expect((await studio.json('/api/settings')).values.memoriaDir).toBe(path.join(studio.root, 'memoria'));
});
test('normativa: la configuración revisada genera un PDF sin avisos @contexto @worker', async ({ studio }) => {
  test.skip(!process.env.E2E_WORKER_URL, 'Requiere un worker real de pruebas');
  const view = await studio.json('/api/assistant/template-generations');
  const sent = await studio.json('/api/assistant/template-generations', { method: 'POST', multipart: {
    metadata: JSON.stringify({ project: view.project, account: view.account, model: 'modelo-contexto-ficticio', consent: true }),
    file: { name: 'normativa.pdf', mimeType: 'application/pdf', buffer: pdfFixture() },
  } });
  let proposal;
  await expect.poll(async () => { proposal = (await studio.json('/api/assistant/template-generations')).items.find(r => r.id === sent.id); return proposal.state; }).toBe('prepared');
  await studio.json('/api/assistant/template-generations/' + sent.id + '/answers', { method: 'POST', data: { ...body(proposal), answers: { margen: '20 mm' } } });
  await expect.poll(async () => { proposal = (await studio.json('/api/assistant/template-generations')).items.find(r => r.id === sent.id); return proposal.dudas.length; }).toBe(0);
  await studio.json('/api/assistant/template-generations/' + sent.id + '/create', { method: 'POST', data: {
    ...body(proposal), dir: path.join(studio.root, 'generada'), configuracion: proposal.config, acceptLimitations: true,
  } });
  const compiled = await studio.json('/api/compile', { method: 'POST' });
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true); expect(compiled.diagnostics).toEqual([]);
  const log = await fs.readFile(path.join(process.env.E2E_WORKER_OUT, compiled.buildId, 'main.log'), 'utf8');
  expect(log).not.toMatch(/LaTeX Font Warning:|Missing character:/);
});
