import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

async function ajustes(page, url) {
  await page.goto(url);
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible();
}

async function memoria(page) {
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

test('seleccionar motor, detectar herramientas y conservar ajustes al recargar @smoke', async ({ studio, page }) => {
  const detection = await studio.json('/api/engines');
  await ajustes(page, studio.server.url);
  const globalWarning = page.getByRole('status').filter({ hasText: 'permisos del usuario' });
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
  await page.reload();
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
      tools: Object.fromEntries(['latexmk', 'biber', 'pdflatex', 'rsvg'].map((key) => [key, { path: null, version: null }])),
      warnings: [], message: 'Falta latexmk en PATH; no se puede compilar con TeX del sistema.' },
  } }));
  await ajustes(page, studio.server.url);
  const engines = page.getByRole('region', { name: 'Disponibilidad de compilación' });
  await expect(engines.getByText('Falta latexmk en PATH; no se puede compilar con TeX del sistema.')).toBeVisible();
  await expect(engines.getByRole('listitem').filter({ hasText: 'No encontrado en PATH' })).toHaveCount(4);
  await page.getByLabel('Motor de compilación', { exact: true }).selectOption('auto');
  await expect(engines.getByText(/no es un sandbox/)).toBeVisible();
  await page.getByLabel('Motor de compilación', { exact: true }).selectOption('local');
  await expect(engines.getByText(/no es un sandbox/)).toBeVisible();
});
