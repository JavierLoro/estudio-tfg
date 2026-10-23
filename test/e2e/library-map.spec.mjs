import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { test, expect, add, png } from './fixtures.mjs';
import { copyTemplate, listPerfiles } from '../../scripts/memoria-template.mjs';

async function openMap(studio, page) {
  await studio.biblioteca();
  await page.getByRole('button', { name: 'Mapa de contenidos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mapa de contenidos', exact: true })).toBeVisible();
  await expect(page.getByText(/Mapa guardado|Cambios pendientes de guardar/)).toBeVisible();
}
async function createNode(page, title, { parent, resource, note } = {}) {
  if (parent) {
    await page.getByRole('complementary', { name: 'Jerarquía del mapa' }).getByRole('button', { name: parent, exact: true }).click();
    await page.getByRole('button', { name: 'Añadir dentro', exact: true }).click();
  } else await page.getByRole('button', { name: /Nuevo nodo|Crear primer nodo/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo nodo', exact: true });
  await dialog.getByLabel('Título del nodo', { exact: true }).fill(title);
  if (resource) await dialog.getByRole('combobox', { name: 'Recurso de Biblioteca', exact: true }).selectOption({ label: resource });
  if (note) await dialog.getByLabel('Notas del nodo', { exact: true }).fill(note);
  await dialog.getByRole('button', { name: 'Guardar nodo', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Jerarquía del mapa' }).getByRole('button', { name: title, exact: false })).toBeVisible();
}

test('crea jerarquía y relaciones, selecciona el mapa y quita nodos sin borrar originales', async ({ studio, page }) => {
  await studio.biblioteca();
  const capture = await add(page, 'Figura original ficticia', [{ name: 'figura.png', mimeType: 'image/png', buffer: png }]);
  await capture.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.getByRole('button', { name: 'Mapa de contenidos', exact: true }).click();
  let release, received;
  const gate = new Promise(resolve => { release = resolve; }), requestReceived = new Promise(resolve => { received = resolve; });
  await page.route('**/api/library/map', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    received(); await gate; await route.fulfill({ response });
  });
  const adding = createNode(page, 'Marco teórico');
  await requestReceived;
  try {
    await expect(page.getByRole('dialog', { name: 'Nuevo nodo', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Nuevo nodo', exact: true }).getByRole('button', { name: 'Guardar nodo', exact: true })).toBeDisabled();
  } finally { release(); await adding; await page.unroute('**/api/library/map'); }
  await createNode(page, 'Fuente utilizada', { parent: 'Marco teórico', resource: 'Figura original ficticia', note: 'Sirve para explicar el diseño.' });
  await createNode(page, 'Diseño');
  const hierarchy = page.getByRole('complementary', { name: 'Jerarquía del mapa' });
  await hierarchy.getByRole('button', { name: 'Fuente utilizada', exact: false }).click();
  await page.getByRole('combobox', { name: 'Conectar con', exact: true }).selectOption({ label: 'Diseño' });
  await page.getByLabel('Relación', { exact: true }).fill('Respalda');
  await page.getByRole('button', { name: 'Conectar nodos', exact: true }).click();
  await expect(page.getByText('→ Respalda · Diseño', { exact: true })).toBeVisible();
  const canvas = page.getByRole('region', { name: 'Mapa de nodos', exact: true });
  await expect(canvas.locator('svg:visible')).toBeVisible();
  await canvas.getByRole('button', { name: 'Marco teórico', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Contenido del nodo' }).getByRole('heading', { name: 'Marco teórico', exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: 'Diseño', exact: true }).press('Enter');
  await expect(page.getByRole('complementary', { name: 'Contenido del nodo' }).getByRole('heading', { name: 'Diseño', exact: true })).toBeVisible();
  await hierarchy.getByRole('button', { name: 'Fuente utilizada', exact: false }).click();
  await page.screenshot({ path: test.info().outputPath('mapa-contenidos.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(canvas.locator('svg:visible g.node rect').first()).toHaveCSS('fill', 'rgb(29, 32, 38)');
  await page.screenshot({ path: test.info().outputPath('mapa-contenidos-oscuro.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await hierarchy.getByRole('button', { name: 'Marco teórico', exact: true }).click();
  await page.getByRole('button', { name: 'Quitar del mapa', exact: true }).click();
  await page.getByRole('dialog', { name: 'Quitar del mapa', exact: true }).getByRole('button', { name: 'Quitar del mapa', exact: true }).click();
  await expect(hierarchy.getByRole('button', { name: 'Fuente utilizada', exact: false })).not.toBeVisible();
  expect((await studio.json('/api/resources')).items).toHaveLength(1);
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(hierarchy.getByRole('button', { name: 'Fuente utilizada', exact: false })).toBeVisible();
  await openMap(studio, page);
  await expect(hierarchy.getByRole('button', { name: 'Fuente utilizada', exact: false })).toBeVisible();
  const map = await studio.json('/api/library/map');
  expect(map.map.nodes).toHaveLength(3);
  expect(map.map.links).toHaveLength(1);
});

test('desde un nodo inserta figura, texto y enlace conservando borradores y Deshacer', async ({ studio, page }) => {
  await studio.biblioteca();
  const capture = await add(page, 'Recurso con figura', [{ name: 'figura.png', mimeType: 'image/png', buffer: png }], 'https://ejemplo.invalid/fuente?q=1&x=2');
  await capture.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.getByRole('button', { name: 'Mapa de contenidos', exact: true }).click();
  await createNode(page, 'Fuente', { resource: 'Recurso con figura', note: 'Nota con 50% y A & B.' });
  await expect(page.getByRole('button', { name: 'Insertar figura', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Insertar figura', exact: true }).click();
  const figure = page.getByRole('dialog', { name: 'Insertar figura en la memoria', exact: true });
  await figure.getByRole('combobox', { name: 'Archivo de destino', exact: true }).selectOption('capitulo.tex');
  await figure.getByRole('button', { name: 'Revisar antes de aplicar', exact: true }).click();
  await figure.getByRole('button', { name: 'Aplicar vista previa', exact: true }).click();
  await expect(figure).not.toBeVisible();
  const editor = page.getByRole('region', { name: 'Espacio: Memoria', exact: true }).locator('.cm-content');
  await expect(editor).toContainText('\\includegraphics');
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mapa de contenidos', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Insertar notas del nodo', exact: true }).click();
  const text = page.getByRole('dialog', { name: 'Insertar texto del nodo', exact: true });
  await text.getByRole('combobox', { name: 'Archivo de destino', exact: true }).selectOption('capitulo.tex');
  await text.getByRole('button', { name: 'Insertar en el borrador', exact: true }).click();
  await expect(text).not.toBeVisible();
  await expect(editor).toContainText('Nota con 50\\% y A \\& B.');
  await expect(editor).toContainText('\\includegraphics');
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Insertar enlace', exact: true }).click();
  const link = page.getByRole('dialog', { name: 'Insertar enlace', exact: true });
  await link.getByRole('combobox', { name: 'Archivo de destino', exact: true }).selectOption('capitulo.tex');
  await link.getByRole('button', { name: 'Insertar en el borrador', exact: true }).click();
  await expect(link).not.toBeVisible();
  await expect(editor).toContainText('\\href{https://ejemplo.invalid/fuente?q=1\\&x=2}');
  await editor.press('ControlOrMeta+z');
  await expect(editor).not.toContainText('\\href');
  await expect(editor).toContainText('Nota con 50\\%');
  expect(await fs.readFile(path.join(studio.root, 'memoria/capitulo.tex'), 'utf8')).toBe('Texto ficticio del apartado.\n');
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Insertar figura', exact: true }).click();
  await figure.getByRole('combobox', { name: 'Archivo de destino', exact: true }).selectOption('capitulo.tex');
  await figure.getByRole('button', { name: 'Revisar antes de aplicar', exact: true }).click();
  await figure.getByRole('button', { name: 'Aplicar vista previa', exact: true }).click();
  await expect(figure).not.toBeVisible();
  const labels = (await editor.textContent()).match(/\\label\{fig:biblioteca-[^}]+\}/g);
  expect(labels).toHaveLength(2);
  expect(new Set(labels).size).toBe(2);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Insertar enlace', exact: true }).click();
  await link.getByRole('combobox', { name: 'Archivo de destino', exact: true }).selectOption('tfg.tex');
  await link.getByRole('button', { name: 'Insertar en el borrador', exact: true }).click();
  await expect(link).not.toBeVisible();
  const mainEditor = page.getByRole('region', { name: 'Espacio: Memoria', exact: true }).locator('.cm-content').last();
  const mainText = await mainEditor.textContent();
  expect(mainText.indexOf('\\href')).toBeGreaterThan(mainText.indexOf('\\begin{document}'));
  expect(mainText.indexOf('\\href')).toBeLessThan(mainText.indexOf('\\end{document}'));
});

test('un cambio externo conserva la propuesta y exige revisar el mapa actual', async ({ studio, page }) => {
  await openMap(studio, page);
  await createNode(page, 'Tema inicial');
  await page.getByRole('button', { name: 'Editar nodo', exact: true }).click();
  const editing = page.getByRole('dialog', { name: 'Editar nodo', exact: true });
  await editing.getByLabel('Título del nodo', { exact: true }).fill('Mi propuesta');
  const current = await studio.json('/api/library/map');
  const external = { ...current.map, nodes: [...current.map.nodes, { id: crypto.randomUUID(), parent: null, title: 'Otro cliente', note: '' }] };
  await studio.json('/api/library/map', { method: 'PUT', data: { libraryId: current.libraryId, baseRev: current.rev, map: external } });
  await editing.getByRole('button', { name: 'Guardar nodo', exact: true }).click();
  const conflict = page.getByRole('dialog', { name: 'El mapa ha cambiado', exact: true });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText('Mi propuesta');
  await expect(conflict).toContainText('Otro cliente');
  expect((await studio.json('/api/library/map')).map).toEqual(external);
  await conflict.getByRole('button', { name: 'Conservar versión actual', exact: true }).click();
  await expect(conflict).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Deshacer', exact: true })).toBeDisabled();
  await expect(page.getByRole('complementary', { name: 'Jerarquía del mapa' }).getByRole('button', { name: 'Otro cliente', exact: true })).toBeVisible();
});

test('un fallo de red conserva el cambio tras recargar y permite recuperarlo en pantalla estrecha', async ({ studio, page }) => {
  await openMap(studio, page);
  await createNode(page, 'Tema guardado');
  await page.route('**/api/library/map', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
  await createNode(page, 'Tema pendiente');
  await expect(page.getByRole('button', { name: 'Reintentar guardado', exact: true })).toBeVisible();
  await page.unroute('**/api/library/map');
  await openMap(studio, page);
  await expect(page.getByRole('complementary', { name: 'Jerarquía del mapa' }).getByRole('button', { name: 'Tema pendiente', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar guardado', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reintentar guardado', exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 500, height: 900 });
  await page.getByRole('complementary', { name: 'Jerarquía del mapa' }).getByRole('button', { name: 'Tema pendiente', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Añadir dentro', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('mapa-estrecho.png') });
});

test('las citas y los diagramas de un recurso se incorporan con sus flujos existentes', async ({ studio, page }) => {
  const preview = await studio.json('/api/library/import/preview', { method: 'POST', data: { format: 'bibtex', text: '@book{Nodo2026,title={Libro para el mapa},author={Ficticio, Ana},year={2026},publisher={Editorial ficticia}}' } });
  await studio.json('/api/library/import', { method: 'POST', data: { operationId: crypto.randomUUID(), libraryId: preview.libraryId, source: preview.source, items: preview.items.map(i => ({ ...i, action: 'create' })) } });
  await openMap(studio, page);
  await createNode(page, 'Referencia', { resource: 'Libro para el mapa' });
  await page.getByRole('button', { name: 'Insertar cita', exact: true }).click();
  const cite = page.getByRole('dialog', { name: 'Insertar cita en la memoria', exact: true });
  await cite.getByRole('combobox', { name: 'Archivo de destino', exact: true }).selectOption('capitulo.tex');
  await cite.getByRole('button', { name: 'Revisar antes de aplicar', exact: true }).click();
  await cite.getByRole('button', { name: 'Aplicar vista previa', exact: true }).click();
  await expect(cite).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Espacio: Memoria', exact: true }).locator('.cm-content').last()).toContainText('\\cite{Nodo2026}');
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
  const source = 'flowchart TD\n  A[Inicio ficticio] --> B[Resultado]\n';
  await page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: 'Añadir recurso', exact: true }).click();
  const capture = page.getByRole('dialog', { name: 'Añadir a Biblioteca', exact: true });
  await capture.getByLabel('Título', { exact: true }).fill('Flujo de Biblioteca');
  await capture.getByLabel('Seleccionar archivos para Biblioteca', { exact: true }).setInputFiles({ name: 'flujo.mmd', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await capture.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(capture.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled();
  await capture.getByRole('button', { name: 'Listo', exact: true }).click();
  await createNode(page, 'Diagrama reutilizable', { resource: 'Flujo de Biblioteca' });
  await page.getByRole('button', { name: 'Crear diagrama en Memoria', exact: true }).click();
  const diagram = page.getByRole('dialog', { name: 'Usar el diagrama en la memoria', exact: true });
  await diagram.getByLabel('Nombre', { exact: true }).fill('mapa-flujo');
  await diagram.getByRole('button', { name: 'Copiar a la memoria', exact: true }).click();
  await expect(diagram).not.toBeVisible();
  expect(await fs.readFile(path.join(studio.root, 'memoria/diagramas/mapa-flujo.mmd'), 'utf8')).toBe(source);
  const resource = (await studio.json('/api/resources')).items.find(r => r.title === 'Flujo de Biblioteca');
  const file = await studio.json(`/api/resources/file?path=${encodeURIComponent(resource.path)}`);
  expect(await fs.readFile(path.join(studio.root, 'notes', file.attachments[0].path), 'utf8')).toBe(source);
});

test('el mapa compila ambos perfiles y sus copias trasladadas sin Biblioteca @worker', async ({ studio, page }) => {
  test.skip(!process.env.E2E_WORKER_URL, 'Requiere un worker E2E real y su salida temporal compartida');
  test.setTimeout(300_000);
  const output = process.env.E2E_WORKER_OUT;
  const health = await page.request.get(process.env.E2E_WORKER_URL + '/health');
  expect(health.ok()).toBe(true);
  const toolchain = await health.json();
  expect(toolchain.ok).toBe(true);
  const linkUrl = 'https://example.org/recurso?avance=50%25&nombre=mapa#seccion';
  const preview = await studio.json('/api/library/import/preview', { method: 'POST', data: { format: 'bibtex', text: '@book{Mapa2026,title={Fuente bibliográfica del mapa},author={Ficticio, Ana},year={2026},publisher={Editorial de pruebas}}' } });
  await studio.json('/api/library/import', { method: 'POST', data: { operationId: crypto.randomUUID(), libraryId: preview.libraryId, source: preview.source, items: preview.items.map(i => ({ ...i, action: 'create' })) } });
  const source = 'flowchart TD\n  A[Inicio del mapa] --> B[Resultado verificado]\n';
  await studio.biblioteca();
  for (const [title, files, url] of [
    ['Imagen del mapa', [{ name: 'figura.png', mimeType: 'image/png', buffer: png }], linkUrl],
    ['Diagrama del mapa', [{ name: 'flujo.mmd', mimeType: 'text/plain', buffer: Buffer.from(source) }], ''],
  ]) {
    const capture = await add(page, title, files, url);
    await capture.getByRole('button', { name: 'Listo', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Mapa de contenidos', exact: true }).click();
  await createNode(page, 'Materiales');
  await createNode(page, 'Imagen', { parent: 'Materiales', resource: 'Imagen del mapa', note: 'Nota del mapa: 50% y A & B, identificador nodo_1.' });
  await createNode(page, 'Referencia', { parent: 'Materiales', resource: 'Fuente bibliográfica del mapa' });
  await createNode(page, 'Diagrama', { parent: 'Materiales', resource: 'Diagrama del mapa' });
  const originalResources = await fs.readFile(path.join(studio.root, 'notes/Recursos/.mapa.json'));
  async function selectNode(name) {
    await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
    const heading = page.getByRole('heading', { name: 'Mapa de contenidos', exact: true });
    if (!await heading.isVisible()) await page.getByRole('button', { name: 'Mapa de contenidos', exact: true }).click();
    await page.getByRole('complementary', { name: 'Jerarquía del mapa' }).getByRole('button', { name, exact: false }).click();
  }
  async function compile(profile, stage, fromEditor) {
    let response;
    if (fromEditor) {
      const waiting = page.waitForResponse(r => r.url().endsWith('/api/compile') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Guardar y compilar', exact: true }).last().click();
      response = await waiting;
    } else response = await page.request.post(studio.server.url + '/api/compile');
    const result = await response.json();
    await fs.writeFile(path.join(output, `resultado-mapa-${profile}-${stage}.json`), JSON.stringify({ ...result, toolchain }, null, 2));
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.diagnostics, JSON.stringify(result)).toEqual([]);
    const pdf = await page.request.get(studio.server.url + result.pdfUrl);
    expect(pdf.ok()).toBe(true);
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    await fs.writeFile(path.join(output, `mapa-${profile}-${stage}.pdf`), bytes);
  }
  for (const { id } of listPerfiles()) {
    const memoria = path.join(studio.root, `memoria-${id}`), chapter = '1-capitulos/01-introduccion.tex';
    copyTemplate(memoria, { perfil: id });
    const manual = await fs.readFile(path.join(memoria, 'bibliografia.bib'));
    await studio.json('/api/settings', { method: 'PUT', data: { memoriaDir: memoria } });
    await page.goto(studio.server.url);
    await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Buscar', exact: true }).click();
    const quick = page.getByRole('dialog', { name: 'Abrir o buscar', exact: true });
    await quick.getByLabel('Buscar', { exact: true }).fill('01-introduccion.tex');
    await quick.getByRole('option').filter({ hasText: '01-introduccion.tex' }).first().click();
    await page.getByRole('region', { name: 'Espacio: Memoria', exact: true }).locator('.cm-content').last().press('ControlOrMeta+End');
    for (const caption of ['Figura del mapa al 50%: A & B', 'Segunda inserción de la misma figura']) {
      await selectNode('Imagen');
      await page.getByRole('button', { name: 'Insertar figura', exact: true }).click();
      const figure = page.getByRole('dialog', { name: 'Insertar figura en la memoria', exact: true });
      await figure.getByRole('combobox', { name: 'Archivo de destino', exact: true }).selectOption(chapter);
      await figure.getByLabel('Pie de figura', { exact: true }).fill(caption);
      await figure.getByLabel('Ancho (% del texto)', { exact: true }).fill('30');
      await figure.getByRole('button', { name: 'Revisar antes de aplicar', exact: true }).click();
      await figure.getByRole('button', { name: 'Aplicar vista previa', exact: true }).click();
      await expect(figure).not.toBeVisible();
    }
    for (const [button, title] of [['Insertar notas del nodo', 'Insertar texto del nodo'], ['Insertar enlace', 'Insertar enlace']]) {
      await selectNode('Imagen');
      await page.getByRole('button', { name: button, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await dialog.getByRole('combobox', { name: 'Archivo de destino', exact: true }).selectOption(chapter);
      await dialog.getByRole('button', { name: 'Insertar en el borrador', exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
    await selectNode('Referencia');
    await page.getByRole('button', { name: 'Insertar cita', exact: true }).click();
    const cite = page.getByRole('dialog', { name: 'Insertar cita en la memoria', exact: true });
    await cite.getByRole('combobox', { name: 'Archivo de destino', exact: true }).selectOption(chapter);
    await cite.getByRole('button', { name: 'Revisar antes de aplicar', exact: true }).click();
    await cite.getByRole('button', { name: 'Aplicar vista previa', exact: true }).click();
    await expect(cite).not.toBeVisible();
    await selectNode('Diagrama');
    await page.getByRole('button', { name: 'Crear diagrama en Memoria', exact: true }).click();
    const copy = page.getByRole('dialog', { name: 'Usar el diagrama en la memoria', exact: true });
    await copy.getByLabel('Nombre', { exact: true }).fill('mapa-verificado');
    await copy.getByRole('button', { name: 'Copiar a la memoria', exact: true }).click();
    await expect(copy).not.toBeVisible();
    await page.getByRole('button', { name: 'Insertar en la memoria', exact: true }).click();
    const diagram = page.getByRole('dialog', { name: 'Insertar en la memoria', exact: true });
    const destinations = await diagram.getByRole('combobox', { name: 'Capítulo o apartado destino', exact: true }).locator('option').all();
    for (const option of destinations) {
      if ((await option.textContent()).includes('01-introduccion.tex')) {
        await diagram.getByRole('combobox', { name: 'Capítulo o apartado destino', exact: true }).selectOption(await option.getAttribute('value'));
        break;
      }
    }
    await diagram.getByLabel('Pie de figura', { exact: true }).fill('Diagrama del mapa verificado');
    await diagram.getByRole('button', { name: 'Insertar', exact: true }).click();
    await expect(diagram).not.toBeVisible();
    await compile(id, 'original', true);
    const content = await fs.readFile(path.join(memoria, chapter), 'utf8');
    for (const expected of ['\\includegraphics', '\\cite{Mapa2026}', '\\href{', 'Nota del mapa', 'mapa-verificado']) expect(content).toContain(expected);
    const labels = content.match(/\\label\{fig:biblioteca-[^}]+\}/g);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    expect(await fs.readFile(path.join(memoria, 'bibliografia.bib'))).toEqual(manual);
    expect(await fs.readFile(path.join(memoria, 'diagramas/mapa-verificado.mmd'), 'utf8')).toBe(source);
    expect(await fs.readFile(path.join(studio.root, 'notes/Recursos/.mapa.json'))).toEqual(originalResources);
    await page.goto('about:blank');
    const moved = memoria + '-trasladada', offline = path.join(studio.root, 'biblioteca-apartada');
    await fs.cp(memoria, moved, { force: false, errorOnExist: true, recursive: true });
    await fs.rename(path.join(studio.root, 'notes/Recursos'), offline);
    try {
      await studio.json('/api/settings', { method: 'PUT', data: { memoriaDir: moved } });
      await compile(id, 'trasladada-sin-biblioteca', false);
      expect(await fs.readFile(path.join(moved, 'bibliografia.bib'))).toEqual(manual);
    } finally { await fs.rename(offline, path.join(studio.root, 'notes/Recursos')); }
  }
});
