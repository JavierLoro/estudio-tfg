import fs from 'node:fs/promises';
import path from 'node:path';
import { createManifest, verifyManifest } from '../../scripts/respaldo-manifest.mjs';
import { test, expect, add, pending, png } from './fixtures.mjs';

test('añadir, buscar, consultar adjuntos y contener el teclado @smoke', async ({ studio, page }) => {
  await studio.biblioteca();
  const trigger = page.getByRole('button', { name: 'Añadir', exact: true }).last();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Añadir a Biblioteca' });
  await expect(dialog.getByLabel('URL', { exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Abrir o buscar', exact: true })).not.toBeVisible();
  await expect(dialog.getByLabel('URL', { exact: true })).toBeFocused();
  // El último botón habilitado devuelve Tab al primero; Escape restaura el invocador.
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const created = await add(page, 'Imagen de prueba', [{ name: 'figura.png', mimeType: 'image/png', buffer: png }]);
  await created.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.getByLabel('Buscar en Biblioteca').fill('Imagen de prueba');
  await expect(page.getByText('1 de 1 recursos')).toBeVisible();
  await page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Imagen de prueba/ }).click();
  await expect(page.getByRole('region', { name: 'Ficha de consulta' })).toBeVisible();
  await page.getByRole('region', { name: 'Ficha de consulta' }).getByRole('button', { name: 'Abrir', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Imagen de prueba', exact: true })).toBeVisible();
  await expect(page.getByRole('img').filter({ visible: true }).last()).toBeVisible();
  const [resource] = (await studio.json('/api/resources')).items;
  const file = await studio.json('/api/resources/file?path=' + encodeURIComponent(resource.path));
  const response = await page.request.get(studio.server.url + '/api/raw?root=notes&path=' + encodeURIComponent(file.attachments[0].path));
  expect(await response.body()).toEqual(png);
  expect(await pending(page)).toEqual([]);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
  const web = await add(page, '', [], 'https://ejemplo.invalid/articulo');
  await web.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.getByLabel('Buscar en Biblioteca').fill('Web ficticia E2E');
  await expect(page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Web ficticia E2E/ })).toBeVisible();
});

test('lote parcial, respuesta perdida, recarga y reintento sin duplicados', async ({ studio, page }) => {
  await studio.biblioteca();
  let sent = 0;
  await page.route('**/api/capture', async (route) => {
    sent++;
    if (sent === 1) { await route.fetch(); await route.abort('failed'); }
    else await route.fulfill({ status: 422, json: { error: 'Fallo ficticio del segundo recurso' } });
  });
  const files = ['uno.txt', 'dos.txt'].map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name + ' ficticio') }));
  const dialog = await add(page, 'Lote ficticio', files);
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect.poll(async () => (await pending(page)).length).toBe(2);
  const before = await pending(page);
  expect(before.flatMap((i) => i.files).map((f) => f.size)).toEqual(files.map((f) => f.buffer.length));
  expect((await studio.json('/api/resources')).items).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Revisar pendientes' })).toBeVisible();
  expect((await pending(page)).map((i) => i.id).sort()).toEqual(before.map((i) => i.id).sort());
  await page.unroute('**/api/capture');
  await page.getByRole('button', { name: 'Revisar pendientes' }).click();
  const queue = page.getByRole('dialog', { name: 'Recursos pendientes' });
  while (await queue.getByRole('button', { name: 'Reintentar', exact: true }).count()) {
    const count = await queue.getByRole('button', { name: 'Reintentar', exact: true }).count();
    await queue.getByRole('button', { name: 'Reintentar', exact: true }).first().click();
    await expect(queue.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(count - 1);
  }
  await expect(queue.getByText('No hay capturas pendientes.')).toBeVisible();
  expect((await studio.json('/api/resources')).items).toHaveLength(2);
  expect(await pending(page)).toEqual([]);
});

