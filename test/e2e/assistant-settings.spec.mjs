import { test, expect } from './fixtures.mjs';

for (const connected of [false, true]) {
  test(`el botón visible abre la cuenta ${connected ? 'pendiente de autorizar' : 'sin conectar'} y conserva el mensaje`, async ({ studio, page }) => {
    await page.route('**/api/desktop/setup', route => route.fulfill({ json: { needsSetup: false, engine: { phase: 'ready', available: true, installed: true, current: true, received: 0, total: 0, message: null, version: 'ficticio', variant: 'online' } } }));
    let connections = 0;
    await page.route('**/api/assistant/account', route => route.fulfill({ json: {
      active: connected ? 'cuenta-ficticia' : null,
      accounts: connected ? [{ id: 'cuenta-ficticia', label: 'Cuenta ficticia', connected: true, enabled: false }] : [],
      pending: false, error: '', persistent: false,
    } }));
    await page.route('**/api/assistant/account/connect', route => { connections++; return route.abort(); });
    await page.goto(studio.server.url);
    await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Asistente', exact: true }).click();
    const floating = page.getByRole('dialog', { name: 'Asistente', exact: true });
    const composer = floating.getByRole('textbox', { name: 'Mensaje al asistente', exact: true });
    await composer.fill('Consulta pendiente ficticia');
    await floating.getByRole('button', { name: connected ? 'Autorizar cuenta' : 'Conectar cuenta', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Cuenta del asistente', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: connected ? 'Autorizar uso del plan' : 'Continuar con ChatGPT', exact: true })).toBeVisible();
    await expect(dialog.getByRole('status', { name: 'Configurar permisos tras conectar' })).toHaveCount(0);
    expect(connections).toBe(0);
    await dialog.press('Escape');
    await expect(composer).toHaveValue('Consulta pendiente ficticia');
    await expect(floating.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
  });
}

test('tras conectar recomienda configurar permisos y abre Ajustes sin concederlos ni perder el borrador', async ({ studio, page }) => {
  let phase = 'disconnected', sent = 0;
  const account = () => ({ active: phase === 'connected' ? 'cuenta-ficticia' : null,
    accounts: phase === 'connected' ? [{ id: 'cuenta-ficticia', label: 'Cuenta ficticia', connected: true, enabled: true }] : [],
    pending: phase === 'pending', error: '', persistent: false });
  await page.route('**/api/desktop/setup', route => route.fulfill({ json: { needsSetup: false, engine: { phase: 'ready', available: true, installed: true, current: true } } }));
  await page.route('**/api/assistant/**', route => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/assistant', '');
    if (endpoint === '/account/connect') { phase = 'pending'; return route.fulfill({ json: account() }); }
    if (endpoint === '/account') { if (phase === 'pending') phase = 'connected'; return route.fulfill({ json: account() }); }
    if (endpoint === '/models') return route.fulfill({ json: { models: [{ id: 'modelo-ficticio', name: 'Modelo ficticio' }] } });
    if (endpoint === '/threads' && route.request().method() === 'GET') return route.fulfill({ json: { threads: [] } });
    sent++; return route.abort();
  });
  await page.goto(studio.server.url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Asistente', exact: true }).click();
  const floating = page.getByRole('dialog', { name: 'Asistente', exact: true });
  await floating.getByRole('button', { name: 'Conectar cuenta', exact: true }).click();
  const accountDialog = page.getByRole('dialog', { name: 'Cuenta del asistente', exact: true });
  await accountDialog.getByRole('button', { name: 'Continuar con ChatGPT', exact: true }).click();
  const welcome = page.getByRole('dialog', { name: 'Estás usando tu plan de ChatGPT', exact: true });
  await expect(welcome.getByRole('status', { name: 'Configurar permisos tras conectar' })).toContainText('Conectar la cuenta no concede acceso a tus archivos');
  await welcome.getByRole('button', { name: 'Configurar permisos', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Ajustes', exact: true });
  await expect(accountDialog).not.toBeVisible(); await expect(welcome).not.toBeVisible();
  await expect(settings.getByRole('tab', { name: 'Asistente', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => settings.evaluate(el => el.contains(document.activeElement))).toBe(true);
  const permissions = settings.getByRole('region', { name: 'Permisos del asistente', exact: true });
  for (const checkbox of await permissions.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
  await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  const composer = floating.getByRole('textbox', { name: 'Mensaje al asistente', exact: true });
  await composer.fill('Borrador ficticio después de conectar');
  const before = await floating.boundingBox();
  await floating.getByRole('button', { name: 'Cuenta del asistente', exact: true }).click();
  await expect(accountDialog.getByRole('status', { name: 'Configurar permisos tras conectar' })).toBeVisible();
  await accountDialog.getByRole('button', { name: 'Configurar permisos', exact: true }).click();
  await expect(accountDialog).not.toBeVisible();
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  await expect(composer).toHaveValue('Borrador ficticio después de conectar');
  expect((await floating.boundingBox()).x).toBe(before.x);
  expect((await floating.boundingBox()).y).toBe(before.y);
  expect(sent).toBe(0);
});

test('permisos en Ajustes, cuenta por icono y modelo junto a Enviar @smoke', async ({ studio, page }) => {
  const created = [], threads = [];
  let active = 'cuenta-ficticia';
  const { instanceId } = await studio.json('/api/status');
  const account = () => ({ active, accounts: ['cuenta-ficticia', 'otra-cuenta'].map(id => ({ id, label: id, connected: true, enabled: true })), pending: false, error: '', persistent: false });
  await page.addInitScript(() => {
    for (const id of ['cuenta-ficticia', 'otra-cuenta']) localStorage.setItem('et:chatgpt:welcome:' + id, 'true');
  });
  await page.route('**/api/desktop/setup', route => route.fulfill({ json: { needsSetup: false, engine: { phase: 'ready', available: true, installed: true, current: true, received: 0, total: 0, message: null, version: 'ficticio', variant: 'online' } } }));
  await page.route('**/api/assistant/**', async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/assistant', '');
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    if (endpoint === '/account/select') { active = body.id; return route.fulfill({ json: account() }); }
    if (endpoint === '/account') return route.fulfill({ json: account() });
    if (endpoint === '/models') return route.fulfill({ json: { models: [{ id: 'modelo-a', name: 'Modelo A ficticio' }, { id: 'modelo-b', name: 'Modelo B ficticio' }] } });
    if (endpoint === '/threads' && body) {
      created.push(body);
      const thread = { id: `hilo-${created.length}`, account: active, instance: instanceId, title: 'Conversación ficticia', model: body.model, scope: body.scope, messages: [], sources: [], proposals: [], state: 'idle' };
      threads.push(thread);
      return route.fulfill({ json: thread });
    }
    if (endpoint === '/threads') return route.fulfill({ json: { threads: threads.filter(t => t.account === active) } });
    const thread = threads.find(t => endpoint.startsWith('/threads/' + t.id));
    if (thread && endpoint.endsWith('/revoke')) thread.revoked = true;
    if (thread && endpoint.endsWith('/turns')) thread.messages.push({ role: 'user', text: body.text });
    if (thread) return route.fulfill({ json: thread });
    throw new Error(`Petición del asistente sin fixture: ${endpoint}`);
  });
  await page.goto(studio.server.url);
  const navigation = page.getByRole('navigation', { name: 'Secciones' });
  await navigation.getByRole('button', { name: 'Memoria', exact: true }).click();
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  await navigation.getByRole('button', { name: 'Asistente', exact: true }).click();
  const floating = page.getByRole('dialog', { name: 'Asistente', exact: true });
  const composer = floating.getByRole('textbox', { name: 'Mensaje al asistente', exact: true });
  const model = floating.getByRole('combobox', { name: 'Modelo del asistente', exact: true });
  await expect(model).toHaveValue('modelo-a');
  await expect(floating.getByRole('checkbox')).toHaveCount(0);
  await expect(floating.getByRole('region', { name: 'Cuenta de ChatGPT' })).toHaveCount(0);
  const send = floating.getByRole('button', { name: 'Enviar', exact: true });
  expect(Math.abs((await send.boundingBox()).y - (await model.boundingBox()).y)).toBeLessThan(8);
  await composer.fill('Borrador ficticio conservado');
  const before = await floating.boundingBox();
  await floating.getByRole('button', { name: 'Ajustes del asistente', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Ajustes', exact: true });
  const assistantTab = settings.getByRole('tab', { name: 'Asistente', exact: true });
  await expect(assistantTab).toHaveAttribute('aria-selected', 'true');
  const permissions = settings.getByRole('region', { name: 'Permisos del asistente', exact: true });
  for (const checkbox of await permissions.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
  await permissions.getByRole('checkbox', { name: 'Memoria actual (diagramas aparte)', exact: true }).check();
  await permissions.getByText('Introducir rutas manualmente', { exact: true }).click();
  await permissions.getByRole('textbox', { name: 'Carpetas de notas permitidas', exact: true }).fill('Investigación\nIdeas');
  await expect(settings.getByRole('button', { name: 'Guardar', exact: true })).not.toBeVisible();
  await assistantTab.press('ArrowLeft');
  await expect(settings.getByRole('tab', { name: 'General', exact: true })).toBeFocused();
  const resources = settings.getByLabel('Subcarpeta de recursos', { exact: true });
  await resources.fill('Campo general pendiente');
  await settings.getByRole('tab', { name: 'General', exact: true }).press('ArrowRight');
  await expect(permissions.getByRole('checkbox', { name: 'Memoria actual (diagramas aparte)', exact: true })).toBeChecked();
  await permissions.getByRole('checkbox', { name: 'Memoria actual (diagramas aparte)', exact: true }).uncheck();
  await permissions.getByText('Elegir archivos abiertos concretos', { exact: true }).click();
  await permissions.getByRole('checkbox', { name: 'Memoria · tfg.tex', exact: true }).check();
  await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  await expect(composer).toHaveValue('Borrador ficticio conservado');
  expect((await floating.boundingBox()).x).toBe(before.x);
  await model.selectOption('modelo-b');
  await send.click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toEqual({ model: 'modelo-b', scope: { memoria: false, library: false, notes: ['Investigación', 'Ideas'], diagrams: false, attachments: false, prepareChanges: false, documents: [{ root: 'memoria', path: 'tfg.tex' }] } });
  await expect(model).toBeDisabled();
  await floating.getByRole('button', { name: 'Ajustes del asistente', exact: true }).click();
  await permissions.getByRole('checkbox', { name: 'Fichas y metadatos de Biblioteca', exact: true }).check();
  await permissions.getByRole('checkbox', { name: 'Consultar diagramas', exact: true }).check();
  await permissions.getByRole('checkbox', { name: 'Consultar PDF e imágenes de las fuentes autorizadas', exact: true }).check();
  await permissions.getByRole('checkbox', { name: 'Preparar cambios en textos existentes autorizados', exact: true }).check();
  expect(threads[0].scope.library).toBe(false);
  expect(threads[0].scope.prepareChanges).toBe(false);
  await expect(permissions).toContainText('Las conversaciones existentes mantienen sus permisos originales');
  await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  await floating.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await composer.fill('Otra consulta ficticia');
  await send.click();
  await expect.poll(() => created.length).toBe(2);
  expect(created[1].scope).toMatchObject({ library: true, diagrams: true, attachments: true, prepareChanges: true });
  await floating.getByRole('button', { name: 'Ajustes del asistente', exact: true }).click();
  await permissions.getByRole('button', { name: 'Retirar acceso de esta conversación', exact: true }).click();
  await expect(permissions.getByRole('status')).toContainText('Acceso retirado');
  expect(threads[1].revoked).toBe(true);
  await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  await composer.fill('Mensaje que no debe salir');
  await expect(send).toBeDisabled();
  await expect(floating.getByRole('status').filter({ hasText: 'Acceso retirado' })).toBeVisible();
  await floating.getByRole('button', { name: 'Cuenta del asistente', exact: true }).click();
  const accountDialog = page.getByRole('dialog', { name: 'Cuenta del asistente', exact: true });
  await expect(accountDialog.getByRole('button', { name: 'Desconectar', exact: true })).toBeVisible();
  await accountDialog.getByRole('combobox', { name: 'Cuenta de ChatGPT', exact: true }).selectOption('otra-cuenta');
  await accountDialog.press('Escape');
  await expect(composer).toHaveValue('');
  await floating.getByRole('button', { name: 'Ajustes del asistente', exact: true }).click();
  for (const checkbox of await permissions.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
  await expect(permissions.getByRole('textbox', { includeHidden: true })).toHaveValue('');
  await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  await navigation.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(settings.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(resources).toHaveValue('Campo general pendiente');
  expect((await studio.json('/api/settings')).values.resourcesSubdir).toBe('Recursos');
});
