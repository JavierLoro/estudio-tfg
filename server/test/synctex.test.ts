import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { forward, inverse, isSourceFile, parseSynctex } from '../src/synctex.ts';
import { setup, type TestEnv } from './helpers.ts';

/** bp → sp (lo que escribe pdfTeX con Unit:1). */
const sp = (bp: number) => Math.round(bp * 65781.76);
/** Registro con coordenadas en bp: tipo+tag,línea:h,v[:W,H,D]. */
const rec = (t: string, tag: number, line: number, h: number, v: number, whd?: [number, number, number]) =>
  `${t}${tag},${line}:${sp(h)},${sp(v)}${whd ? `:${whd.map(sp).join(',')}` : ''}`;
const k = (tag: number, line: number, h: number, v: number, w: number) => `k${tag},${line}:${sp(h)},${sp(v)}:${sp(w)}`;

// Página 1: cabecera vacía (caja plana en 0,0), dos líneas de párrafo de main.tex
// (cajas etiquetadas con la línea 9, donde acaba el párrafo), una línea de una clase
// de TeX Live con un registro de main.tex. Página 2: capitulos/intro.tex con una caja anidada.
const FIXTURE = [
  'SyncTeX Version:1',
  'Input:1:./main.tex',
  'Input:2:/usr/local/texlive/2026/texmf-dist/tex/latex/base/book.cls',
  'Input:4:main.aux',
  'Output:pdf',
  'Magnification:1000',
  'Unit:1',
  'X Offset:0',
  'Y Offset:0',
  'Content:',
  '!120',
  '{1',
  rec('[', 1, 1, 72, 800, [450, 720, 0]),
  rec('(', 1, 3, 0, 0, [0, 0, 0]),
  rec('g', 1, 3, 0, 0),
  ')',
  // línea A: y 192–202
  rec('(', 1, 9, 100, 200, [400, 8, 2]),
  rec('x', 1, 9, 100, 200), // apertura de la caja: no cuenta como contenido de la línea 9
  rec('x', 1, 7, 120, 200),
  k(1, 7, 200, 200, 5),
  rec('x', 1, 8, 300, 200),
  rec('g', 1, 8, 350, 200),
  ')',
  // línea B: y 207–217
  rec('(', 1, 9, 100, 215, [400, 8, 2]),
  rec('x', 1, 9, 100, 215),
  rec('x', 1, 8, 110, 215),
  rec('x', 1, 9, 260, 215),
  k(1, 10, 500, 215, 40), // relleno de fin de párrafo de la línea en blanco 10
  'f1,1:0,0', // registro desconocido: se ignora
  ')',
  // línea C (de la clase): y 232–242
  rec('(', 2, 50, 100, 240, [400, 8, 2]),
  rec('x', 2, 50, 120, 240),
  rec('x', 1, 12, 300, 240),
  rec('x', 4, 3, 400, 240),
  ')',
  ']',
  '}1',
  'Input:3:capitulos/intro.tex',
  '{2',
  rec('[', 3, 1, 72, 800, [450, 720, 0]),
  rec('(', 3, 5, 100, 100, [400, 8, 2]),
  rec('x', 3, 5, 100, 100),
  rec('x', 3, 5, 150, 100),
  rec('(', 3, 5, 200, 100, [20, 8, 2]),
  rec('x', 3, 6, 210, 100),
  ')',
  ')',
  ']',
  '}2',
  'Postamble:',
  'Count:20',
  'Post scriptum:',
  '',
].join('\n');

describe('parseSynctex', () => {
  const d = parseSynctex(FIXTURE);

  it('reads inputs (also mid-content), pages and records', () => {
    expect([...d.files]).toEqual([
      [1, './main.tex'],
      [2, '/usr/local/texlive/2026/texmf-dist/tex/latex/base/book.cls'],
      [4, 'main.aux'],
      [3, 'capitulos/intro.tex'],
    ]);
    expect([...d.pages.keys()]).toEqual([1, 2]);
    expect(d.boxes.filter((b) => b.page === 1 && b.kind === 'h')).toHaveLength(4);
    expect(d.leaves.some((l) => l.kind === 'f')).toBe(false);
    expect(d.scale).toBeCloseTo(1 / 65781.76, 12);
  });

  it('marks the opening x of a line box and sizeless boxes as markers', () => {
    const line9 = d.leaves.filter((l) => l.tag === 1 && l.line === 9);
    expect(line9.map((l) => l.kind)).toEqual(['_', '_', 'x']);
  });

  it('applies Unit, Magnification and offsets', () => {
    const scaled = parseSynctex(FIXTURE.replace('Unit:1', 'Unit:2').replace('Magnification:1000', 'Magnification:2000'));
    expect(scaled.scale).toBeCloseTo(4 / 65781.76, 12);
  });

  it('tolerates an optional column after the line', () => {
    const withCol = parseSynctex(FIXTURE.replace(/^x1,7:/m, 'x1,7,3:'));
    expect(withCol.leaves.find((l) => l.tag === 1 && l.line === 7)?.h).toBe(sp(120));
  });
});