test('401 real conserva adjuntos y permite recuperarlos tras autenticar', async ({ studio, page, context }) => {
  await studio.biblioteca();
  await page.route('**/api/capture', async (route) => {
    await context.clearCookies();
    await route.continue({ headers: { ...route.request().headers(), cookie: '' } });
  });
  const creating = add(page, 'Captura con sesión caducada', [{ name: 'sesion.txt', mimeType: 'text/plain', buffer: Buffer.from('Adjunto ficticio') }]);
  await page.getByRole('dialog', { name: 'Acceso', exact: true }).getByRole('button', { name: 'Cancelar', exact: true }).click();
  const dialog = await creating;
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar pendientes' }).click();
  const queue = page.getByRole('dialog', { name: 'Recursos pendientes' });
  await expect(queue.getByText(/Autentícate y vuelve a reintentar/)).toBeVisible();
  expect((await pending(page))[0].files[0].size).toBe(16);
  await page.unroute('**/api/capture');
  await queue.getByRole('button', { name: 'Reintentar', exact: true }).click();
  const access = page.getByRole('dialog', { name: 'Acceso', exact: true });
  await access.getByLabel(/El servidor pide un token/).fill('e2e-solo-ficticio');
  await access.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(queue.getByText('No hay capturas pendientes.')).toBeVisible();
  expect((await studio.json('/api/resources')).items).toHaveLength(1);
});

test('el cambio de vault no redirige una captura pendiente', async ({ studio, page }) => {
  await studio.biblioteca();
  await page.route('**/api/capture', (route) => route.fulfill({ status: 422, json: { error: 'Pendiente ficticio' } }));
  const dialog = await add(page, 'Destino original');
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
  const [item] = await pending(page);
  const other = path.join(studio.root, 'otro-vault');
  await fs.mkdir(other);
  await studio.json('/api/settings', { method: 'PUT', data: { notesDir: other } });
  await page.reload();
  await page.unroute('**/api/capture');
  await page.getByRole('button', { name: 'Revisar pendientes' }).click();
  const queue = page.getByRole('dialog', { name: 'Recursos pendientes' });
  await queue.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(queue.getByText('Vuelve a la biblioteca original para enviarla')).toBeVisible();
  expect((await pending(page))[0].libraryId).toBe(item.libraryId);
  expect((await studio.json('/api/resources')).items).toHaveLength(0);
  await studio.json('/api/settings', { method: 'PUT', data: { notesDir: path.join(studio.root, 'notes') } });
  await page.reload();
  await page.getByRole('button', { name: 'Revisar pendientes' }).click();
  await queue.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(queue.getByText('No hay capturas pendientes.')).toBeVisible();
  expect((await studio.json('/api/resources')).items).toHaveLength(1);
});

test('conflicto externo exige revisión y conserva ambos cambios @smoke', async ({ studio, page }) => {
  await studio.biblioteca();
  const dialog = await add(page, 'Ficha concurrente');
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Ficha concurrente/ }).click();
  await page.getByRole('region', { name: 'Ficha de consulta' }).getByRole('button', { name: 'Abrir', exact: true }).click();
  await page.getByRole('button', { name: 'Editar datos y notas' }).click();
  const editor = page.getByRole('dialog', { name: 'Editar ficha' });
  await editor.getByLabel('Título', { exact: true }).fill('Mi título conservado');
  const [resource] = (await studio.json('/api/resources')).items;
  const absolute = path.join(studio.root, 'notes', resource.path);
  await fs.appendFile(absolute, '\nNota externa que debe conservarse.\n');
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();
  const conflict = page.getByRole('dialog', { name: 'El recurso ha cambiado' });
  await expect(conflict).toBeVisible();
  await expect(conflict.getByRole('button', { name: 'Reaplicar mi cambio' })).toBeDisabled();
  await conflict.getByRole('button', { name: 'Recargar versión actual' }).click();
  await expect(conflict.getByLabel('Versión actual del recurso')).toContainText('Nota externa que debe conservarse.');
  await conflict.getByRole('button', { name: 'Reaplicar mi cambio' }).click();
  await expect(conflict).not.toBeVisible();
  const saved = await fs.readFile(absolute, 'utf8');
  expect(saved).toContain('Mi título conservado');
  expect(saved).toContain('Nota externa que debe conservarse.');
});

