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
test('normativa: genera desde PDF, descarta supuestos, corrige y guarda con comparación de PDF @contexto @worker @smoke', async ({ studio, page }, info) => {
  test.skip(!process.env.E2E_WORKER_URL, 'Requiere un worker real de pruebas');
  test.setTimeout(180_000);
  const original = await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8');
  const dialog = await start(studio, page);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByLabel('Documento de normativa', { exact: true }).setInputFiles({ name: 'normativa-ficticia.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Generar plantilla con ChatGPT', exact: true }).click();
  await expect(dialog.getByText('Plantilla preparada', { exact: true })).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Guardar y abrir…', exact: true });
  await expect(save).toBeDisabled();
  await expect(dialog.getByRole('group', { name: 'Dudas por resolver' })).toHaveCount(0);
  const notices = dialog.getByRole('region', { name: 'Supuestos a revisar', exact: true });
  await expect(notices.getByText(/Se ha elegido un margen exterior/)).toBeVisible();
  await notices.getByRole('button', { name: 'Descartar aviso 1', exact: true }).click();
  await expect(notices.getByText(/Se ha elegido un margen exterior/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Ver normativa', exact: true }).click();
  const source = page.getByRole('dialog', { name: 'normativa-ficticia.pdf', exact: true });
  await expect(source.locator('.page[data-page-number="1"]')).toBeVisible();
  await source.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await dialog.getByLabel('Qué quieres corregir', { exact: true }).fill('Pon el margen superior a 28 mm');
  await dialog.getByRole('button', { name: 'Aplicar corrección', exact: true }).click();
  await expect(dialog.getByText('Plantilla preparada', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Qué quieres corregir')).toHaveValue('');
  await dialog.getByText('Ajustes aplicados', { exact: true }).click();
  await expect(dialog.getByRole('table')).toContainText('28mm');
  await expect(notices.getByText(/Se ha elegido un margen exterior/)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('normativa-simple-corregida.png') });
  await dialog.getByRole('button', { name: 'Comparar PDF', exact: true }).click();
  const compare = page.getByRole('dialog', {name:'Comparar estilo', exact:true});
  await expect(compare).toBeVisible({timeout:120_000});
  await expect(compare.getByRole('region', {name:'Actual',exact:true}).locator('.page[data-page-number="1"]')).toBeVisible({timeout:30_000});
  await expect(compare.getByRole('region', {name:'Propuesta',exact:true}).locator('.page[data-page-number="1"]')).toBeVisible();
  await page.screenshot({path:info.outputPath('comparacion-pdf.png')});
  await compare.getByRole('button',{name:'Aplicar propuesta',exact:true}).click();
  await expect(save).toBeEnabled();
  await save.click();
  const picker = page.getByRole('dialog', { name: 'Guardar la plantilla', exact: true });
  await picker.getByRole('button', { name: 'Guardar y abrir', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('tab', { name: 'tfg.tex', exact: false })).toBeVisible();
  const data = await studio.json('/api/memoria/datos');
  expect(data.institucion).toMatchObject({ margenInterior: '35mm', margenExterior: '20mm', margenSuperior: '28mm', fuenteTexto: 'latinmodern' });
  expect(await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8')).toBe(original);
  const dir = (await studio.json('/api/settings')).values.memoriaDir;
  expect(await fs.readdir(path.join(dir, '1-capitulos'))).toHaveLength(3);
});
test('normativa: cerrar conserva la propuesta y reanudar conserva los avisos descartados @contexto', async ({ studio, page }, info) => {
  const dialog = await start(studio, page);
  await page.setViewportSize({ width: 480, height: 850 });
  await dialog.getByLabel('Documento de normativa').setInputFiles({ name: 'normativa.txt', mimeType: 'text/plain', buffer: Buffer.from('Normativa ficticia: 35 mm de margen interior.') });
  await dialog.getByRole('button', { name: 'Generar plantilla con ChatGPT', exact: true }).click();
  await expect(dialog.getByText('Plantilla preparada', { exact: true })).toBeVisible();
  const id = (await studio.json('/api/assistant/template-generations')).items[0].id;
  await dialog.getByRole('button', { name: 'Descartar aviso 1', exact: true }).click();
  await expect(dialog.getByText(/Se ha elegido un margen exterior/)).toHaveCount(0);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('normativa-estrecha.png') });
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Crear desde normativa…', exact: true }).click();
  await expect(dialog.getByText('Plantilla preparada', { exact: true })).toBeVisible();
  expect((await studio.json('/api/assistant/template-generations')).items[0].id).toBe(id);
  await expect(dialog.getByText(/Se ha elegido un margen exterior/)).toHaveCount(0);
  await dialog.getByLabel('Análisis anteriores').selectOption('');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Generar plantilla con ChatGPT', exact: true })).toBeDisabled();
  expect((await studio.json('/api/settings')).values.memoriaDir).toBe(path.join(studio.root, 'memoria'));
});
test('normativa: la configuración revisada genera un PDF sin avisos @contexto @worker', async ({ studio }) => {
  test.setTimeout(180_000);
  test.skip(!process.env.E2E_WORKER_URL, 'Requiere un worker real de pruebas');
  const view = await studio.json('/api/assistant/template-generations');
  const sent = await studio.json('/api/assistant/template-generations', { method: 'POST', multipart: {
    metadata: JSON.stringify({ project: view.project, account: view.account, consent: true }),
    file: { name: 'normativa.pdf', mimeType: 'application/pdf', buffer: pdfFixture() },
  } });
  let proposal;
  await expect.poll(async () => { proposal = (await studio.json('/api/assistant/template-generations')).items.find(r => r.id === sent.id); return proposal.state; }).toBe('prepared');
  await studio.json('/api/assistant/template-generations/' + sent.id + '/correct', { method: 'POST', data: { ...body(proposal), text: 'Pon el margen superior a 28 mm' } });
  await expect.poll(async () => { proposal = (await studio.json('/api/assistant/template-generations')).items.find(r => r.id === sent.id); return proposal.calls + ':' + proposal.state; }).toBe('2:prepared');
  proposal = await studio.json('/api/assistant/template-generations/' + sent.id + '/preview', {method:'POST',data:body(proposal)});
  expect(proposal.preview.ok, JSON.stringify(proposal.preview.diagnostics)).toBe(true);
  proposal = await studio.json('/api/assistant/template-generations/' + sent.id + '/apply', {method:'POST',data:body(proposal)});
  await studio.json('/api/assistant/template-generations/' + sent.id + '/create', { method: 'POST', data: {
    ...body(proposal), dir: path.join(studio.root, 'generada'),
  } });
  const compiled = await studio.json('/api/compile', { method: 'POST' });
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true); expect(compiled.diagnostics).toEqual([]);
  const log = await fs.readFile(path.join(process.env.E2E_WORKER_OUT, compiled.buildId, 'main.log'), 'utf8');
  expect(log).not.toMatch(/LaTeX Font Warning:|Missing character:/);
});

test('normativa: adjuntar antes de conectar y conservar el archivo al conectar @contexto', async ({ studio, page }, info) => {
  let connected = false, sent = 0;
  const account = () => ({ active: connected ? 'cuenta-contexto-ficticia' : null, accounts: connected ? [{ id: 'cuenta-contexto-ficticia', label: 'Ficticia', connected: true, enabled: true }] : [], pending: false, persistent: true, error: '' });
  await page.route('**/api/assistant/account', route => route.fulfill({ json: account() }));
  await page.route('**/api/assistant/account/connect', route => { connected = true; return route.fulfill({ json: account() }); });
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/assistant/template-generations')) sent++; });
  const dialog = await start(studio, page);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Conectar ChatGPT', exact: true })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Adjuntar normativa…', exact: true }).click();
  await (await chooser).setFiles({ name: 'normativa-local.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(dialog.getByText('normativa-local.pdf', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Generar plantilla con ChatGPT', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('normativa-adjunto-sin-cuenta.png') });
  expect(sent).toBe(0);
  await dialog.getByRole('button', { name: 'Conectar ChatGPT', exact: true }).click();
  const connect = page.getByRole('dialog', { name: 'Cuenta de ChatGPT', exact: true });
  await connect.getByRole('button', { name: 'Continuar con ChatGPT', exact: true }).click();
  await expect(connect.getByRole('button', { name: 'Desconectar', exact: true })).toBeVisible();
  await connect.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await expect(dialog.getByText('normativa-local.pdf', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Generar plantilla con ChatGPT', exact: true })).toBeEnabled();
  expect(sent).toBe(0);
});

test('normativa: arrastre, subida y análisis con animación accesible @contexto', async ({ studio, page }, info) => {
  let releaseUpload, holdAnalysis = true;
  const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
  await page.route('**/api/assistant/template-generations', async route => {
    const isUpload = route.request().method() === 'POST';
    if (isUpload) await uploadGate;
    const response = await route.fetch();
    const value = await response.json();
    if (!isUpload && holdAnalysis) value.items = value.items.map(item => ({ ...item, state: 'running' }));
    await route.fulfill({ response, json: value });
  });
  const dialog = await start(studio, page);
  const drop = dialog.getByRole('region', { name: 'Adjuntar normativa', exact: true });
  const transfer = await page.evaluateHandle(bytes => {
    const value = new DataTransfer();
    value.items.add(new File([new Uint8Array(bytes)], 'guia-arrastrada.pdf', { type: 'application/pdf' }));
    return value;
  }, [...pdfFixture()]);
  await drop.dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(drop.getByText('Suelta aquí la normativa', { exact: true })).toBeVisible();
  await drop.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(drop.getByText('guia-arrastrada.pdf', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Generar plantilla con ChatGPT', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Subiendo normativa…', exact: true })).toBeDisabled();
  await expect(drop).toHaveAttribute('aria-busy', 'true');
  releaseUpload();
  const progress = dialog.getByRole('status', { name: 'Análisis de normativa en curso', exact: true });
  await expect(progress).toBeVisible();
  await expect(progress.getByRole('timer')).not.toHaveText('0:00');
  await expect(dialog.getByRole('button', { name: 'Detener análisis', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('normativa-analizando.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await progress.locator('svg').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  holdAnalysis = false;
  await expect(progress).not.toBeVisible();
  await expect(dialog.getByText('Plantilla preparada', { exact: true })).toBeVisible();
});

test('normativa: rechaza varios archivos o un formato incorrecto al arrastrar @contexto', async ({ studio, page }) => {
  const dialog = await start(studio, page);
  const drop = dialog.getByRole('region', { name: 'Adjuntar normativa', exact: true });
  for (const names of [['normativa.txt', 'otra.txt'], ['programa.exe']]) {
    const transfer = await page.evaluateHandle(names => {
      const value = new DataTransfer();
      for (const name of names) value.items.add(new File(['Ficticio'], name, { type: 'text/plain' }));
      return value;
    }, names);
    await drop.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(dialog.getByRole('alert')).toContainText(names.length > 1 ? 'una sola normativa' : 'Adjunta un PDF');
    await expect(dialog.getByRole('button', { name: 'Generar plantilla con ChatGPT', exact: true })).toBeDisabled();
  }
  expect((await studio.json('/api/assistant/template-generations')).items).toEqual([]);
});

test('normativa: detener una comparación conserva la memoria y el último PDF @contexto @worker', async ({studio,page}) => {
  test.skip(!process.env.E2E_WORKER_URL,'Requiere un worker real de pruebas');test.setTimeout(180_000);
  const compiled=await studio.json('/api/compile',{method:'POST'});expect(compiled.ok).toBe(true);
  const previous=await studio.json('/api/compile/last'), pdf=await fs.readFile(path.join(process.env.E2E_WORKER_OUT,compiled.buildId,'main.pdf'));
  const original=await fs.readFile(path.join(studio.root,'memoria/tfg.tex'),'utf8'), dialog=await start(studio,page);
  await dialog.getByLabel('Documento de normativa',{exact:true}).setInputFiles({name:'normativa.txt',mimeType:'text/plain',buffer:Buffer.from('Normativa ficticia: margen interior de 35 mm.')});
  await dialog.getByRole('button',{name:'Generar plantilla con ChatGPT',exact:true}).click();await expect(dialog.getByText('Plantilla preparada',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Comparar PDF',exact:true}).click();await dialog.getByRole('button',{name:'Detener comparación',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Comparar PDF',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('alert')).toContainText('Comparación detenida');
  expect(await studio.json('/api/compile/last')).toEqual(previous);
  expect(await fs.readFile(path.join(process.env.E2E_WORKER_OUT,compiled.buildId,'main.pdf'))).toEqual(pdf);
  expect(await fs.readFile(path.join(studio.root,'memoria/tfg.tex'),'utf8')).toBe(original);
});