describe('forward', () => {
  const d = parseSynctex(FIXTURE);

  it('returns the line box of the line, in points from the top-left corner', () => {
    expect(forward(d, 'main.tex', 7)).toEqual({ page: 1, x: 100, y: 192, w: 400, h: 10 });
  });

  it('joins the line boxes of a source line split across lines', () => {
    expect(forward(d, 'main.tex', 8)).toEqual({ page: 1, x: 100, y: 192, w: 400, h: 25 });
  });

  it('ignores paragraph-end tags on boxes and normalizes the file name', () => {
    // La línea 9 solo tiene contenido propio en la línea B.
    expect(forward(d, './main', 9)).toEqual({ page: 1, x: 100, y: 207, w: 400, h: 10 });
  });

  it('blank or empty lines go to the next line with content, then to the previous one', () => {
    expect(forward(d, 'main.tex', 10)).toMatchObject({ page: 1, y: 232 }); // → 12 (dentro de la caja de la clase)
    expect(forward(d, 'main.tex', 2)).toMatchObject({ page: 1, y: 192 }); // → 7
    expect(forward(d, 'main.tex', 99)).toMatchObject({ page: 1, y: 232 }); // → 12
  });

  it('uses the outer line box around nested boxes', () => {
    expect(forward(d, 'capitulos/intro.tex', 6)).toEqual({ page: 2, x: 100, y: 92, w: 400, h: 10 });
  });

  it('null for unknown, TeX Live or generated files', () => {
    expect(forward(d, 'nope.tex', 1)).toBeNull();
    expect(forward(d, '/usr/local/texlive/2026/texmf-dist/tex/latex/base/book.cls', 50)).toBeNull();
    expect(forward(d, 'main.aux', 3)).toBeNull();
  });
});

describe('inverse', () => {
  const d = parseSynctex(FIXTURE);

  it('picks the nearest record to the left of the click in the line box', () => {
    expect(inverse(d, 1, 205, 199)).toEqual({ file: 'main.tex', line: 7 });
    expect(inverse(d, 1, 310, 199)).toEqual({ file: 'main.tex', line: 8 });
    expect(inverse(d, 1, 105, 199)).toEqual({ file: 'main.tex', line: 7 }); // nada a la izquierda → el primero a la derecha
  });

  it('skips TeX Live and generated files', () => {
    expect(inverse(d, 1, 450, 238)).toEqual({ file: 'main.tex', line: 12 });
  });

  it('between lines, goes to the line below', () => {
    expect(inverse(d, 1, 150, 225)).toEqual({ file: 'main.tex', line: 12 });
  });

  it('uses the smallest box containing the point', () => {
    expect(inverse(d, 2, 212, 99)).toEqual({ file: 'capitulos/intro.tex', line: 6 });
    expect(inverse(d, 2, 160, 99)).toEqual({ file: 'capitulos/intro.tex', line: 5 });
  });

  it('null for a page without records', () => {
    expect(inverse(d, 3, 100, 100)).toBeNull();
  });
});

describe('isSourceFile', () => {
  it('accepts relative sources only', () => {
    expect(isSourceFile('1-capitulos/01-introduccion.tex')).toBe(true);
    expect(isSourceFile('./datos.tex')).toBe(true);
    expect(isSourceFile('/usr/local/texlive/x.sty')).toBe(false);
    expect(isSourceFile('../fuera.tex')).toBe(false);
    expect(isSourceFile('tfg.toc')).toBe(false);
  });
});

// Synctex real (plantilla compilada por el worker): valores contrastados con `synctex view/edit`.
const BUILD = '20261006-120936-6fe42e';
const REAL = path.join(import.meta.dirname, 'fixtures', 'main.synctex.gz');

describe('real synctex', () => {
  it('forward/inverse agree with the synctex CLI', async () => {
    const d = parseSynctex(zlib.gunzipSync(await fs.readFile(REAL)).toString('utf8'));
    // CLI: Page:23, h:99.21, v-H: 276.92 y 294.85 (dos cajas de línea)
    expect(forward(d, '1-capitulos/01-introduccion.tex', 12)).toEqual({ page: 23, x: 99.21, y: 276.92, w: 439.37, h: 28.6 });
    // CLI: Page:29 h:171.01 v-H:545.07 W:295.78 H:15.44 (fila de tabla)
    expect(forward(d, '1-capitulos/04-metodologia.tex', 49)).toEqual({ page: 29, x: 171.01, y: 545.07, w: 295.78, h: 15.44 });
    expect(inverse(d, 23, 200, 290)).toEqual({ file: '1-capitulos/01-introduccion.tex', line: 11 });
    expect(inverse(d, 25, 188.5, 334.3)).toEqual({ file: '1-capitulos/02-objetivos.tex', line: 16 });
  });
});

