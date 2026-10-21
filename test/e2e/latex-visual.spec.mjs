import fs from 'node:fs/promises';
import path from 'node:path';
import { add, png, test, expect } from './fixtures.mjs';

const source = String.raw`\section{Título de prueba}
Un párrafo con \textbf{negrita} y \emph{cursiva}.
Texto para formato.

% Comentario conservado: áéíóú & _
\miMacro{argumento {anidado}}
\begin{figure}[h]
\caption{Figura ficticia}
\end{figure}
`;
async function open(studio, page, text = source) {
  await fs.writeFile(path.join(studio.root, 'memoria/capitulo.tex'), text);
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Buscar', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Abrir o buscar' }).getByLabel('Buscar', { exact: true });
  await search.fill('capitulo.tex');
  await page.getByRole('option').filter({ hasText: 'capitulo.tex' }).first().click();
  await expect(page.getByRole('button', { name: 'Visual', exact: true })).toBeVisible();
}
async function code(page) {
  await page.getByRole('button', { name: 'Código', exact: true }).click();
  return page.getByRole('textbox', { name: 'Editor de código', exact: true }).filter({ visible: true });
}
async function visual(page) {
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Visual', exact: true })).toHaveAttribute('aria-pressed', 'true');
  return page.getByRole('textbox', { name: 'Editor visual de LaTeX', exact: true });
}

test('Visual conserva fuentes, muestra formato y comparte caret, deshacer, guardado y borrador @smoke', async ({ studio, page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(studio, page);
  const editor = await visual(page);
  await expect(editor.locator('.et-visual-heading')).toHaveText('Título de prueba');
  await expect(editor.locator('.et-visual-bold')).toHaveText('negrita');
  await expect(editor.locator('.et-visual-italic')).toHaveText('cursiva');
  await expect(editor.locator('.et-visual-code').filter({ hasText: '\\miMacro' })).toBeVisible();
  const originalCode = await code(page);
  await expect.poll(async () => (await originalCode.locator('.cm-line').allTextContents()).join('\n')).toBe(source);
  expect(await fs.readFile(path.join(studio.root, 'memoria/capitulo.tex'), 'utf8')).toBe(source);
  await visual(page);
  // El cursor que estaba al principio del código debe pasar al cuerpo del título.
  await editor.focus();
  await page.keyboard.insertText('Nuevo ');
  await expect(editor.locator('.et-visual-heading')).toHaveText('Nuevo Título de prueba');
  await expect(await code(page)).toContainText('\\section{Nuevo Título de prueba}');
  await page.getByRole('textbox', { name: 'Editor de código', exact: true }).filter({ visible: true }).press('ControlOrMeta+z');
  await expect(await visual(page)).not.toContainText('Nuevo');
  await page.getByRole('button', { name: 'Rehacer', exact: true }).click();
  await expect(editor).toContainText('Nuevo');
  await editor.press('ControlOrMeta+s');
  await expect.poll(() => fs.readFile(path.join(studio.root, 'memoria/capitulo.tex'), 'utf8')).toBe(source.replace('Título', 'Nuevo Título'));
  await editor.locator('.et-visual-heading').click();
  await editor.press('End');
  await page.keyboard.insertText(' pendiente');
  await expect(editor.locator('.et-visual-heading')).toContainText('pendiente');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('et:draft:')).map((key) => localStorage.getItem(key)).join(''))).toContain('pendiente');
  await page.reload();
  await page.getByRole('button', { name: 'Restaurar borrador', exact: true }).click();
  await expect(await visual(page)).toContainText('pendiente');
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(editor).not.toContainText('pendiente');
  expect(errors).toEqual([]);
});

