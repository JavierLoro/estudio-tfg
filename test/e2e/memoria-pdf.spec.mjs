import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

const nav = page => page.getByRole('navigation', { name: 'Secciones' });
const memory = page => page.getByRole('region', { name: 'Espacio: Memoria', exact: true });

test('Memoria fija el PDF sin pestaña y conserva ancho, documentos y Multivista @smoke', async ({ studio, page }) => {
  const pdf = await fs.readFile(new URL('../../templates/base/figuras/ejemplo.pdf', import.meta.url));
  await page.route('**/api/compile/last', route => route.fulfill({ json: {
    ok: true, buildId: 'pdf-ficticio', startedAt: '2026-10-20T12:00:00Z', durationMs: 100,
    diagnostics: [], pdfUrl: '/api/pdf/pdf-ficticio.pdf', sourceRev: '0000000000000000',
  } }));
  await page.route('**/api/pdf/pdf-ficticio.pdf', route => route.fulfill({ contentType: 'application/pdf', body: pdf }));
  await page.goto(studio.server.url);
  const mem = memory(page);
  const editor = mem.locator('.cm-content');
  const preview = mem.getByRole('region', { name: 'PDF de Memoria', exact: true });
  const splitter = mem.getByRole('separator', { name: 'Ancho del PDF de Memoria', exact: true });
  await expect(editor).toBeVisible();
  await expect(preview.locator('canvas').first()).toBeVisible();
  await expect(mem.getByRole('tab', { name: 'PDF', exact: true })).toHaveCount(0);
  await expect(mem.getByRole('button', { name: 'Cerrar PDF', exact: true })).toHaveCount(0);
  const e = await editor.boundingBox(), p = await preview.boundingBox();
  expect(p.x).toBeGreaterThan(e.x + e.width);
  await splitter.press('ArrowLeft');
  await expect(splitter).toHaveAttribute('aria-valuenow', '55');
  const s = await splitter.boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x - 100, s.y + s.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await splitter.getAttribute('aria-valuenow'))).toBeGreaterThan(55);
  const width = await splitter.getAttribute('aria-valuenow');
  await page.reload();
  await expect(splitter).toHaveAttribute('aria-valuenow', width);
  await expect(preview.locator('canvas').first()).toBeVisible();
  const viewer = await preview.locator('.pdfViewer').elementHandle();
  await preview.getByLabel('Zoom', { exact: true }).selectOption('1');
  await editor.click();
  await editor.press('ControlOrMeta+End');
  await editor.press('Enter');
  await editor.pressSequentially('% Pendiente de guardar al alternar vistas');
  await nav(page).getByRole('button', { name: 'Multivista', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(splitter).toHaveCount(0);
  await expect(mem.getByRole('tab', { name: 'PDF', exact: true })).toBeVisible();
  expect(await viewer.isVisible()).toBe(true);
  await expect(mem.getByLabel('Zoom', { exact: true })).toHaveValue('1');
  await expect(editor).toContainText('Pendiente de guardar al alternar vistas');
  await nav(page).getByRole('button', { name: 'Memoria', exact: true }).click();
  await expect(preview).toBeVisible();
  expect(await viewer.isVisible()).toBe(true);
  await expect(preview.getByLabel('Zoom', { exact: true })).toHaveValue('1');
  await expect(splitter).toHaveAttribute('aria-valuenow', width);
  await expect(mem.getByRole('tab', { name: 'PDF', exact: true })).toHaveCount(0);
  await expect(editor).toContainText('Pendiente de guardar al alternar vistas');
  await editor.press('ControlOrMeta+z');
  await expect(editor).not.toContainText('Pendiente de guardar al alternar vistas');
  expect(await fs.readFile(path.join(studio.root, 'memoria/tfg.tex'), 'utf8')).not.toContain('Pendiente de guardar');
  await splitter.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '20');
  await splitter.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', '80');
  await splitter.dblclick();
  await expect(splitter).toHaveAttribute('aria-valuenow', '50');
  await mem.getByRole('button', { name: 'Cerrar tfg.tex', exact: true }).click();
  await expect(preview).toBeVisible();
  await expect(mem.getByText('Abre un archivo desde el panel lateral', { exact: true })).toBeVisible();
  await nav(page).getByRole('button', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Ver PDF', exact: true }).click();
  await expect(preview).toBeFocused();
  await expect(mem.getByRole('tab', { name: 'PDF', exact: true })).toHaveCount(0);
});

test('migra un PDF mezclado con documentos y respeta el PDF cerrado en Multivista', async ({ studio, page }) => {
  const { instanceId } = await studio.json('/api/status');
  await page.addInitScript(({ instanceId }) => {
    localStorage.setItem(`et:layout:v1:${instanceId}`, JSON.stringify({
      grid: { width: 1440, height: 900, orientation: 'HORIZONTAL', root: { type: 'branch', data: [
        { type: 'leaf', size: 1400, data: { id: 'mixto', views: ['latex:tfg.tex', 'pdf'], activeView: 'pdf' } },
      ] } },
      panels: {
        'latex:tfg.tex': { id: 'latex:tfg.tex', contentComponent: 'latex', title: 'tfg.tex', params: { root: 'memoria', path: 'tfg.tex' } },
        pdf: { id: 'pdf', contentComponent: 'pdf', title: 'PDF', renderer: 'always' },
      }, activeGroup: 'mixto',
    }));
  }, { instanceId });
  await page.goto(studio.server.url);
  const mem = memory(page);
  await expect(mem.locator('.cm-content')).toBeVisible();
  await expect(mem.getByRole('tab', { name: 'PDF', exact: true })).toHaveCount(0);
  await nav(page).getByRole('button', { name: 'Multivista', exact: true }).click();
  await mem.getByRole('button', { name: 'Cerrar PDF', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Memoria', exact: true }).click();
  await expect(mem.getByRole('region', { name: 'PDF de Memoria', exact: true })).toBeVisible();
  await nav(page).getByRole('button', { name: 'Multivista', exact: true }).click();
  await expect(mem.getByRole('tab', { name: 'PDF', exact: true })).toHaveCount(0);
});