test('mover una ficha anidada conserva identidad y adjunto consultable', async ({ studio, page }) => {
  await studio.biblioteca();
  const dialog = await add(page, 'Ficha trasladable', [{ name: 'figura.png', mimeType: 'image/png', buffer: png }]);
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
  const [original] = (await studio.json('/api/resources')).items;
  const target = 'Recursos/archivados/ficha.md';
  await fs.mkdir(path.join(studio.root, 'notes/Recursos/archivados'));
  await studio.json('/api/move', { method: 'POST', data: { root: 'notes', from: original.path, to: target } });
  await page.reload();
  await page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Ficha trasladable/ }).click();
  await page.getByRole('region', { name: 'Ficha de consulta' }).getByRole('button', { name: 'Abrir', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ficha trasladable' })).toBeVisible();
  await expect(page.getByRole('img').filter({ visible: true }).last()).toBeVisible();
  const file = await studio.json('/api/resources/file?path=' + encodeURIComponent(target));
  expect(file.item.id).toBe(original.id);
  expect(await fs.readFile(path.join(studio.root, 'notes', file.attachments[0].path))).toEqual(png);
});

test('importar bibliografía conserva el original y exige decidir duplicados', async ({ studio, page }) => {
  await studio.biblioteca();
  const original = '% Comentario original ficticio\n@book{Ficticio2026,title={Libro importado},author={Ejemplo, Ana},year={2026},publisher={Editorial ficticia}}';
  await page.getByRole('button', { name: 'Importar bibliografía' }).click();
  const importing = page.getByRole('dialog', { name: 'Importar bibliografía' });
  await importing.getByLabel('O pegar el contenido').fill(original);
  await importing.getByRole('button', { name: 'Revisar antes de importar' }).click();
  await importing.getByRole('button', { name: 'Aplicar decisiones / Reintentar fallidos' }).click();
  await expect(importing.getByText('Referencia 1 · Guardada', { exact: true })).toBeVisible();
  await importing.getByRole('button', { name: 'Volver al origen' }).click();
  await importing.getByRole('button', { name: 'Revisar antes de importar' }).click();
  await expect(importing.getByText(/mismo original/)).toBeVisible();
  await expect(importing.getByLabel('Decisión')).toHaveValue('skip');
  await importing.getByRole('button', { name: 'Aplicar decisiones / Reintentar fallidos' }).click();
  await expect(importing.getByText('Referencia 1 · Excluida', { exact: true })).toBeVisible();
  expect((await studio.json('/api/resources')).items).toHaveLength(1);
  const dir = path.join(studio.root, 'notes/Recursos/originales');
  const originals = (await fs.readdir(dir)).filter((name) => name.endsWith('.bib'));
  expect(originals).toHaveLength(1);
  expect(await fs.readFile(path.join(dir, originals[0]), 'utf8')).toBe(original);
});