test('controles visuales crean formato, títulos, listas y citas; texto literal se escapa', async ({ studio, page }) => {
  await open(studio, page, 'Texto para formato.\n');
  const editor = await visual(page);
  await editor.focus();
  await editor.press('Home');
  await editor.press('Shift+ArrowRight');
  await editor.press('Shift+ArrowRight');
  await editor.press('Shift+ArrowRight');
  await editor.press('Shift+ArrowRight');
  await editor.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Negrita (selección)', exact: true }).click();
  await expect(editor.locator('.et-visual-bold')).toHaveText('Texto');
  await expect(await code(page)).toContainText('\\textbf{Texto} para formato.');
  await visual(page);
  await page.getByLabel('Tipo de párrafo', { exact: true }).selectOption('section');
  await expect(editor.locator('.et-visual-heading')).toHaveText('Texto para formato.');
  await page.getByLabel('Tipo de párrafo', { exact: true }).selectOption('paragraph');
  await page.getByRole('button', { name: 'Lista numerada', exact: true }).click();
  await expect(editor.locator('.et-visual-item')).toContainText('1. Texto para formato.');
  await editor.locator('.et-visual-item').click();
  await editor.press('End');
  await page.getByLabel('Insertar cita existente', { exact: true }).selectOption('Manual2026');
  await expect(editor).toContainText('[Manual2026]');
  await editor.press('End');
  await page.keyboard.insertText(' 20% & $5 _ {dato}');
  const raw = await code(page);
  await expect(raw).toContainText('20\\% \\& \\$5 \\_ \\{dato\\}');
  await raw.press('ControlOrMeta+s');
  await expect.poll(() => fs.readFile(path.join(studio.root, 'memoria/capitulo.tex'), 'utf8')).toContain('\\begin{enumerate}');
  expect(await fs.readFile(path.join(studio.root, 'memoria/capitulo.tex'), 'utf8')).toContain('\\cite{Manual2026}');
});

test('guardar desde Visual respeta el conflicto 409 y no pisa disco', async ({ studio, page }) => {
  await open(studio, page, 'Párrafo original.\n');
  const editor = await visual(page);
  await editor.focus();
  await page.keyboard.insertText('Local ');
  const disk = 'Edición externa conservada.\n';
  await fs.writeFile(path.join(studio.root, 'memoria/capitulo.tex'), disk);
  const conflict = page.waitForResponse((response) => response.request().method() === 'PUT' && response.status() === 409);
  await editor.press('ControlOrMeta+s');
  await conflict;
  await expect(page.getByText('El archivo cambió en disco desde que lo abriste; no se ha guardado.')).toBeVisible();
  expect(await fs.readFile(path.join(studio.root, 'memoria/capitulo.tex'), 'utf8')).toBe(disk);
  await expect(editor).toContainText('Local');
  await page.getByRole('dialog', { name: 'Conflicto al guardar' }).getByRole('button', { name: 'Cargar lo del disco', exact: true }).click();
  await expect(editor).toContainText('Edición externa conservada.');
});

test('Visual escribe párrafos y continúa listas sin romper comandos ocultos; conserva composición IME', async ({ studio, page }) => {
  await open(studio, page, 'Un párrafo.\n');
  const editor = await visual(page);
  await editor.focus();
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.insertText('Segundo párrafo.');
  await expect(await code(page)).toContainText('Segundo párrafo.');
  const raw = page.getByRole('textbox', { name: 'Editor de código', exact: true }).filter({ visible: true });
  await expect.poll(async () => (await raw.locator('.cm-line').allTextContents()).join('\n')).toBe('Un párrafo.\n\nSegundo párrafo.\n');
  await visual(page);
  await page.getByRole('button', { name: 'Lista con viñetas', exact: true }).click();
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.insertText('Otra viñeta');
  await expect(editor.locator('.et-visual-item')).toHaveCount(2);
  await editor.dispatchEvent('compositionstart', { data: '' });
  await page.keyboard.insertText(' 日本語');
  await editor.dispatchEvent('compositionend', { data: ' 日本語' });
  await expect(editor).toContainText('Otra viñeta 日本語');
  await editor.press('End');
  await editor.press('Enter');
  await editor.press('Enter');
  await page.keyboard.insertText('Fuera de la lista');
  await expect(editor.locator('.et-visual-text').filter({ hasText: 'Fuera de la lista' })).toBeVisible();
  await code(page);
  await raw.press('ControlOrMeta+a');
  await raw.fill('\\section{Título}');
  await raw.press('ControlOrMeta+Home');
  await visual(page);
  await editor.press('Backspace');
  await expect(editor.locator('.et-visual-heading')).toHaveText('Título');
  await code(page);
  await expect(raw).toHaveText('\\section{Título}');
  await visual(page);
  await editor.press('Home');
  await editor.press('Shift+End');
  await page.keyboard.insertText('Título reemplazado');
  await expect(editor.locator('.et-visual-heading')).toHaveText('Título reemplazado');
  await editor.press('Home');
  await editor.press('Shift+End');
  await editor.press('Backspace');
  await page.keyboard.insertText('Título nuevo');
  await expect(editor.locator('.et-visual-heading')).toHaveText('Título nuevo');
  await editor.press('Home');
  await editor.press('Shift+End');
  const copied = await editor.evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  });
  expect(copied).toBe('Título nuevo');
  await editor.evaluate((el) => {
    const data = new DataTransfer(); data.setData('text/plain', 'Título pegado 20%');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor.locator('.et-visual-heading')).toHaveText('Título pegado 20%');
});


