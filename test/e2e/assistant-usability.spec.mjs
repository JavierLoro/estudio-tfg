import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

async function setup(studio, page) {
  const { instanceId } = await studio.json('/api/status'), threads = [], created = [], turns = [];
  const id = 'a'.repeat(24);
  let active = 'cuenta-ficticia';
  const account = () => ({ active, accounts: ['cuenta-ficticia', 'otra-cuenta'].map(id => ({ id, label: id, connected: true, enabled: true })), pending: false, error: '', persistent: false });
  await page.addInitScript(() => { for (const id of ['cuenta-ficticia', 'otra-cuenta']) localStorage.setItem('et:chatgpt:welcome:' + id, 'true'); });
  await page.route('**/api/desktop/setup', route => route.fulfill({ json: { needsSetup: false, engine: { phase: 'ready', available: true, installed: true, current: true } } }));
  await page.route('**/api/assistant/**', route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/assistant', '');
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    if (endpoint === '/account') return route.fulfill({ json: account() });
    if (endpoint === '/account/select') { active = body.id; return route.fulfill({ json: account() }); }
    if (endpoint === '/models') return route.fulfill({ json: { models: [{ id: 'modelo-ficticio', name: 'Modelo ficticio' }] } });
    if (endpoint === '/threads' && body) {
      created.push(body);
      const thread = { id: `hilo-${created.length}`, account: active, instance: instanceId, title: 'Chat ficticio', model: body.model, scope: body.scope, messages: [], sources: [], proposals: [], state: 'idle' };
      threads.push(thread); return route.fulfill({ json: thread });
    }
    if (endpoint === '/threads') return route.fulfill({ json: { threads } });
    const thread = threads.find(t => endpoint.startsWith('/threads/' + t.id));
    if (!thread) throw new Error(`Petición sin fixture: ${endpoint}`);
    if (endpoint.endsWith('/turns')) {
      turns.push(body); thread.state = 'running';
      thread.messages.push({ role: 'user', text: body.text }, { role: 'assistant', text: '' });
    } else if (thread.state === 'running') {
      thread.state = 'idle';
      const source = { id, root: 'memoria', path: 'tfg.tex', title: 'tfg.tex' };
      thread.sources = [source];
      thread.messages.at(-1).text = `**Resumen ficticio**\n\n- Primera idea\n- Segunda idea\n\n[fuente:${id}]\n\n<script>alert(1)</script>\n\n![remota](https://ejemplo.invalid/imagen.png) [peligro](javascript:alert(1))`;
      thread.messages.push({ role: 'tool', text: 'Consulta: tfg.tex' });
      thread.proposals = [{ id: 'propuesta-ficticia', state: 'prepared', files: [{ source, before: 'Título\nTexto original\nFinal\n', after: 'Título\nTexto revisado\nFinal\n', baseRev: 'base', afterRev: 'nueva', applied: false }] }];
    }
    return route.fulfill({ json: thread });
  });
  await page.goto(studio.server.url);
  const navigation = page.getByRole('navigation', { name: 'Secciones' });
  await navigation.getByRole('button', { name: 'Memoria', exact: true }).click();
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  await navigation.getByRole('button', { name: 'Asistente', exact: true }).click();
  const floating = page.getByRole('dialog', { name: 'Asistente', exact: true });
  return { floating, created, turns, threads, composer: floating.getByRole('textbox', { name: 'Mensaje al asistente' }), send: floating.getByRole('button', { name: 'Enviar', exact: true }) };
}

