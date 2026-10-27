import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readMeta, withMeta } from '../src/diagramFiles.ts';
import { rev } from '../src/fsutil.ts';
import { canSymlink, setup, type TestEnv } from './helpers.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M0 0L10 10"/></svg>';
const PDF = Buffer.from('%PDF-1.4\n% Figura ficticia\n%%EOF');
let t: TestEnv;
beforeEach(async () => {
  t = await setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(PDF)));
});
afterEach(async () => { vi.unstubAllGlobals(); await t.close(); });

const post = (url: string, payload: Record<string, unknown>) => t.app.inject({ method: 'POST', url, payload });
const content = (format: string) => format === 'mmd' ? 'graph TD; A-->B' : JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} });
const figure = (source: string) => 'figuras/' + source.replace(/\.(mmd|excalidraw)$/, '.svg');
const disk = (rel: string) => path.join(t.cfg.memoriaDir, rel);

it.each(['mmd', 'excalidraw'])('conserva todas las figuras tras renombrar archivos y carpetas varias veces (%s)', async format => {
  const source = content(format);
  let current = `diagramas/a.${format}`;
  expect((await post('/api/file', { root: 'memoria', path: current, content: source })).statusCode).toBe(200);
  const figures = new Map<string, string>();
  for (const next of [`diagramas/b.${format}`, `diagramas/a.${format}`, `diagramas/b.${format}`, `diagramas/c.${format}`, `diagramas/sub/c.${format}`, `diagramas/otra/c.${format}`, `diagramas/sub/c.${format}`]) {
    expect((await post('/api/diagramas/exportar', { path: current, rev: rev(source), svg: SVG, pdf: PDF.toString('base64') })).statusCode).toBe(200);
    figures.set(figure(current), await fs.readFile(disk(figure(current)), 'utf8'));
    const from = current.startsWith('diagramas/sub/') || current.startsWith('diagramas/otra/') ? path.posix.dirname(current) : current;
    const to = from === current ? next : path.posix.dirname(next);
    const moved = await post('/api/move', { root: 'memoria', from, to });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().failed).toBeUndefined();
    for (const [rel, before] of figures) {
      const after = await fs.readFile(disk(rel), 'utf8');
      expect(readMeta(after)).toEqual({ ...readMeta(before), fuente: next });
      expect(after.replace(/<metadata[^>]*>[\s\S]*?<\/metadata>/, '')).toBe(SVG);
      expect(await fs.readFile(disk(rel.replace(/\.svg$/, '.pdf')))).toEqual(PDF);
      const history = path.join(t.cfg.historyDir, 'memoria', rel);
      expect(await Promise.all((await fs.readdir(history)).map(name => fs.readFile(path.join(history, name), 'utf8')))).toContain(before);
      figures.set(rel, after);
    }
    current = next;
  }
  expect((await post('/api/diagramas/exportar', { path: current, rev: rev(source), svg: SVG, pdf: PDF.toString('base64') })).statusCode).toBe(200);
});

it('conserva SVG ajenos, sin metadatos o dañados y sigue rechazando sus nombres reservados', async () => {
  const from = 'diagramas/a.excalidraw', to = 'diagramas/b.excalidraw';
  expect((await post('/api/file', { root: 'memoria', path: from, content: content('excalidraw') })).statusCode).toBe(200);
  await fs.mkdir(disk('figuras/diagramas'), { recursive: true });
  const untouched = new Map([
    ['ajeno.svg', withMeta(SVG, { fuente: 'diagramas/otro.excalidraw', rev: 'ajena', exportadoEn: 'fecha ficticia' })],
    ['sin-metadatos.svg', SVG],
    ['danado.svg', '<svg><metadata id="estudio-tfg-diagrama">{malformado</metadata></svg>'],
  ]);
  for (const [name, text] of untouched) await fs.writeFile(disk('figuras/diagramas/' + name), text);
  expect((await post('/api/move', { root: 'memoria', from, to })).statusCode).toBe(200);
  for (const [name, text] of untouched) expect(await fs.readFile(disk('figuras/diagramas/' + name), 'utf8')).toBe(text);
  expect((await post('/api/file', { root: 'memoria', path: 'diagramas/ajeno.mmd', content: content('mmd') })).statusCode).toBe(409);
  await expect(fs.stat(path.join(t.cfg.historyDir, 'memoria/figuras/diagramas'))).rejects.toMatchObject({ code: 'ENOENT' });
});

const supportsFileLink = await canSymlink('file');
it.skipIf(!supportsFileLink)('no sigue SVG enlazados fuera de la memoria', async () => {
  const from = 'diagramas/a.excalidraw', to = 'diagramas/b.excalidraw';
  expect((await post('/api/file', { root: 'memoria', path: from, content: content('excalidraw') })).statusCode).toBe(200);
  await fs.mkdir(disk('figuras/diagramas'), { recursive: true });
  const outside = path.join(t.dir, 'fuera.svg'), text = withMeta(SVG, { fuente: from, rev: 'externa', exportadoEn: 'fecha ficticia' });
  await fs.writeFile(outside, text);
  await fs.symlink(outside, disk('figuras/diagramas/enlace.svg'));
  expect((await post('/api/move', { root: 'memoria', from, to })).statusCode).toBe(200);
  expect(await fs.readFile(outside, 'utf8')).toBe(text);
});
