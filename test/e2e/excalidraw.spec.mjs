import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect, png, add } from './fixtures.mjs';
import { copyTemplate, listPerfiles } from '../../scripts/memoria-template.mjs';

async function create(page, name, template = 'vacio') {
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diagramas', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo diagrama', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo diagrama', exact: true });
  await dialog.getByLabel('Nombre', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Excalidraw', exact: true }).click();
  if (template !== 'vacio') {
    const ids = ['vacio', 'flujo', 'secuencia', 'estados', 'arquitectura', 'er', 'clases'];
    for (let i = 0; i < ids.indexOf(template); i++) await dialog.getByRole('button', { name: 'Tipo siguiente', exact: true }).click();
  }
  await dialog.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const editor = page.getByRole('region', { name: 'Editor Excalidraw', exact: true });
  await expect(editor.locator('canvas').first()).toBeVisible();
  return editor;
}

async function text(page, editor, value) {
  const canvas = editor.locator('canvas').last();
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.keyboard.press('t');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.keyboard.insertText(value);
  await page.keyboard.press('Escape');
}

test('crea, edita, guarda y reabre un dibujo sin peticiones externas @smoke', async ({ studio, page }, info) => {
  const external = [], errors = [];
  page.on('request', req => { if (!['data:', 'blob:'].some(p => req.url().startsWith(p)) && !req.url().startsWith(studio.server.url)) external.push(req.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await studio.biblioteca();
  const editor = await create(page, 'dibujo-ficticio');
  await expect(page.getByRole('main', { name: 'Diagramas', exact: true }).getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
  await text(page, editor, 'Nota ficticia: 50% y A & B');
  await expect(page.getByRole('main', { name: 'Diagramas', exact: true }).getByLabel('Estado: Sin guardar', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar', exact: true }).last().click();
  await expect(page.getByRole('main', { name: 'Diagramas', exact: true }).getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
  const content = JSON.parse(await fs.readFile(path.join(studio.root, 'memoria/diagramas/dibujo-ficticio.excalidraw'), 'utf8'));
  expect(content.elements.some(e => e.type === 'text' && e.text.includes('Nota ficticia'))).toBe(true);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Editor Excalidraw' }).locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('main', { name: 'Diagramas', exact: true }).getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.et-excalidraw .excalidraw')).toHaveClass(/theme--dark/);
  await info.attach('excalidraw-oscuro.png', { body: await editor.screenshot(), contentType: 'image/png' });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('ofrece siete opciones y crea las seis escenas con elementos editables', async ({ studio, page }) => {
  await studio.biblioteca();
  for (const id of ['flujo', 'secuencia', 'estados', 'arquitectura', 'er', 'clases']) {
    await create(page, `plantilla-${id}`, id);
    const content = JSON.parse(await fs.readFile(path.join(studio.root, `memoria/diagramas/plantilla-${id}.excalidraw`), 'utf8'));
    expect(content.elements.length).toBeGreaterThan(1);
    expect(content.elements.some(e => e.type === 'image')).toBe(false);
    await expect(page.getByRole('main', { name: 'Diagramas', exact: true }).getByLabel('Estado: Guardado', { exact: true }).last()).toBeVisible();
  }
});

test('recupera el borrador en IndexedDB y conserva un conflicto externo', async ({ studio, page }) => {
  await studio.biblioteca();
  const editor = await create(page, 'recuperable');
  await text(page, editor, 'Borrador ficticio');
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('et:diagram-drafts', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise(resolve => { const r = db.transaction('drafts').objectStore('drafts').getAll(); r.onsuccess = () => resolve(r.result.some(d => d.content.includes('Borrador ficticio'))); }); }
    finally { db.close(); }
  })).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Restaurar borrador', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Diagramas', exact: true }).getByLabel('Estado: Sin guardar', { exact: true })).toBeVisible();
  const file = path.join(studio.root, 'memoria/diagramas/recuperable.excalidraw');
  const original = JSON.parse(await fs.readFile(file, 'utf8'));
  original.appState.viewBackgroundColor = '#ffff00';
  await fs.writeFile(file, JSON.stringify(original));
  await page.getByRole('button', { name: 'Guardar', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: /conflicto|cambió/i })).toBeVisible();
  expect(JSON.parse(await fs.readFile(file, 'utf8')).appState.viewBackgroundColor).toBe('#ffff00');
});

test('Deshacer y Rehacer conservan el historial al guardar y la selección no ensucia el dibujo', async ({ studio, page }) => {
  await studio.biblioteca();
  const editor = await create(page, 'historial');
  await text(page, editor, 'Texto que se puede deshacer');
  const main = page.getByRole('main', { name: 'Diagramas', exact: true });
  const canvas = editor.locator('canvas').last(), box = await canvas.boundingBox();
  await main.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(main.getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await main.getByRole('button', { name: 'Guardar', exact: true }).click();
  const file = path.join(studio.root, 'memoria/diagramas/historial.excalidraw');
  await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).elements.filter(e => e.type === 'text' && !e.isDeleted).map(e => e.text).join('\n')).not.toContain('Texto que se puede deshacer');
  await editor.getByRole('button', { name: 'Rehacer', exact: true }).click();
  await main.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).elements.filter(e => e.type === 'text' && !e.isDeleted).map(e => e.text).join('\n')).toContain('Texto que se puede deshacer');
  await canvas.click({ position: { x: box.width / 2, y: box.height - 100 } });
  await expect(main.getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
});

