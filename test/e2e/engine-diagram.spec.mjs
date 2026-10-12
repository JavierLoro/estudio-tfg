import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

test('el motor Docker exporta un diagrama desde el navegador @worker', async ({ studio, page }) => {
  test.skip(!process.env.E2E_WORKER_URL, 'Indica un worker propio para verificar la conversión real');
  await fs.mkdir(path.join(studio.root, 'memoria/diagramas'));
  await fs.writeFile(path.join(studio.root, 'memoria/diagramas/prueba.mmd'), 'flowchart LR\n A[Inicio ficticio] --> B[Fin ficticio]\n');
  await studio.biblioteca();
  await page.keyboard.press('ControlOrMeta+k');
  const open = page.getByRole('dialog', { name: 'Abrir o buscar' });
  await open.getByLabel('Buscar', { exact: true }).fill('prueba.mmd');
  await open.getByRole('option').filter({ hasText: 'prueba.mmd' }).first().click();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect.poll(async () => (await studio.json('/api/diagramas/estado?path=diagramas%2Fprueba.mmd')).estado).toBe('exportado');
  const pdf = await fs.readFile(path.join(studio.root, 'memoria/figuras/diagramas/prueba.pdf'));
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const svg = await fs.readFile(path.join(studio.root, 'memoria/figuras/diagramas/prueba.svg'), 'utf8');
  expect(svg.replace(/<[^>]*>/g, '').replace(/\s/g, '')).toContain('Inicioficticio');
});
