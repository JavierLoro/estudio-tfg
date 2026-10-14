import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

test('asistente: crea carpetas, reintenta la preparación y vuelve desde Ajustes @smoke', async ({ studio, page }) => {
  let complete = false;
  let attempts = 0;
  const engine = { phase: 'idle', available: true, installed: false, current: false, received: 0, total: 100_000_000,
    message: null, version: 'texlive-ficticio', variant: 'online' };
  await page.route('**/api/desktop/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/prepare')) {
      attempts++;
      Object.assign(engine, attempts === 1 ? { phase: 'error', message: 'Hash incorrecto ficticio' }
        : { phase: 'ready', message: null, installed: true, current: true, received: engine.total });
    }
    if (endpoint.endsWith('/complete')) complete = true;
    await route.fulfill({ json: endpoint.endsWith('/prepare') ? engine : { engine, needsSetup: !complete } });
  });
  await page.route('**/api/compile', route => route.fulfill({ json: { ok: true, buildId: 'ficticio', startedAt: new Date().toISOString(),
    durationMs: 1, diagnostics: [], pdfUrl: null, sourceRev: 'ficticio' } }));
  await page.goto(studio.server.url);
  const wizard = page.getByRole('dialog', { name: 'Preparar Estudio TFG' });
  await expect(wizard).toBeVisible();
  await wizard.getByRole('button', { name: 'Crear carpeta de notas', exact: true }).click();
  const notes = page.getByRole('dialog', { name: 'Carpeta de notas', exact: true });
  await notes.getByLabel('Nueva carpeta', { exact: true }).fill('Notas nuevas');
  await notes.getByRole('button', { name: /Crear/ }).click();
  await expect(notes).not.toBeVisible();
  expect((await fs.stat(path.join(studio.root, 'Notas nuevas/Recursos'))).isDirectory()).toBe(true);
  await wizard.getByRole('button', { name: 'Crear memoria', exact: true }).click();
  const memory = page.getByRole('dialog', { name: 'Carpeta de la memoria', exact: true });
  await memory.getByLabel('Nueva carpeta', { exact: true }).fill('Memoria nueva');
  // Otra actualización de ajustes conserva el borrador del selector abierto.
  const originalNotes = path.join(studio.root, 'notes');
  await studio.json('/api/settings', { method: 'PUT', data: { notesDir: originalNotes } });
  await expect(wizard.getByText(originalNotes, { exact: true })).toBeVisible();
  await expect(memory.getByLabel('Nueva carpeta', { exact: true })).toHaveValue('Memoria nueva');
  await memory.getByRole('button', { name: /Crear/ }).click();
  await expect(memory).not.toBeVisible();
  expect(await fs.readFile(path.join(studio.root, 'Memoria nueva/tfg.tex'), 'utf8')).toContain('documentclass');
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(wizard.getByText(/100 MB/)).toBeVisible();
  await wizard.getByRole('button', { name: 'Preparar TeX', exact: true }).click();
  await expect(wizard.getByText('Hash incorrecto ficticio')).toBeVisible();
  await expect(wizard.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await wizard.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await wizard.getByRole('button', { name: 'Compilar primera memoria', exact: true }).click();
  await expect(wizard.getByText('PDF generado. Ya puedes empezar a escribir.')).toBeVisible();
  await wizard.getByRole('button', { name: 'Terminar', exact: true }).click();
  await expect(wizard).not.toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Asistente inicial', exact: true }).click();
  await expect(wizard).toBeVisible();
  await wizard.getByRole('button', { name: 'Más tarde', exact: true }).click();
});