test('insertar una figura desde Biblioteca sigue funcionando con el destino en Visual', async ({ studio, page }) => {
  await open(studio, page, 'Texto del destino.\n');
  const editor = await visual(page);
  await editor.press('End');
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
  const created = await add(page, 'Figura ficticia visual', [{ name: 'figura.png', mimeType: 'image/png', buffer: png }]);
  await created.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.getByRole('main', { name: 'Biblioteca', exact: true }).getByRole('button', { name: /Figura ficticia visual/ }).click();
  await page.getByRole('region', { name: 'Ficha de consulta' }).getByRole('button', { name: 'Abrir', exact: true }).click();
  await page.getByRole('button', { name: 'Insertar figura', exact: true }).click();
  const figure = page.getByRole('dialog', { name: 'Insertar figura en la memoria' });
  await figure.getByLabel('Archivo de destino').selectOption('capitulo.tex');
  await figure.getByLabel('Pie de figura').fill('Figura ficticia conservada');
  await figure.getByRole('button', { name: 'Revisar antes de aplicar' }).click();
  await figure.getByRole('button', { name: 'Aplicar vista previa' }).click();
  await expect(figure).not.toBeVisible();
  await expect(editor).toBeVisible();
  await expect(editor.locator('.et-visual-code').filter({ hasText: '\\begin{figure}' })).toBeVisible();
  const raw = await code(page);
  await expect(raw).toContainText('Figura ficticia conservada');
  await raw.press('ControlOrMeta+z');
  await expect(raw).not.toContainText('Figura ficticia conservada');
});

async function selectVisibleWords(page, editor, first, last) {
  await editor.focus();
  const points = await editor.evaluate((el, { first, last }) => {
    const nodes = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    function point(word, end) {
      const node = nodes.find((node) => node.textContent.includes(word));
      if (!node) throw new Error(`No se encuentra «${word}» en el editor visual`);
      const index = node.textContent.indexOf(word) + (end ? word.length - 1 : 0);
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      return { x: end ? rect.right + .1 : rect.left + .1, y: rect.top + rect.height / 2 };
    }
    return { start: point(first, false), end: point(last, true) };
  }, { first, last });
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 12 });
  await page.mouse.up();
}

async function clipboardEvent(editor, type, text = '') {
  return editor.evaluate((el, { type, text }) => {
    const data = new DataTransfer();
    if (type === 'paste') data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  }, { type, text });
}