test('adjuntar sin permiso conserva el mensaje y exige autorizar solo esos documentos antes de crear o enviar', async ({ studio, page }, info) => {
  const { floating, created, turns, threads, composer, send } = await setup(studio, page);
  await composer.fill('Consulta inicial sin documentos'); await send.click();
  await expect(floating.getByRole('button', { name: 'Revisar cambios', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enviar selección o documento al asistente' }).click();
  await composer.fill('Mi mensaje pendiente no se pierde');
  await expect(send).toBeDisabled();
  await floating.getByRole('button', { name: 'Autorizar documentos adjuntos' }).click();
  const dialog = page.getByRole('dialog', { name: 'Autorizar documentos adjuntos', exact: true });
  await expect(dialog).toContainText('OpenAI');
  await expect(dialog).toContainText('conversación nueva');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await page.screenshot({ path: info.outputPath('autorizacion-contextual.png') });
  await dialog.press('Escape');
  await expect(composer).toHaveValue('Mi mensaje pendiente no se pierde');
  await expect(floating.getByRole('list', { name: 'Contexto adjunto' })).toContainText('tfg.tex');
  expect(created).toHaveLength(1); expect(turns).toHaveLength(1);
  await floating.getByRole('button', { name: 'Autorizar documentos adjuntos' }).click();
  await dialog.getByRole('button', { name: 'Permitir solo estos documentos' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(composer).toHaveValue('Mi mensaje pendiente no se pierde');
  await expect(send).toBeEnabled();
  expect(created).toHaveLength(1); expect(turns).toHaveLength(1);
  await send.click(); await expect.poll(() => created.length).toBe(2);
  expect(created[1].scope).toEqual({ memoria: false, library: false, diagrams: false, attachments: false, prepareChanges: false, notes: [], documents: [{ root: 'memoria', path: 'tfg.tex' }] });
  expect(threads[0].scope.documents).toEqual([]);
  await expect.poll(() => turns.length).toBe(2);
  expect(turns[1].context[0].path).toBe('tfg.tex');
  // La autorización puntual no cambia las preferencias generales.
  await expect(floating.getByRole('button', { name: 'Revisar cambios', exact: true })).toBeVisible();
  await floating.getByRole('button', { name: 'Ajustes del asistente' }).click();
  const settings = page.getByRole('dialog', { name: 'Ajustes', exact: true });
  await expect(settings.getByRole('heading', { name: 'Esta conversación', exact: true })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Próximas conversaciones', exact: true })).toBeVisible();
  for (const checkbox of await settings.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
});

test('acciones sin envío automático, respuesta legible y revisión de cambios accesible', async ({ studio, page }, info) => {
  const { floating, turns, composer, send } = await setup(studio, page);
  await composer.fill('Mi intención original.');
  await floating.getByRole('button', { name: 'Mejorar redacción', exact: true }).click();
  await expect(composer).toBeFocused(); await expect(composer).toHaveValue(/^Mi intención original\./);
  expect(turns).toHaveLength(0);
  await floating.getByRole('button', { name: 'Autorizar documentos adjuntos' }).click();
  const authorize = page.getByRole('dialog', { name: 'Autorizar documentos adjuntos', exact: true });
  await authorize.getByRole('checkbox').check();
  await authorize.getByRole('button', { name: 'Permitir solo estos documentos' }).click();
  await send.click();
  const review = floating.getByRole('button', { name: 'Revisar cambios', exact: true });
  await expect(review).toBeVisible();
  await expect(floating.getByRole('status').filter({ hasText: 'Respuesta completada.' })).toBeVisible();
  await expect(floating.locator('strong').filter({ hasText: 'Resumen ficticio' })).toBeVisible();
  await expect(floating.getByRole('button', { name: 'tfg.tex', exact: true }).first()).toBeVisible();
  await expect(floating.locator('img, script')).toHaveCount(0);
  await expect(floating.locator('a[href^="javascript:"]')).toHaveCount(0);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await floating.getByRole('button', { name: 'Copiar respuesta' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Resumen ficticio');
  await review.click();
  const dialog = page.getByRole('dialog', { name: 'Revisar y guardar cambios', exact: true });
  await expect(dialog.getByLabel('Texto que se retira')).toHaveText('Texto original\n');
  await expect(dialog.getByLabel('Texto que se añade')).toHaveText('Texto revisado\n');
  await expect(dialog.getByText('Comparar archivos completos', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('revision-legible.png') });
  await dialog.press('Escape'); await expect(review).toBeFocused();
  const resize = floating.getByRole('button', { name: 'Cambiar tamaño del asistente' });
  const before = await floating.boundingBox();
  await resize.focus(); await resize.press('ArrowRight');
  expect((await floating.boundingBox()).width).toBe(before.width + 20);
  await resize.press('Home'); expect((await floating.boundingBox()).width).toBe(380);
  await page.setViewportSize({ width: 700, height: 560 });
  await expect(send).toBeInViewport();
  await expect(resize).toBeInViewport();
});

test('elige una carpeta sin escribir rutas y la autorización sigue separada de Biblioteca', async ({ studio, page }) => {
  await fs.mkdir(path.join(studio.root, 'notes/Investigación'));
  const { floating } = await setup(studio, page);
  await floating.getByRole('button', { name: 'Ajustes del asistente' }).click();
  const settings = page.getByRole('dialog', { name: 'Ajustes', exact: true });
  await settings.getByRole('button', { name: 'Elegir carpeta de notas…' }).click();
  const picker = page.getByRole('dialog', { name: 'Elegir carpeta de notas para el asistente', exact: true });
  await picker.getByRole('button', { name: 'Recursos', exact: true }).click();
  await expect(picker).toContainText('Esta carpeta pertenece a Biblioteca');
  await expect(picker.getByRole('button', { name: 'Seleccionar esta carpeta', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Carpeta superior', exact: true }).click();
  await picker.getByRole('button', { name: 'Investigación', exact: true }).click();
  await picker.getByRole('button', { name: 'Seleccionar esta carpeta', exact: true }).click();
  await expect(picker).not.toBeVisible();
  await expect(settings.getByRole('button', { name: 'Retirar carpeta Investigación' })).toBeVisible();
  await expect(settings.getByRole('checkbox', { name: 'Fichas y metadatos de Biblioteca', exact: true })).not.toBeChecked();
  await settings.getByRole('button', { name: 'Retirar carpeta Investigación' }).click();
  await expect(settings.getByRole('button', { name: 'Retirar carpeta Investigación' })).toHaveCount(0);
});

test('una autorización puntual pendiente no pasa a otra cuenta', async ({ studio, page }) => {
  const { floating, created, turns, composer, send } = await setup(studio, page);
  await floating.getByRole('button', { name: 'Mejorar redacción', exact: true }).click();
  await floating.getByRole('button', { name: 'Autorizar documentos adjuntos' }).click();
  const dialog = page.getByRole('dialog', { name: 'Autorizar documentos adjuntos', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Permitir solo estos documentos' }).click();
  expect(created).toHaveLength(0); expect(turns).toHaveLength(0);
  await floating.getByRole('button', { name: 'Cuenta del asistente' }).click();
  const account = page.getByRole('dialog', { name: 'Cuenta del asistente', exact: true });
  await account.getByRole('combobox', { name: 'Cuenta de ChatGPT' }).selectOption('otra-cuenta');
  await account.press('Escape');
  await expect(composer).toHaveValue('');
  await expect(floating.getByRole('list', { name: 'Contexto adjunto' })).toHaveCount(0);
  await composer.fill('Consulta sin adjuntos desde otra cuenta'); await send.click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0].scope).toMatchObject({ memoria: false, library: false, notes: [], prepareChanges: false, documents: [] });
});