test('migrar, deshacer y restaurar en otra ubicación conserva identidad y adjuntos', async ({ studio, page }) => {
  const notes = path.join(studio.root, 'notes');
  await fs.mkdir(path.join(notes, 'Recursos/archivados'), { recursive: true });
  await fs.writeFile(path.join(notes, 'Recursos/figura.png'), png);
  const original = '---\ntype: resource\ntitle: Ficha antigua ficticia\ncaptured: 2026-10-12\nstatus: inbox\nattachment: ../figura.png\n---\nNota original ficticia.\n';
  const ficha = 'Recursos/archivados/antigua.md';
  await fs.writeFile(path.join(notes, ficha), original);
  await studio.biblioteca();
  await page.getByRole('button', { name: 'Formato y recuperación' }).click();
  const migration = page.getByRole('dialog', { name: 'Actualizar formato de Biblioteca' });
  await migration.getByRole('button', { name: 'Actualizar 1 ficha(s)', exact: true }).click();
  await expect(migration.getByText(/1\/1 fichas · Completada/)).toBeVisible();
  await migration.getByRole('button', { name: 'Deshacer conversión' }).click();
  await expect(migration.getByText(/Deshecha/)).toBeVisible();
  expect(await fs.readFile(path.join(notes, ficha), 'utf8')).toBe(original);
  await migration.getByRole('button', { name: 'Actualizar 1 ficha(s)', exact: true }).click();
  await expect(migration.getByText(/1\/1 fichas · Completada/)).toBeVisible();
  const identity = (await studio.json('/api/status')).libraryId;
  await migration.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await page.goto('about:blank');
  await studio.server.stop();
  const backup = path.join(studio.root, 'respaldo'), restored = path.join(studio.root, 'restaurada');
  await fs.mkdir(backup); await fs.mkdir(restored);
  for (const name of ['notes', 'memoria', 'data']) {
    const manifest = path.join(backup, name + '.json');
    await createManifest(path.join(studio.root, name), manifest);
    await fs.cp(path.join(studio.root, name), path.join(backup, name), { recursive: true, errorOnExist: true, force: false });
    await verifyManifest(path.join(backup, name), manifest);
    await fs.cp(path.join(backup, name), path.join(restored, name), { recursive: true, errorOnExist: true, force: false });
    await verifyManifest(path.join(restored, name), manifest);
  }
  // Corromper una copia aparte debe detectarse, manteniendo intacto el respaldo verificado.
  const partial = path.join(studio.root, 'parcial');
  await fs.cp(path.join(backup, 'notes'), partial, { recursive: true });
  await fs.rm(path.join(partial, ficha));
  await expect(verifyManifest(partial, path.join(backup, 'notes.json'))).rejects.toThrow('no coincide');
  const next = await studio.launch(restored, true);
  await studio.biblioteca(next.url);
  const status = await (await page.request.get(next.url + '/api/status')).json();
  expect(status.libraryId).toBe(identity);
  expect(status.notesDir).toBe(path.join(restored, 'notes'));
  await page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Ficha antigua ficticia/ }).click();
  await page.getByRole('region', { name: 'Ficha de consulta' }).getByRole('button', { name: 'Abrir', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ficha antigua ficticia', exact: true }).getByText('Nota original ficticia.', { exact: true })).toBeVisible();
  await expect(page.getByRole('img').filter({ visible: true }).last()).toBeVisible();
  expect(await fs.readFile(path.join(restored, 'notes/Recursos/figura.png'))).toEqual(png);
  for (const name of ['notes', 'memoria']) {
    await verifyManifest(path.join(studio.root, name), path.join(backup, name + '.json'));
    await verifyManifest(path.join(backup, name), path.join(backup, name + '.json'));
  }
});

