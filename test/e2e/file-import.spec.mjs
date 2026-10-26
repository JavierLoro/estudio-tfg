import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect, png } from './fixtures.mjs';

const image = { name: 'gráfico & datos (2).png', mimeType: 'image/png', buffer: png };
const document = { name: 'Documento.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nFicticio\n%%EOF') };

async function dropFiles(page, locator, files, coords = {}) {
  const transfer = await page.evaluateHandle(files => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mimeType }));
    return dt;
  }, files.map(f => ({ name: f.name, mimeType: f.mimeType, bytes: [...f.buffer] })));
  try {
    await locator.dispatchEvent('dragover', { dataTransfer: transfer, ...coords });
    await locator.dispatchEvent('drop', { dataTransfer: transfer, ...coords });
  } finally { await transfer.dispose(); }
  const dialog = page.getByRole('dialog', { name: 'Importar archivos', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openMemory(page, studio) {
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Buscar', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Abrir o buscar' });
  await quick.getByLabel('Buscar', { exact: true }).fill('capitulo.tex');
  await quick.getByRole('option').filter({ hasText: 'capitulo.tex' }).first().click();
  return page.getByRole('region', { name: 'Espacio: Memoria', exact: true });
}

test('soltar en la app permite elegir carpeta, conserva colisiones y reutiliza un reenvío', async ({ studio, page }) => {
  await studio.biblioteca();
  const directory = path.join(studio.root, 'notes/Documentos');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'Documento.pdf'), 'Original ficticio');
  const dialog = await dropFiles(page, page.locator('body'), [document]);
  await dialog.getByRole('combobox', { name: 'Guardar en', exact: true }).selectOption('notes');
  await dialog.getByLabel('Carpeta de destino').fill('Documentos');
  await page.screenshot({ path: test.info().outputPath('importacion.png') });
  await page.setViewportSize({ width: 420, height: 740 });
  await expect(dialog.getByRole('button', { name: 'Guardar archivos', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('importacion-estrecha.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByRole('button', { name: 'Guardar archivos', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await fs.readFile(path.join(directory, 'Documento.pdf'), 'utf8')).toBe('Original ficticio');
  expect(await fs.readFile(path.join(directory, 'Documento 2.pdf'))).toEqual(document.buffer);
  await page.getByRole('button', { name: 'Importar archivos', exact: true }).click();
  await page.getByLabel('Archivos para importar', { exact: true }).setInputFiles(document);
  await dialog.getByRole('combobox', { name: 'Guardar en', exact: true }).selectOption('notes');
  await dialog.getByLabel('Carpeta de destino').fill('Documentos');
  await dialog.getByRole('button', { name: 'Guardar archivos', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await fs.readdir(directory)).toEqual(['Documento 2.pdf', 'Documento.pdf']);
});

test('soltar sobre una carpeta preselecciona Notas y continúa en la captura existente si se elige Biblioteca', async ({ studio, page }) => {
  await fs.mkdir(path.join(studio.root, 'notes/Destino'));
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Notas', exact: true }).click();
  const dialog = await dropFiles(page, page.getByRole('treeitem', { name: 'Destino', exact: true }), [image]);
  await expect(dialog.getByRole('combobox', { name: 'Guardar en', exact: true })).toHaveValue('notes');
  await expect(dialog.getByLabel('Carpeta de destino')).toHaveValue('Destino');
  await dialog.getByRole('combobox', { name: 'Guardar en', exact: true }).selectOption('library');
  const status = await studio.json('/api/status');
  await page.route('**/api/status', route => route.fulfill({ json: { ...status, libraryId: 'biblioteca-cambiada' } }));
  await dialog.getByRole('button', { name: 'Continuar en Biblioteca', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('La Biblioteca cambió');
  await page.unroute('**/api/status');
  await dialog.getByRole('button', { name: 'Continuar en Biblioteca', exact: true }).click();
  const capture = page.getByRole('dialog', { name: 'Añadir a Biblioteca' });
  await expect(capture.getByText(image.name, { exact: true })).toBeVisible();
  await capture.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(capture.getByText('Guardado', { exact: false })).toBeVisible();
  await capture.getByRole('button', { name: 'Listo', exact: true }).click();
  expect((await studio.json('/api/resources')).items).toHaveLength(1);
});

for (const mode of ['Código', 'Visual']) test(`soltar en LaTeX ${mode} inserta después de la línea sin guardar y permite deshacer`, async ({ studio, page }) => {
  const original = 'Primera línea ficticia.\nÚltima línea ficticia.\n';
  await fs.writeFile(path.join(studio.root, 'memoria/capitulo.tex'), original);
  const memory = await openMemory(page, studio);
  await memory.getByRole('button', { name: mode, exact: true }).click();
  const editor = memory.locator('.cm-content');
  await editor.press('ControlOrMeta+End');
  await page.keyboard.insertText('Borrador conservado');
  const box = await editor.locator('.cm-line').first().boundingBox();
  const dialog = await dropFiles(page, editor, [image, { name: 'archivo.txt', mimeType: 'text/plain', buffer: Buffer.from('Ficticio') }], { clientX: box.x + 15, clientY: box.y + box.height / 2 });
  await expect(dialog.getByLabel(/Insertar en/)).toBeChecked();
  await dialog.getByLabel('Carpeta de destino').fill('figuras/importadas');
  await dialog.getByRole('button', { name: 'Guardar e insertar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await memory.getByRole('button', { name: 'Código', exact: true }).click();
  await expect(editor).toContainText('\\includegraphics');
  await expect(editor).toContainText('Borrador conservado');
  await expect(editor).toContainText('\\caption{gráfico \\& datos (2)}');
  const text = await editor.textContent();
  expect(text.indexOf('\\includegraphics')).toBeLessThan(text.indexOf('Última línea'));
  expect(await fs.readFile(path.join(studio.root, 'memoria/capitulo.tex'), 'utf8')).toBe(original);
  expect(await fs.readFile(path.join(studio.root, 'memoria/figuras/importadas', image.name))).toEqual(png);
  await editor.press('ControlOrMeta+z');
  await expect(editor).not.toContainText('\\includegraphics');
  await expect(editor).toContainText('Borrador conservado');
  expect(await fs.readFile(path.join(studio.root, 'memoria/figuras/importadas/archivo.txt'), 'utf8')).toBe('Ficticio');
});

test('soltar imágenes y documentos en Markdown crea rutas relativas y la imagen se muestra', async ({ studio, page }) => {
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Notas', exact: true }).click();
  await page.getByRole('treeitem', { name: 'Nota.md', exact: true }).click();
  const notes = page.getByRole('region', { name: 'Espacio: Notas', exact: true });
  await notes.getByRole('button', { name: /^Editar \(/ }).click();
  const editor = notes.locator('.cm-content');
  await editor.press('ControlOrMeta+End');
  const dialog = await dropFiles(page, editor, [image, document]);
  await dialog.getByLabel('Carpeta de destino').fill('Documentos & figuras');
  await dialog.getByRole('button', { name: 'Guardar e insertar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(editor).toContainText('![gráfico & datos (2)](Documentos%20%26%20figuras/gr%C3%A1fico%20%26%20datos%20%282%29.png)');
  await expect(editor).toContainText('[Documento](Documentos%20%26%20figuras/Documento.pdf)');
  await notes.getByRole('button', { name: /^Vista previa \(/ }).click();
  const preview = notes.getByRole('img', { name: 'gráfico & datos (2)', exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(img => img.naturalWidth)).toBe(32);
  expect(await fs.readFile(path.join(studio.root, 'notes/Nota.md'), 'utf8')).not.toContain('Documentos');
});

test('respuesta perdida y lote parcial conservan los resultados y reintentan sin duplicar', async ({ studio, page }) => {
  await studio.biblioteca();
  let lost = false, calls = 0;
  await page.route('**/api/files/import?**', async route => {
    calls++;
    if (!lost) { lost = true; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  const dialog = await dropFiles(page, page.locator('body'), [image, document]);
  await dialog.getByRole('combobox', { name: 'Guardar en', exact: true }).selectOption('memoria');
  await dialog.getByLabel('Carpeta de destino').fill('importados');
  await dialog.getByRole('button', { name: 'Guardar archivos', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Reintentar fallidos', exact: true })).toBeEnabled();
  await expect(dialog.getByText('Guardado: importados/Documento.pdf', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Reintentar fallidos', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(calls).toBe(3);
  expect((await fs.readdir(path.join(studio.root, 'memoria/importados'))).sort()).toEqual(['Documento.pdf', image.name].sort());
});

test('si cambia el documento durante el diálogo no inserta ni pierde el borrador', async ({ studio, page }) => {
  const memory = await openMemory(page, studio), editor = memory.locator('.cm-content');
  await memory.getByRole('button', { name: 'Código', exact: true }).click();
  await editor.press('ControlOrMeta+End');
  await page.keyboard.insertText('Borrador propio');
  const dialog = await dropFiles(page, editor, [image]);
  await fs.writeFile(path.join(studio.root, 'memoria/capitulo.tex'), 'Cambio externo ficticio.\n');
  await expect(memory.getByText(/cambiado fuera|cambio externo|conflicto/i).first()).toBeAttached();
  await dialog.getByRole('button', { name: 'Guardar e insertar', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('El editor cambió');
  await expect(editor).toContainText('Borrador propio');
  await expect(editor).not.toContainText('\\includegraphics');
  expect(await fs.readFile(path.join(studio.root, 'memoria/capitulo.tex'), 'utf8')).toBe('Cambio externo ficticio.\n');
});
