import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

async function ajustes(page, url) {
  await page.goto(url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible();
}

async function memoria(page) {
  await page.getByRole('dialog', { name: 'Ajustes', exact: true }).getByRole('button', { name: 'Cerrar ajustes' }).click();
  const rail = page.getByRole('navigation', { name: 'Secciones' });
  await rail.getByRole('button', { name: 'Inicio', exact: true }).click();
  await rail.getByRole('button', { name: 'Memoria', exact: true }).click();
  await page.getByRole('tab', { name: 'Archivos', exact: true }).click();
  await page.getByRole('treeitem', { name: /tfg\.tex/ }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).not.toBeVisible();
}

test('Ajustes espera al espacio de trabajo durante el arranque @smoke', async ({ studio, page }) => {
  let release;
  const statusReady = new Promise(resolve => { release = resolve; });
  await page.route('**/api/status', async route => {
    await statusReady;
    await route.continue();
  });
  try {
    await page.goto(studio.server.url);
    const settings = page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes', exact: true });
    await expect(settings).toBeDisabled();
    release();
    await settings.click();
    await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible();
  } finally { release(); }
});

test('Ajustes abre una ventana, conserva los campos y no cambia las pestañas @smoke', async ({ studio, page }) => {
  await page.goto(studio.server.url);
  const editor = page.locator('.cm-editor');
  await expect(editor).toBeVisible();
  const width = (await editor.boundingBox()).width;
  const settings = page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Ajustes', exact: true });
  await settings.click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('.dv-tab')).toHaveCount(2);
  expect((await editor.boundingBox()).width).toBe(width);
  const field = dialog.getByLabel('Subcarpeta de recursos', { exact: true });
  await field.fill('Lecturas pendientes');
  await field.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(settings).toBeFocused();
  await settings.click();
  await expect(field).toHaveValue('Lecturas pendientes');
  expect((await studio.json('/api/settings')).values.resourcesSubdir).toBe('Recursos');
  await dialog.getByRole('button', { name: 'Descartar', exact: true }).click();
  await expect(field).toHaveValue('Recursos');
  await dialog.getByRole('button', { name: 'Elegir…', exact: true }).first().click();
  const picker = page.getByRole('dialog', { name: 'Carpeta de notas (vault)', exact: true });
  await expect(picker).toBeVisible();
  await picker.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar ajustes' }).click();
  await expect(page.getByRole('region', { name: 'PDF de Memoria', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await settings.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar ajustes' }).click();
  await expect(page.getByRole('main', { name: 'Biblioteca', exact: true })).toBeVisible();
});

test('el primer arranque sin carpetas abre Ajustes sin crear una pestaña', async ({ studio, page }) => {
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), configured: false } });
  });
  await page.goto(studio.server.url);
  const dialog = page.getByRole('dialog', { name: 'Ajustes', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Falta configurar Estudio TFG.', { exact: true })).toBeVisible();
  await expect(page.locator('.dv-tab')).toHaveCount(0);
});