test('bibliografía revisada, cita y figura hasta PDF portable @worker', async ({ studio, page }) => {
  test.skip(!process.env.E2E_WORKER_URL, 'Requiere un worker E2E real y su salida temporal compartida');
  test.setTimeout(120_000);
  await studio.biblioteca();
  await page.getByRole('button', { name: 'Importar bibliografía' }).click();
  const importing = page.getByRole('dialog', { name: 'Importar bibliografía' });
  await importing.getByLabel('O pegar el contenido').fill('@book{Ficticio2026,title={Libro de prueba},author={Ejemplo, Ana},year={2026},publisher={Editorial ficticia}}');
  await importing.getByRole('button', { name: 'Revisar antes de importar' }).click();
  await importing.getByRole('button', { name: 'Aplicar decisiones / Reintentar fallidos' }).click();
  await expect(importing.getByText('Referencia 1 · Guardada', { exact: true })).toBeVisible();
  await importing.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Libro de prueba/ }).click();
  await page.getByRole('region', { name: 'Ficha de consulta' }).getByRole('button', { name: 'Abrir', exact: true }).click();
  await page.getByRole('button', { name: 'Insertar cita', exact: true }).click();
  const cite = page.getByRole('dialog', { name: 'Insertar cita en la memoria' });
  await cite.getByLabel('Archivo de destino').selectOption('capitulo.tex');
  await cite.getByRole('button', { name: 'Revisar antes de aplicar' }).click();
  await expect(cite.locator('pre').first()).toContainText('\\cite{Ficticio2026}');
  await cite.getByRole('button', { name: 'Aplicar vista previa' }).click();
  await expect(cite).not.toBeVisible();
  const editor = page.locator('.cm-content[contenteditable="true"]').last();
  await expect(editor).toContainText('\\cite{Ficticio2026}');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).not.toContainText('\\cite{Ficticio2026}');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(editor).toContainText('\\cite{Ficticio2026}');
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
  const created = await add(page, 'Figura E2E', [{ name: 'figura.png', mimeType: 'image/png', buffer: png }]);
  await created.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Figura E2E/ }).click();
  await page.getByRole('region', { name: 'Ficha de consulta' }).getByRole('button', { name: 'Abrir', exact: true }).click();
  await page.getByRole('button', { name: 'Insertar figura', exact: true }).click();
  const figure = page.getByRole('dialog', { name: 'Insertar figura en la memoria' });
  await figure.getByLabel('Archivo de destino').selectOption('capitulo.tex');
  await figure.getByLabel('Pie de figura').fill('Figura ficticia E2E');
  await figure.getByLabel('Ancho (% del texto)').fill('30');
  await figure.getByRole('button', { name: 'Revisar antes de aplicar' }).click();
  await figure.getByRole('button', { name: 'Aplicar vista previa' }).click();
  await expect(figure).not.toBeVisible();
  const compiling = page.waitForResponse((r) => r.url().endsWith('/api/compile') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Guardar y compilar' }).last().click();
  const result = await (await compiling).json();
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.diagnostics).toEqual([]);
  await expect(page.getByTitle('Abrir el PDF en una pestaña')).toHaveAttribute('href', result.pdfUrl);
  await expect(page.locator('.textLayer').filter({ hasText: 'Figura ficticia E2E' })).toHaveCount(1);
  const pdf = await page.request.get(studio.server.url + result.pdfUrl);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const moved = path.join(studio.root, 'memoria-trasladada');
  await page.goto('about:blank');
  await fs.cp(path.join(studio.root, 'memoria'), moved, { recursive: true, force: false, errorOnExist: true });
  await studio.json('/api/settings', { method: 'PUT', data: { memoriaDir: moved } });
  await fs.rm(path.join(studio.root, 'notes/Recursos'), { recursive: true });
  await page.goto(studio.server.url);
  const recompiled = page.waitForResponse((r) => r.url().endsWith('/api/compile') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Compilar', exact: true }).first().click();
  const portable = await (await recompiled).json();
  expect(portable.ok, JSON.stringify(portable)).toBe(true);
  expect(portable.diagnostics).toEqual([]);
  await expect(page.getByTitle('Abrir el PDF en una pestaña')).toHaveAttribute('href', portable.pdfUrl);
  await expect(page.locator('.textLayer').filter({ hasText: 'Figura ficticia E2E' })).toHaveCount(1);
});

test('tipos, ficha con teclado y consulta estrecha en ambos temas', async ({ studio, page }) => {
  const types = ['article', 'book', 'document', 'image', 'web', 'note', 'other'];
  for (const kind of types) await studio.json('/api/capture', { method: 'POST', data: { libraryVersion: 1, title: `Tipo ${kind}`, kind, note: 'Descripción ficticia' } });
  await studio.biblioteca();
  for (const kind of types) {
    await page.getByLabel('Filtrar por tipo').selectOption(kind);
    await expect(page.getByText('1 de 7 recursos')).toBeVisible();
  }
  await page.getByLabel('Filtrar por tipo').selectOption('image');
  await expect(page.getByRole('button', { name: 'Cuadrícula', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await page.setViewportSize({ width: 660, height: 900 });
  const row = page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Tipo image/ });
  await row.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('region', { name: 'Ficha de consulta' });
  await expect(detail).toBeVisible();
  await expect(row).not.toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(detail.getByText('Licencia sin indicar')).toBeVisible();
  await detail.getByRole('button', { name: 'Volver a la lista' }).click();
  await expect(row).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
});
