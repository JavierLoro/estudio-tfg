import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { test, expect, add, png } from './fixtures.mjs';

test('las vistas previas antiguas de actualización no se recuperan como inserciones @smoke', async ({ studio, page }) => {
  await studio.biblioteca();
  const created = await add(page, 'Figura con vista antigua', [{ name: 'figura.png', mimeType: 'image/png', buffer: png }]);
  await created.getByRole('button', { name: 'Listo', exact: true }).click();
  const [resource] = (await studio.json('/api/resources')).items;
  const file = await studio.json('/api/resources/file?path=' + encodeURIComponent(resource.path));
  const status = await studio.json('/api/status');
  const input = {
    libraryId: status.libraryId, instanceId: status.instanceId,
    resourceId: resource.id, baseRev: file.rev, kind: 'figure', attachmentPath: file.attachments[0].path,
    caption: 'Pie ficticio original', credit: 'Autor ficticio', label: 'fig:original', width: 40,
  };
  const initial = await studio.json('/api/library/integration/preview', { method: 'POST', data: { ...input, operationId: randomUUID() } });
  await studio.json('/api/library/integration/apply', { method: 'POST', data: {
    libraryId: status.libraryId, instanceId: status.instanceId, operationId: initial.operationId,
    revisions: initial.files.map(({ path, baseRev }) => ({ path, baseRev })),
  } });
  const legacy = await studio.json('/api/library/integration/preview', { method: 'POST', data: {
    ...input, operationId: randomUUID(), replaceCopy: initial.result.figurePath,
  } });
  await page.evaluate(({ key, preview }) => localStorage.setItem(key, JSON.stringify({ preview, target: 'capitulo.tex' })), {
    key: `et:library-use:${status.instanceId}:${resource.id}:figure`, preview: legacy,
  });
  await page.getByRole('button', { name: /Figura con vista antigua/ }).click();
  await page.getByRole('button', { name: 'Insertar figura', exact: true }).click();
  const insert = page.getByRole('dialog', { name: 'Insertar figura en la memoria' });
  await expect(insert.getByRole('button', { name: 'Revisar antes de aplicar' })).toBeEnabled();
  await expect(insert.getByRole('button', { name: 'Aplicar vista previa' })).toHaveCount(0);
  await expect(insert.getByRole('combobox', { name: 'Archivo de destino', exact: true })).toBeVisible();
  for (const label of ['Pie de figura', 'Procedencia / atribución', 'Etiqueta', 'Ancho (% del texto)'])
    await expect(insert.getByLabel(label, { exact: true })).toBeVisible();
  await insert.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await page.getByRole('button', { name: 'Actualizar esta copia de imagen' }).click();
  const update = page.getByRole('dialog', { name: 'Actualizar copia en la memoria' });
  await expect(update.getByRole('button', { name: 'Revisar antes de aplicar' })).toBeEnabled();
  await expect(update.getByRole('button', { name: 'Aplicar vista previa' })).toHaveCount(0);
  await expect(update.getByRole('combobox', { name: 'Imagen o PDF (primera página)', exact: true })).toBeVisible();
  for (const label of ['Archivo de destino', 'Pie de figura', 'Procedencia / atribución', 'Etiqueta', 'Ancho (% del texto)'])
    await expect(update.getByLabel(label, { exact: true })).toHaveCount(0);
});

test('actualizar una copia de imagen conserva el texto y la atribución de la figura @smoke', async ({ studio, page }) => {
  await studio.biblioteca();
  const created = await add(page, 'Figura actualizable', [{ name: 'figura.png', mimeType: 'image/png', buffer: png }]);
  await created.getByRole('button', { name: 'Listo', exact: true }).click();
  const [resource] = (await studio.json('/api/resources')).items;
  const file = await studio.json('/api/resources/file?path=' + encodeURIComponent(resource.path));
  const status = await studio.json('/api/status');
  const preview = await studio.json('/api/library/integration/preview', { method: 'POST', data: {
    libraryId: status.libraryId, instanceId: status.instanceId, operationId: randomUUID(),
    resourceId: resource.id, baseRev: file.rev, kind: 'figure', attachmentPath: file.attachments[0].path,
    caption: 'Pie personalizado ficticio', credit: 'Autor ficticio original', label: 'fig:original', width: 40,
  } });
  await studio.json('/api/library/integration/apply', { method: 'POST', data: {
    libraryId: status.libraryId, instanceId: status.instanceId, operationId: preview.operationId,
    revisions: preview.files.map(({ path, baseRev }) => ({ path, baseRev })),
  } });
  const texPath = path.join(studio.root, 'memoria/capitulo.tex');
  await fs.appendFile(texPath, '\n' + preview.result.snippet + '\n');
  const originalTex = await fs.readFile(texPath);
  const manifestPath = path.join(studio.root, 'memoria/biblioteca/estado.json');
  const original = JSON.parse(await fs.readFile(manifestPath, 'utf8')).figures[0];
  const changed = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(path.join(studio.root, 'notes', file.attachments[0].path), changed);
  await page.getByRole('button', { name: /Figura actualizable/ }).click();
  await page.getByRole('button', { name: 'Actualizar esta copia de imagen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Actualizar copia en la memoria' });
  for (const label of ['Archivo de destino', 'Pie de figura', 'Procedencia / atribución', 'Etiqueta', 'Ancho (% del texto)'])
    await expect(dialog.getByLabel(label, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/Solo se actualiza el archivo de imagen/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Revisar antes de aplicar' }).click();
  await expect(dialog.getByText(/Solo se actualiza el archivo de imagen/)).toBeVisible();
  await expect(dialog.getByText(/\\caption\{/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Aplicar vista previa' }).click();
  await expect(dialog).not.toBeVisible();
  expect(await fs.readFile(texPath)).toEqual(originalTex);
  expect(await fs.readFile(path.join(studio.root, 'memoria', preview.result.figurePath))).toEqual(changed);
  expect(JSON.parse(await fs.readFile(manifestPath, 'utf8')).figures).toEqual([
    { ...original, hash: createHash('sha256').update(changed).digest('hex') },
  ]);
});
