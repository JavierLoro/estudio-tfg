import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

test('Mermaid conserva diagramas y fórmulas con KaTeX corregido @smoke', async ({ studio, page }) => {
  await fs.writeFile(path.join(studio.root, 'notes/Nota.md'), [
    '# Diagramas ficticios',
    '```mermaid',
    'flowchart LR',
    '  A["$$x^2 + y^2 = z^2$$"] --> B[Resultado ficticio]',
    '```',
    '```mermaid',
    'sequenceDiagram',
    '  Ana->>Luis: Mensaje ficticio',
    '  Luis-->>Ana: Respuesta ficticia',
    '```',
  ].join('\n'));
  await studio.biblioteca();
  await page.keyboard.press('ControlOrMeta+k');
  const open = page.getByRole('dialog', { name: 'Abrir o buscar' });
  await open.getByLabel('Buscar', { exact: true }).fill('Nota.md');
  await open.getByRole('option').filter({ hasText: 'Nota.md' }).first().click();
  const diagrams = page.getByLabel('Diagrama Mermaid');
  await expect(diagrams.locator('svg')).toHaveCount(2);
  await expect(diagrams.first().locator('math')).toBeVisible();
  await expect(diagrams.first()).toContainText('Resultado ficticio');
  await expect(diagrams.last()).toContainText('Respuesta ficticia');
  await expect(page.getByText(/Error de Mermaid:/)).toHaveCount(0);
});
