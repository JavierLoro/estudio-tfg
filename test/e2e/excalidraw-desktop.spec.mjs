import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron, test, expect } from '@playwright/test';
import { copyTemplate } from '../../scripts/memoria-template.mjs';

const repo = path.resolve(import.meta.dirname, '../..');
const require = createRequire(new URL('../../desktop/package.json', import.meta.url));
test.skip(!process.env.E2E_DESKTOP, 'Activa E2E_DESKTOP=1 para probar el escritorio real con perfil temporal');

test('Excalidraw abre, guarda y reabre en Electron con recursos locales y CSP @desktop', async ({}, info) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-excalidraw-desktop-')));
  const env = { ...process.env, DATA_DIR: path.join(root, 'data'), NOTES_DIR: path.join(root, 'notes'), MEMORIA_DIR: path.join(root, 'memoria'), ALLOWED_ROOTS: root, WORKER_URL: 'http://127.0.0.1:1', COMPILE_ENGINE: 'local', TEX_BIN_DIR: '', TEX_PERL_DIR: '' };
  delete env.ET_DESKTOP_DEV; delete env.ELECTRON_RUN_AS_NODE;
  await fs.mkdir(env.NOTES_DIR); copyTemplate(env.MEMORIA_DIR, { perfil: 'generico' });
  let electron;
  try {
    electron = await _electron.launch({ executablePath: require('electron'), args: ['--use-mock-keychain', path.join(repo, 'desktop')], env });
    const page = await electron.firstWindow(), errors = [], external = [], fonts = [];
    page.on('response', async res => { if (res.url().includes('/fonts/')) fonts.push({ url: res.url(), status: res.status() }); });
    page.on('requestfailed', req => { if (req.url().includes('/fonts/')) fonts.push({ url: req.url(), failure: req.failure() }); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (!/^(http:\/\/estudio-tfg\.localhost\/|data:|blob:)/.test(req.url())) external.push(req.url()); });
    await page.waitForURL('http://estudio-tfg.localhost/');
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    const settings = page.getByRole('dialog', { name: 'Ajustes', exact: true });
    if (await settings.isVisible()) await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
    await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Diagramas', exact: true }).click();
    await page.getByRole('button', { name: 'Nuevo diagrama', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo diagrama', exact: true });
    await dialog.getByLabel('Nombre', { exact: true }).fill('escritorio-ficticio');
    await dialog.getByRole('button', { name: 'Excalidraw', exact: true }).click();
    await dialog.getByRole('button', { name: 'Tipo siguiente', exact: true }).click();
    await dialog.getByRole('button', { name: 'Crear', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'Editor Excalidraw' }).locator('canvas').first()).toBeVisible();
    const main = page.getByRole('main', { name: 'Diagramas', exact: true });
    await expect(main.getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
    await page.reload();
    if (await settings.isVisible()) await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
    await expect(main.getByLabel('Estado: Guardado', { exact: true })).toBeVisible();
    const content = JSON.parse(await fs.readFile(path.join(env.MEMORIA_DIR, 'diagramas/escritorio-ficticio.excalidraw'), 'utf8'));
    expect(content.elements.length).toBeGreaterThan(1);
    const exported = page.waitForResponse(r => r.url().endsWith('/api/diagramas/exportar') && r.request().method() === 'POST');
    await main.getByRole('button', { name: 'Exportar', exact: true }).click();
    const response = await exported;
    expect(response.ok(), await response.text()).toBe(true);
    const svg = await fs.readFile(path.join(env.MEMORIA_DIR, 'figuras/diagramas/escritorio-ficticio.svg'), 'utf8');
    expect(svg).toMatch(/url\(data:font\/woff2;base64,/);
    expect(svg).not.toMatch(/url\(["']?https?:/);
    await info.attach('excalidraw-escritorio.png', { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach('fuentes.json', { body: JSON.stringify({ fonts, assetPath: await page.evaluate(() => window.EXCALIDRAW_ASSET_PATH), faces: await page.evaluate(() => [...document.fonts].slice(0, 5).map(f => ({ family: f.family, status: f.status }))) }), contentType: 'application/json' });
    expect(fonts.filter(f => f.url.includes('localhost')).length).toBeGreaterThan(0);
    expect(fonts.every(f => f.status === 200)).toBe(true);
    expect(errors).toEqual([]); expect(external).toEqual([]);
  } finally {
    if (electron) { await electron.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await electron.close(); }
    await fs.rm(root, { recursive: true, force: true });
  }
});