test('copiar rangos que cruzan formato no filtra llaves; cortar o reemplazar rangos complejos avisa sin romper la fuente', async ({ studio, page }) => {
  const original = String.raw`Antes \textbf{énfasis a lo importante} y utilizar \emph{cursivas}.`;
  await open(studio, page, original);
  const editor = await visual(page);
  await selectVisibleWords(page, editor, 'lo importante', 'utilizar');
  const expected = 'lo importante y utilizar';
  await expect.poll(() => page.evaluate(() => getSelection().toString())).toBe(expected);
  expect(await clipboardEvent(editor, 'copy')).toBe(expected);
  const dragged = await editor.evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(new DragEvent('dragstart', { dataTransfer: data, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    return data.getData('Text');
  });
  expect(dragged).toBe(expected);
  expect(await clipboardEvent(editor, 'cut')).toBe(expected);
  const feedback = page.getByRole('status').filter({ hasText: 'esta edición atraviesa formato LaTeX' });
  await expect(feedback).toBeVisible();
  await clipboardEvent(editor, 'paste', 'Texto reemplazado');
  await expect(feedback).toBeVisible();
  const raw = await code(page);
  await expect.poll(async () => (await raw.locator('.cm-line').allTextContents()).join('\n')).toBe(original);
  await raw.press('ControlOrMeta+Home');
  await visual(page);
  await clipboardEvent(editor, 'paste', expected + ' 20% ');
  await expect(editor).toContainText(expected + ' 20% Antes');
  await code(page);
  await expect(raw).toContainText(expected + ' 20\\% ' + original);
});

for (const source of [String.raw`\% de mejora`, String.raw`\cite{Manual2026} indica`]) {
  test(`se puede escribir antes y después del widget visible ${source}`, async ({ studio, page }) => {
    await open(studio, page, source);
    const editor = await visual(page);
    await page.keyboard.insertText('Antes ');
    const raw = await code(page);
    await expect(raw).toHaveText('Antes ' + source);
    await raw.press('ControlOrMeta+Home');
    const end = 'Antes '.length + source.indexOf(' ');
    for (let i = 0; i < end; i++) await raw.press('ArrowRight');
    await visual(page);
    await page.keyboard.insertText(' después');
    await code(page);
    await expect(raw).toHaveText('Antes ' + source.slice(0, source.indexOf(' ')) + ' después' + source.slice(source.indexOf(' ')));
    await expect(editor).not.toBeVisible();
  });
}

test('Intro dentro de negrita explica el rechazo de forma visible y accesible sin modificar el documento', async ({ studio, page }) => {
  const original = String.raw`Antes \textbf{texto largo} después`;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(studio, page, original);
  const raw = page.getByRole('textbox', { name: 'Editor de código', exact: true }).filter({ visible: true });
  await raw.focus();
  await raw.press('ControlOrMeta+Home');
  for (let i = 0; i < original.indexOf('largo'); i++) await raw.press('ArrowRight');
  const editor = await visual(page);
  await editor.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Usa Código para realizarla.' })).toBeVisible();
  await expect(editor.locator('.et-visual-bold')).toHaveText('texto largo');
  await code(page);
  await expect(raw).toHaveText(original);
  expect(errors).toEqual([]);
});

test('los capítulos y anexos con etiquetas finales de plantilla conservan sus labels al editar, cambiar tipo, vaciar e Intro', async ({ studio, page }) => {
  const original = String.raw`\chapter{Metodología}\label{cap:metodologia}
\chapter{Título del anexo}\label{cap:anexo-a}
`;
  await open(studio, page, original);
  const editor = await visual(page);
  await expect(editor.locator('.et-visual-heading')).toHaveText(['Metodología', 'Título del anexo']);
  await editor.press('End');
  await page.keyboard.insertText(' revisada');
  await page.getByLabel('Tipo de párrafo', { exact: true }).selectOption('section');
  const raw = await code(page);
  await expect(raw).toContainText('\\section{Metodología revisada}\\label{cap:metodologia}');
  await visual(page);
  await page.getByLabel('Tipo de párrafo', { exact: true }).selectOption('paragraph');
  await expect(editor.locator('.et-visual-text').filter({ hasText: 'Metodología revisada' })).toBeVisible();
  await page.getByLabel('Tipo de párrafo', { exact: true }).selectOption('chapter');
  await editor.press('Home');
  await editor.press('Shift+End');
  await editor.press('Backspace');
  await code(page);
  await expect(raw).toContainText('\\chapter{}\\label{cap:metodologia}');
  await visual(page);
  await page.keyboard.insertText('Metodología nueva');
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.insertText('Nuevo párrafo.');
  await code(page);
  const expected = String.raw`\chapter{Metodología nueva}\label{cap:metodologia}

Nuevo párrafo.
\chapter{Título del anexo}\label{cap:anexo-a}
`;
  await expect.poll(async () => (await raw.locator('.cm-line').allTextContents()).join('\n')).toBe(expected);
  await raw.press('ControlOrMeta+s');
  await expect.poll(() => fs.readFile(path.join(studio.root, 'memoria/capitulo.tex'), 'utf8')).toBe(expected);
});