test('incorpora una imagen local y la conserva dentro de la escena al reabrir', async ({ studio, page }) => {
  await studio.biblioteca();
  const editor = await create(page, 'imagen-portable');
  const canvas = editor.locator('canvas').last();
  const box = await canvas.boundingBox();
  await canvas.evaluate((el, { bytes, x, y }) => {
    const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'imagen.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  }, { bytes: [...png], x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(page.getByRole('main', { name: 'Diagramas', exact: true }).getByLabel('Estado: Sin guardar', { exact: true })).toBeVisible();
  await page.getByRole('main', { name: 'Diagramas', exact: true }).getByRole('button', { name: 'Guardar', exact: true }).click();
  const file = path.join(studio.root, 'memoria/diagramas/imagen-portable.excalidraw');
  await expect.poll(async () => Object.keys(JSON.parse(await fs.readFile(file, 'utf8')).files).length).toBe(1);
  const scene = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(Object.values(scene.files)[0].dataURL).toContain('data:image/png;base64,');
  await page.reload();
  await expect(editor.locator('canvas').last()).toBeVisible();
  await expect(page.getByRole('main', { name: 'Diagramas', exact: true }).getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
});

test('si falla la cuota del borrador permite descargar la edición actual sin tocar el original', async ({ studio, page }) => {
  await studio.biblioteca();
  const editor = await create(page, 'sin-cuota');
  const file = path.join(studio.root, 'memoria/diagramas/sin-cuota.excalidraw');
  const original = await fs.readFile(file, 'utf8');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'et:diagram-drafts') throw new DOMException('Cuota ficticia', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await text(page, editor, 'Edición recuperable sin cuota');
  const main = page.getByRole('main', { name: 'Diagramas', exact: true });
  await expect(main.getByText(/No se pudo conservar el borrador:/).first()).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await main.getByRole('button', { name: 'Descargar copia', exact: true }).click();
  const download = await downloaded;
  const copy = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(copy.elements.some(e => e.type === 'text' && e.text.includes('Edición recuperable'))).toBe(true);
  expect(await fs.readFile(file, 'utf8')).toBe(original);
});

test('desde Biblioteca copia el adjunto a Memoria conservando los bytes originales', async ({ studio, page }) => {
  await studio.biblioteca();
  const bytes = Buffer.from((await fs.readFile(new URL('../../web/src/assets/excalidraw/flujo.excalidraw', import.meta.url), 'utf8')).trimEnd());
  const dialog = await add(page, 'Dibujo original ficticio', [{ name: 'original.excalidraw', mimeType: 'application/json', buffer: bytes }]);
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Dibujo original ficticio/ }).click();
  await page.getByRole('region', { name: 'Ficha de consulta' }).getByRole('button', { name: 'Abrir', exact: true }).click();
  await page.getByRole('button', { name: 'Crear diagrama en Memoria', exact: true }).click();
  const copy = page.getByRole('dialog', { name: 'Usar el diagrama en la memoria', exact: true });
  await copy.getByLabel('Nombre', { exact: true }).fill('copia-revisada');
  await copy.getByRole('button', { name: 'Copiar a la memoria', exact: true }).click();
  await expect(copy).not.toBeVisible();
  expect(await fs.readFile(path.join(studio.root, 'memoria/diagramas/copia-revisada.excalidraw'))).toEqual(bytes);
  const resource = (await studio.json('/api/resources')).items.find(r => r.title === 'Dibujo original ficticio');
  const source = await studio.json('/api/resources/file?path=' + encodeURIComponent(resource.path));
  expect(await fs.readFile(path.join(studio.root, 'notes', source.attachments[0].path))).toEqual(bytes);
});

test('exporta las seis plantillas como SVG autónomo y PDF a 300 ppp sin motor local', async ({ studio, page }) => {
  await studio.biblioteca();
  const external = [];
  page.on('request', req => { if (!/^(data:|blob:)/.test(req.url()) && !req.url().startsWith(studio.server.url)) external.push(req.url()); });
  for (const id of ['flujo', 'secuencia', 'estados', 'arquitectura', 'er', 'clases']) {
    await create(page, `exportar-${id}`, id);
    const main = page.getByRole('main', { name: 'Diagramas', exact: true });
    const exported = page.waitForResponse(r => r.url().endsWith('/api/diagramas/exportar') && r.request().method() === 'POST');
    await main.getByRole('button', { name: 'Exportar', exact: true }).click();
    const response = await exported;
    expect(response.ok(), await response.text()).toBe(true);
    const svg = await fs.readFile(path.join(studio.root, `memoria/figuras/diagramas/exportar-${id}.svg`), 'utf8');
    expect(svg).toMatch(/url\(data:font\/woff2;base64,/);
    expect(svg).not.toMatch(/url\(["']?https?:/);
    const pdf = await fs.readFile(path.join(studio.root, `memoria/figuras/diagramas/exportar-${id}.pdf`));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const width = Number(/viewBox="[^"]*?\s([\d.]+)\s[\d.]+"/.exec(svg)?.[1]);
    expect(Number(/\/Width (\d+)/.exec(pdf.toString('latin1'))?.[1])).toBeCloseTo(Math.ceil(width * 300 / 96), 0);
    if (process.env.E2E_EXCALIDRAW_OUT) {
      await fs.mkdir(process.env.E2E_EXCALIDRAW_OUT, { recursive: true });
      await fs.writeFile(path.join(process.env.E2E_EXCALIDRAW_OUT, `${id}.pdf`), pdf);
      await fs.writeFile(path.join(process.env.E2E_EXCALIDRAW_OUT, `${id}.svg`), svg);
    }
  }
  expect(external).toEqual([]);
});

test('renombrar conserva la escena abierta, su borrador y la figura exportada', async ({ studio, page }) => {
  await studio.biblioteca();
  const editor = await create(page, 'antes-de-renombrar');
  await text(page, editor, 'Texto que conserva su nombre nuevo');
  const main = page.getByRole('main', { name: 'Diagramas', exact: true });
  const exported = page.waitForResponse(r => r.url().endsWith('/api/diagramas/exportar') && r.request().method() === 'POST');
  await main.getByRole('button', { name: 'Exportar', exact: true }).click();
  expect((await exported).ok()).toBe(true);
  await page.getByRole('list', { name: 'Diagramas de la memoria' }).getByRole('listitem').filter({ hasText: 'antes-de-renombrar' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Renombrar…', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Renombrar diagrama', exact: true });
  await rename.getByRole('textbox').fill('despues-de-renombrar');
  await rename.getByRole('button', { name: 'Renombrar', exact: true }).click();
  await expect(rename).not.toBeVisible();
  await expect(main.getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
  const file = path.join(studio.root, 'memoria/diagramas/despues-de-renombrar.excalidraw');
  await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).elements.some(e => e.text?.includes('conserva su nombre'))).toBe(true);
  const again = page.waitForResponse(r => r.url().endsWith('/api/diagramas/exportar') && r.request().method() === 'POST');
  await main.getByRole('button', { name: 'Exportar', exact: true }).click();
  expect((await again).ok()).toBe(true);
  await text(page, editor, 'Edición después del cambio de nombre');
  await expect(main.getByLabel('Estado: Sin guardar', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByText('Hay un borrador local')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar borrador', exact: true }).click();
  await main.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).elements.some(e => e.text?.includes('Edición después'))).toBe(true);
});

test('rechaza una exportación desmesurada sin crear figuras ni perder la escena', async ({ studio, page }) => {
  await studio.biblioteca();
  await create(page, 'demasiado-grande', 'flujo');
  const file = path.join(studio.root, 'memoria/diagramas/demasiado-grande.excalidraw');
  const scene = JSON.parse(await fs.readFile(file, 'utf8'));
  const rectangle = scene.elements.find(e => e.type === 'rectangle');
  scene.elements = [{ ...rectangle, width: 100_000, height: 100, boundElements: null }];
  const original = JSON.stringify(scene);
  await fs.writeFile(file, original);
  await page.reload();
  const main = page.getByRole('main', { name: 'Diagramas', exact: true });
  await expect(main.getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByText(/El dibujo es demasiado grande para exportarlo/)).toBeVisible();
  expect(await fs.readFile(file, 'utf8')).toBe(original);
  expect(await fs.stat(path.join(studio.root, 'memoria/figuras/diagramas/demasiado-grande.pdf')).catch(() => null)).toBeNull();
});

test('inserta Excalidraw con imagen y compila ambos perfiles tras trasladar la memoria sin Biblioteca @worker', async ({ studio, page }) => {
  test.skip(!process.env.E2E_WORKER_URL, 'Requiere un worker real y su salida temporal');
  test.setTimeout(300_000);
  const output = process.env.E2E_WORKER_OUT;
  for (const { id } of listPerfiles()) {
    const memoria = path.join(studio.root, `memoria-${id}`);
    copyTemplate(memoria, { perfil: id });
    const manual = await fs.readFile(path.join(memoria, 'bibliografia.bib'));
    await studio.json('/api/settings', { method: 'PUT', data: { memoriaDir: memoria } });
    await studio.biblioteca();
    const editor = await create(page, 'excalidraw-portable', 'arquitectura');
    const canvas = editor.locator('canvas').last(), box = await canvas.boundingBox();
    await canvas.evaluate((el, { bytes, x, y }) => {
      const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'imagen-ficticia.png', { type: 'image/png' }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    }, { bytes: [...png], x: box.x + box.width - 150, y: box.y + box.height - 100 });
    const main = page.getByRole('main', { name: 'Diagramas', exact: true });
    await expect(main.getByLabel('Estado: Sin guardar', { exact: true })).toBeVisible();
    await main.getByRole('button', { name: 'Insertar en la memoria', exact: true }).click();
    const insert = page.getByRole('dialog', { name: 'Insertar en la memoria', exact: true });
    const destination = insert.getByRole('combobox', { name: 'Capítulo o apartado destino', exact: true });
    const option = destination.locator('option').filter({ hasText: '01-introduccion.tex' }).first();
    await expect(option).toBeAttached();
    await destination.selectOption(await option.getAttribute('value'));
    await insert.getByLabel('Pie de figura', { exact: true }).fill('Arquitectura verificada al 50%: A & B');
    await insert.getByLabel('Ancho (% del texto)', { exact: true }).fill('50');
    await insert.getByRole('button', { name: 'Insertar', exact: true }).click();
    await expect(insert).not.toBeVisible();
    const source = await fs.readFile(path.join(memoria, 'diagramas/excalidraw-portable.excalidraw'));
    expect(Object.keys(JSON.parse(source).files)).toHaveLength(1);
    const chapter = await fs.readFile(path.join(memoria, '1-capitulos/01-introduccion.tex'), 'utf8');
    expect(chapter).toContain('\\includegraphics[width=0.5\\textwidth]{diagramas/excalidraw-portable}');
    expect(chapter).toContain('50\\%: A \\& B');
    await fs.copyFile(path.join(memoria, 'figuras/diagramas/excalidraw-portable.pdf'), path.join(output, `excalidraw-figura-${id}.pdf`));
    async function compile(stage) {
      const result = await studio.json('/api/compile', { method: 'POST' });
      await fs.writeFile(path.join(output, `resultado-excalidraw-${id}-${stage}.json`), JSON.stringify(result, null, 2));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.diagnostics, JSON.stringify(result)).toEqual([]);
      const response = await page.request.get(studio.server.url + result.pdfUrl);
      expect(response.ok()).toBe(true);
      await fs.writeFile(path.join(output, `excalidraw-${id}-${stage}.pdf`), await response.body());
    }
    await compile('original');
    await page.goto('about:blank');
    const moved = memoria + '-trasladada', offline = path.join(studio.root, 'biblioteca-apartada');
    await fs.cp(memoria, moved, { recursive: true, force: false, errorOnExist: true });
    await fs.rename(path.join(studio.root, 'notes/Recursos'), offline);
    try {
      await studio.json('/api/settings', { method: 'PUT', data: { memoriaDir: moved } });
      await compile('trasladada');
      expect(await fs.readFile(path.join(moved, 'diagramas/excalidraw-portable.excalidraw'))).toEqual(source);
      expect(await fs.readFile(path.join(moved, 'bibliografia.bib'))).toEqual(manual);
    } finally { await fs.rename(offline, path.join(studio.root, 'notes/Recursos')); }
  }
});