test('la pestaña antigua de Ajustes migra a ventana sin perder el layout', async ({ studio, page }) => {
  const { instanceId } = await studio.json('/api/status');
  await page.addInitScript(({ key }) => {
    if (sessionStorage.getItem('layout-ficticio-preparado')) return;
    sessionStorage.setItem('layout-ficticio-preparado', '1');
    localStorage.setItem(key, JSON.stringify({
      grid: { width: 1440, height: 900, orientation: 'HORIZONTAL', root: { type: 'branch', data: [
        { type: 'leaf', size: 720, data: { id: 'izquierda', views: ['latex:tfg.tex', 'settings'], activeView: 'settings' } },
        { type: 'leaf', size: 720, data: { id: 'derecha', views: ['pdf'], activeView: 'pdf' } },
      ] } },
      panels: {
        'latex:tfg.tex': { id: 'latex:tfg.tex', contentComponent: 'latex', title: 'tfg.tex', params: { root: 'memoria', path: 'tfg.tex' } },
        settings: { id: 'settings', contentComponent: 'settings', title: 'Ajustes' },
        pdf: { id: 'pdf', contentComponent: 'pdf', title: 'PDF', renderer: 'always' },
      }, activeGroup: 'izquierda',
    }));
  }, { key: `et:layout:v1:${instanceId}` });
  await page.goto(studio.server.url);
  const dialog = page.getByRole('dialog', { name: 'Ajustes', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.dv-tab')).toHaveCount(2);
  await expect(page.locator('.dv-groupview')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Cerrar ajustes' }).click();
  await expect(page.getByRole('tab', { name: 'tfg.tex', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'PDF de Memoria', exact: true })).toBeVisible();
  await expect(dialog).not.toBeVisible();
});

test('seleccionar motor, detectar herramientas y conservar ajustes al recargar @smoke', async ({ studio, page }) => {
  const detection = await studio.json('/api/engines');
  await ajustes(page, studio.server.url);
  const globalWarning = page.locator('#root [role="status"]').filter({ hasText: 'permisos del usuario' });
  await expect(globalWarning).not.toBeVisible();
  const selector = page.getByLabel('Motor de compilación', { exact: true });
  await expect(selector).toHaveValue('docker');
  const engines = page.getByRole('region', { name: 'Disponibilidad de compilación' });
  for (const [key, tool] of Object.entries(detection.local.tools)) {
    const row = engines.getByRole('listitem').filter({ has: page.getByText(key === 'rsvg' ? 'rsvg-convert' : key, { exact: true }) });
    await expect(row).toContainText(tool.path ?? 'No encontrado en PATH');
  }
  await selector.selectOption('local');
  await expect(engines.getByText(/no es un sandbox/)).toBeVisible();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeDisabled();
  await expect.poll(async () => (await studio.json('/api/settings')).values.compileEngine).toBe('local');
  expect(JSON.parse(await fs.readFile(path.join(studio.root, 'data/settings.json'), 'utf8')).compileEngine).toBe('local');
  await expect(globalWarning).toBeVisible();
  await memoria(page);
  await expect(globalWarning).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar aviso de TeX', exact: true }).click();
  await expect(globalWarning).not.toBeVisible();
  await page.reload();
  await expect(globalWarning).not.toBeVisible();
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(selector).toHaveValue('local');
  await expect(engines.getByText(/no es un sandbox/)).toBeVisible();
  await page.getByRole('button', { name: 'Detectar herramientas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Detectar herramientas', exact: true })).toBeEnabled();
  for (const value of ['auto', 'docker']) {
    await selector.selectOption(value);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeDisabled();
    await expect.poll(async () => (await studio.json('/api/settings')).values.compileEngine).toBe(value);
    if (value === 'auto') {
      await expect(globalWarning).toBeVisible();
      await memoria(page);
      await expect(globalWarning).toBeVisible();
      await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes', exact: true }).click();
    } else await expect(globalWarning).not.toBeVisible();
  }
  await expect(engines.getByText(/no es un sandbox/)).not.toBeVisible();
});

test('si no hay herramientas, Ajustes explica qué falta y advierte de la compilación local', async ({ studio, page }) => {
  await page.route('**/api/engines', (route) => route.fulfill({ json: {
    docker: { ok: false, version: null, capabilities: { compile: false, svg2pdf: false } },
    local: { ok: false, version: null, capabilities: { compile: false, svg2pdf: false },
      tools: Object.fromEntries(['latexmk', 'biber', 'pdflatex', 'lualatex', 'rsvg'].map((key) => [key, { path: null, version: null }])),
      warnings: [], message: 'Falta latexmk en PATH; no se puede compilar con TeX del sistema.' },
  } }));
  await ajustes(page, studio.server.url);
  const engines = page.getByRole('region', { name: 'Disponibilidad de compilación' });
  await expect(engines.getByText('Falta latexmk en PATH; no se puede compilar con TeX del sistema.')).toBeVisible();
  await expect(engines.getByRole('listitem').filter({ hasText: 'No encontrado en PATH' })).toHaveCount(5);
  await page.getByLabel('Motor de compilación', { exact: true }).selectOption('auto');
  await expect(engines.getByText(/no es un sandbox/)).toBeVisible();
  await page.getByLabel('Motor de compilación', { exact: true }).selectOption('local');
  await expect(engines.getByText(/no es un sandbox/)).toBeVisible();
});
