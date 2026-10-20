import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test, expect } from './fixtures.mjs';
import { DIAGRAM_TEMPLATES } from '../../web/src/lib/diagramTemplates.ts';
import { getDocument } from '../../web/node_modules/pdfjs-dist/legacy/build/pdf.mjs';

async function openDiagram(page, name) {
  await page.keyboard.press('ControlOrMeta+k');
  const open = page.getByRole('dialog', { name: 'Abrir o buscar' });
  await open.getByLabel('Buscar', { exact: true }).fill(`${name}.mmd`);
  await open.getByRole('option').filter({ hasText: `diagramas/${name}.mmd` }).first().click();
  await expect(page.getByTitle(`Guardar y exportar a figuras/diagramas/${name}.pdf (y .svg)`, { exact: true })).toBeVisible();
}

async function pdfText(pdf) {
  const task = getDocument({ data: new Uint8Array(pdf) });
  try {
    const doc = await task.promise;
    expect(doc.numPages).toBe(1);
    return (await (await doc.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
  } finally { await task.destroy(); }
}

test('local exporta todas las plantillas sin Docker ni rsvg @sin-herramientas @smoke', async ({ studio, page }, info) => {
  test.setTimeout(240_000);
  await studio.json('/api/settings', { method: 'PUT', data: { compileEngine: 'local' } });
  const detection = await studio.json('/api/engines');
  expect(detection.local.tools.rsvg.path).toBeNull();
  expect(detection.local.capabilities.svg2pdf).toBe(true);
  const dir = path.join(studio.root, 'memoria/diagramas');
  await fs.mkdir(dir);
  for (const t of DIAGRAM_TEMPLATES) await fs.writeFile(path.join(dir, `${t.id}.mmd`), t.source);
  await studio.biblioteca();
  const exports = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/diagramas/exportar')) exports.push(request.postDataJSON());
  });
  for (const t of DIAGRAM_TEMPLATES) {
    await openDiagram(page, t.id);
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await expect.poll(async () => (await studio.json(`/api/diagramas/estado?path=diagramas%2F${t.id}.mmd`)).estado).toBe('exportado');
    const pdf = await fs.readFile(path.join(studio.root, `memoria/figuras/diagramas/${t.id}.pdf`));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/BaseFont /SourceSans3');
    expect(pdf.toString('latin1')).not.toMatch(/\/Subtype\s*\/Image/);
    expect(pdf.toString('latin1')).not.toContain('/Times-Roman');
    const text = (await pdfText(pdf)).replace(/\s+/g, ' ');
    expect(text).toContain({ flujo: '¿Son válidos?', secuencia: 'Confirmación', estados: 'En revisión',
      arquitectura: 'Almacenamiento', er: 'usuario_id', clases: 'iniciarSesion()',
      gantt: 'Diseño', cronologia: 'Evaluación', 'mapa-mental': 'Bibliografía', c4: 'Aplicación',
      kanban: 'Documentar la API', requisitos: 'consultar documentos', sectores: 'Investigación',
      cuadrantes: 'Buscador', sankey: 'Memoria' }[t.id]);
    await info.attach(`${t.id}-js.pdf`, { body: pdf, contentType: 'application/pdf' });
    await info.attach(`${t.id}.svg`, { path: path.join(studio.root, `memoria/figuras/diagramas/${t.id}.svg`), contentType: 'image/svg+xml' });
    if (process.env.E2E_DIAGRAM_OUT) {
      const output = await fs.realpath(process.env.E2E_DIAGRAM_OUT);
      const roots = [await fs.realpath(os.tmpdir()), ...(process.env.RUNNER_TEMP ? [await fs.realpath(process.env.RUNNER_TEMP)] : [])];
      expect(roots.some(root => output.startsWith(root + path.sep)), 'Las figuras E2E solo se copian a un temporal propio').toBe(true);
      await fs.writeFile(path.join(output, `${t.id}-js.pdf`), pdf);
    }
  }
  expect(exports).toHaveLength(DIAGRAM_TEMPLATES.length * 2);
  expect(exports.filter(body => body.pdf)).toHaveLength(DIAGRAM_TEMPLATES.length);
});

test('local conserva latin-ext y no sobrescribe la figura si falta un carácter @sin-herramientas @smoke', async ({ studio, page }) => {
  await studio.json('/api/settings', { method: 'PUT', data: { compileEngine: 'local' } });
  const dir = path.join(studio.root, 'memoria/diagramas');
  await fs.mkdir(dir);
  const source = path.join(dir, 'prueba.mmd');
  await fs.writeFile(source, 'flowchart LR\n A[Sílaba ā Ł ñ €]\n');
  await studio.biblioteca();
  await openDiagram(page, 'prueba');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect.poll(async () => (await studio.json('/api/diagramas/estado?path=diagramas%2Fprueba.mmd')).estado).toBe('exportado');
  const target = path.join(studio.root, 'memoria/figuras/diagramas/prueba.pdf');
  const pdf = await fs.readFile(target);
  expect((await pdfText(pdf)).replace(/\s/g, '')).toContain('SílabaāŁñ€');
  await fs.writeFile(source, 'flowchart LR\n A[Texto 😀]\n');
  await page.reload();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByText(/La fuente del PDF no incluye/)).toBeVisible();
  expect(await fs.readFile(target)).toEqual(pdf);
  expect((await studio.json('/api/diagramas/estado?path=diagramas%2Fprueba.mmd')).estado).toBe('desactualizado');
});

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