describe('routes', () => {
  let t: TestEnv | null = null;
  afterEach(async () => {
    await t?.close();
    t = null;
  });

  /** App con una compilación real en BUILD_DIR y last.json apuntando a ella. */
  async function withBuild(env: Record<string, string> = {}) {
    return setup(env, {
      before: async (dir) => {
        const bd = path.join(dir, 'data', 'builds');
        await fs.mkdir(path.join(bd, BUILD), { recursive: true });
        await fs.copyFile(REAL, path.join(bd, BUILD, 'main.synctex.gz'));
        await fs.writeFile(path.join(bd, BUILD, 'main.pdf'), '%PDF-1.5');
        await fs.mkdir(path.join(bd, 'otro'), { recursive: true });
        await fs.writeFile(path.join(bd, 'otro', 'main.pdf'), '%PDF-1.5');
        await fs.writeFile(path.join(bd, 'last.json'), JSON.stringify({ last: null, lastGoodPdfUrl: `/api/pdf/${BUILD}.pdf` }));
      },
    });
  }

  it('forward with the default (last good) build and with an explicit build', async () => {
    t = await withBuild();
    const r = await t.app.inject({ url: '/api/synctex/forward?file=1-capitulos/01-introduccion.tex&line=12' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ build: BUILD, page: 23, x: 99.21, y: 276.92, w: 439.37, h: 28.6 });
    const r2 = await t.app.inject({ url: `/api/synctex/forward?file=./1-capitulos/01-introduccion&line=12&build=${BUILD}` });
    expect(r2.json()).toEqual(r.json());
  });

  it('inverse', async () => {
    t = await withBuild();
    const r = await t.app.inject({ url: '/api/synctex/inverse?page=23&x=200&y=290' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ build: BUILD, file: '1-capitulos/01-introduccion.tex', line: 11 });
    const r2 = await t.app.inject({ url: '/api/synctex/inverse?page=999&x=200&y=290' });
    expect(r2.statusCode).toBe(404);
    expect(r2.json().error).toMatch(/No se encontró/);
  });

  it('400 on bad params', async () => {
    t = await withBuild();
    for (const q of [
      'forward?file=../x.tex&line=1',
      'forward?file=/etc/passwd&line=1',
      'forward?file=a.tex&line=0',
      'forward?file=a.tex&line=abc',
      'forward?line=3',
      'forward?file=a.tex&line=1&build=..',
      'forward?file=a.tex&line=1&build=a%2Fb',
      'inverse?page=1&x=abc&y=2',
      'inverse?page=0&x=1&y=2',
      'inverse?page=1&x=1',
    ]) {
      const r = await t.app.inject({ url: `/api/synctex/${q}` });
      expect(r.statusCode, q).toBe(400);
      expect(r.json().error, q).toBeTruthy();
    }
  });

  it('404 when the build has no synctex, the file is not in it, or there is no PDF yet', async () => {
    t = await withBuild();
    let r = await t.app.inject({ url: '/api/synctex/forward?file=a.tex&line=1&build=otro' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe('No hay datos de SyncTeX para esta compilación');
    r = await t.app.inject({ url: '/api/synctex/forward?file=no-existe.tex&line=1' });
    expect(r.statusCode).toBe(404);
    await t.close();
    t = await setup();
    r = await t.app.inject({ url: '/api/synctex/inverse?page=1&x=1&y=1' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe('Aún no hay ningún PDF compilado');
  });

  it('serves the raw synctex.gz', async () => {
    t = await withBuild();
    const r = await t.app.inject({ url: `/api/synctex/file/${BUILD}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/gzip');
    expect(r.headers['cache-control']).toMatch(/immutable/);
    expect(r.rawPayload.equals(await fs.readFile(REAL))).toBe(true);
    expect((await t.app.inject({ url: '/api/synctex/file/otro' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/api/synctex/file/..' })).statusCode).toBe(404);
  });

  it('requires auth like the rest of the API', async () => {
    t = await withBuild({ AUTH_TOKEN: 's3cret' });
    expect((await t.app.inject({ url: '/api/synctex/inverse?page=23&x=200&y=290' })).statusCode).toBe(401);
    expect((await t.app.inject({ url: `/api/synctex/file/${BUILD}` })).statusCode).toBe(401);
    const ok = await t.app.inject({ url: '/api/synctex/inverse?page=23&x=200&y=290', headers: { authorization: 'Bearer s3cret' } });
    expect(ok.statusCode).toBe(200);
  });

  it('caches parsed builds (LRU of 3)', async () => {
    t = await withBuild();
    const c = t.ctx.compiler;
    const a = await c.synctex(BUILD);
    expect(a).not.toBeNull();
    expect(await c.synctex(BUILD)).toBe(a);
    const bd = t.cfg.buildDir;
    for (const id of ['b1', 'b2', 'b3']) {
      await fs.mkdir(path.join(bd, id), { recursive: true });
      await fs.copyFile(REAL, path.join(bd, id, 'main.synctex.gz'));
      await c.synctex(id);
    }
    expect(await c.synctex(BUILD)).not.toBe(a); // expulsado y vuelto a analizar
  });
});
