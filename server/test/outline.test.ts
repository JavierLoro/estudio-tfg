import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import type { Ctx } from '../src/context.ts';
import type { OutlineItem } from '../src/outline.ts';
import { cleanTitle, proseWords, wordsPerLine } from '../src/outline.ts';
import { sectionHooks } from '../src/sections.ts';

// Self-contained fixtures: never depends on templates/.

const w = (n: number, word = 'palabra') => Array.from({ length: n }, () => word).join(' ');

const MAIN = `\\documentclass{estilo/memoria}
\\input{datos}
\\begin{document}
\\frontmatter
\\input{0-inicio/resumen}
\\input{0-inicio/agradecimientos}
% \\input{0-inicio/acronimos}
\\tableofcontents
\\mainmatter
\\include{1-capitulos/01-introduccion}
\\include{1-capitulos/02-objetivos}
%\\include{1-capitulos/03-antecedentes}
\\include{1-capitulos/04-ciclo}
\\include{1-capitulos/05-falta}
\\chapter*{Nota sin numerar}
Texto de la nota.
\\appendix
\\include{2-anexos/a-anexo}
\\bibliography{bibliografia}
\\end{document}
`;

const INTRO = `% Guía de prueba: qué contiene la introducción
\\chapter[Intro]{Introducción a \\emph{todo}}\\label{cap:intro}
${w(40)}
% TODO revisar este párrafo
\\section{Contexto}
${w(35)}
\\begin{equation}
  a = b + c \\text{donde todo}
\\end{equation}
\\begin{figure}[h]
  \\includegraphics{x.png}
  \\caption{Una figura con cinco palabras}
  texto ignorado dentro de la figura
\\end{figure}
\\subsection{Detalle}
uno dos tres cuatro palabraunica
\\section{Vacía}
\\section*{Sin número}
\\begin{lstlisting}
codigo codigo codigo codigo codigo codigo
\\end{lstlisting}
tres palabras más
`;

const OBJETIVOS = `\\chapter{Objetivos}
${w(50)}

\\section{General}
${w(20)}
línea con un error
${w(20)}
`;

function memoriaFiles(): Record<string, string> {
  return {
    'tfg.tex': MAIN,
    'datos.tex': '\\titulo{Mi TFG}\n\\autor{Alguien}\n',
    '0-inicio/resumen.tex': `\\chapter*{Resumen}\n${w(12)}\n`,
    '0-inicio/agradecimientos.tex': `${w(7)}\n`,
    '0-inicio/acronimos.tex': '\\chapter*{Acrónimos}\n',
    '1-capitulos/01-introduccion.tex': INTRO,
    '1-capitulos/02-objetivos.tex': OBJETIVOS,
    '1-capitulos/03-antecedentes.tex': `\\chapter{Antecedentes}\n${w(10)}\n`,
    '1-capitulos/04-ciclo.tex': `\\chapter{Ciclo}\n${w(40)}\n\\input{1-capitulos/04-ciclo}\n`,
    '2-anexos/a-anexo.tex': `\\chapter{Manual}\n${w(31)}\n\\section{Instalación}\n${w(30)}\n`,
    'bibliografia.bib': '@string{x = "y"}\n@article{a, title={A}}\n@book{b,\n title={B}}\n% @misc{c}\n',
  };
}

const LEGACY: Record<string, string> = {
  'main.tex': `\\documentclass{book}
\\begin{document}
\\input{intro.tex}
\\input{otro}
\\end{document}
`,
  'intro.tex': `\\chapter{Introducción}\n${w(30)}\n\\section{Uno}\n${w(5)}\n`,
  'otro.tex': `\\chapter{Otro}\n${w(31)}\n`,
};

interface Env {
  dir: string;
  cfg: Config;
  app: FastifyInstance;
  ctx: Ctx;
  close: () => Promise<void>;
}

let t: Env | null = null;
afterEach(async () => {
  sectionHooks.beforeCommit = undefined;
  await t?.close();
  t = null;
});

async function setup(files: Record<string, string>, main: string, opts: { watch?: boolean; last?: unknown } = {}): Promise<Env> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-outline-')));
  const mem = path.join(dir, 'memoria');
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(mem, rel)), { recursive: true });
    await fs.writeFile(path.join(mem, rel), content);
  }
  await fs.mkdir(path.join(dir, 'notes'), { recursive: true });
  const cfg = loadConfig(
    {
      NOTES_DIR: './notes',
      MEMORIA_DIR: './memoria',
      MEMORIA_MAIN: main,
      BUILD_DIR: './data/builds',
      WORKER_URL: 'http://127.0.0.1:1',
      AUTH_TOKEN: '',
      ALLOWED_ROOTS: dir,
    },
    dir,
  );
  if (opts.last) {
    await fs.mkdir(cfg.buildDir, { recursive: true });
    await fs.writeFile(path.join(cfg.buildDir, 'last.json'), JSON.stringify({ last: opts.last, lastGoodPdfUrl: null }));
  }
  const { app, ctx } = await buildApp(cfg, { serveWeb: false, watch: opts.watch });
  await app.ready();
  return {
    dir,
    cfg,
    app,
    ctx,
    close: async () => {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

const flat = (items: OutlineItem[]): OutlineItem[] => items.flatMap((i) => [i, ...flat(i.children)]);
const byTitle = (items: OutlineItem[], title: string) => {
  const it = flat(items).find((i) => i.title === title);
  if (!it) throw new Error(`no item ${title}`);
  return it;
};
const getOutline = async () => {
  const r = await t!.app.inject({ url: '/api/memoria/outline' });
  expect(r.statusCode).toBe(200);
  return r.json();
};
const post = (body: unknown) => t!.app.inject({ method: 'POST', url: '/api/memoria/sections', payload: body as any });
const readMem = (rel: string) => fs.readFile(path.join(t!.cfg.memoriaDir, rel), 'utf8');

describe('text helpers', () => {
  it('counts prose words without commands, math or comments', () => {
    expect(proseWords('Hola \\textbf{mundo} $x+y$ con \\cite{a} y \\ref{b}.')).toBe(4);
    expect(proseWords('pre-procesado del \\ac{TFG}')).toBe(3);
    expect(wordsPerLine(['uno', '\\begin{table}', 'a & b', '\\caption{dos tres}', '\\end{table}', 'cuatro'])).toEqual([1, 0, 0, 2, 0, 1]);
    expect(wordsPerLine(['\\begin{verbatim}', 'x y z', '\\end{verbatim} fin'])).toEqual([0, 0, 1]);
  });

  it('cleans titles', () => {
    expect(cleanTitle('Introducción a \\emph{todo}\\label{x}')).toBe('Introducción a todo');
    expect(cleanTitle('El \\LaTeX{} y ~ las \\textbf{cosas} --- fin')).toBe('El LaTeX y las cosas — fin');
  });
});

describe('GET /api/memoria/outline', () => {
  it('conserva todos los apartados y sus títulos, numerando solo hasta el nivel elegido', async () => {
    t = await setup({ ...memoriaFiles(), 'estilo/institucion.tex': '\\numerarHasta{secciones}\n\\indiceHasta{capitulos}\n' }, 'tfg.tex');
    let outline = await getOutline();
    const flatten = (items: OutlineItem[]): OutlineItem[] => items.flatMap((item) => [item, ...flatten(item.children)]);
    let all = flatten(outline.items);
    expect(all.find((item) => item.title === 'Contexto')?.number).toBe('1.1');
    expect(all.find((item) => item.title === 'Detalle')?.number).toBeNull();
    const file = path.join(t.cfg.memoriaDir, 'estilo/institucion.tex');
    await fs.writeFile(file, '\\numerarHasta{capitulos}\n');
    t.ctx.outline.invalidate();
    outline = await getOutline();
    all = flatten(outline.items);
    expect(all.find((item) => item.title === 'Contexto')?.number).toBeNull();
    expect(all.find((item) => item.title === 'Detalle')?.number).toBeNull();
  });
  for (const idioma of ['espanol', 'ingles']) {
    it(`ordena los resúmenes en ${idioma} sin duplicados y conserva líneas con CRLF`, async () => {
      const main = `\\input{datos}
\\begin{document}
\\frontmatter
% \\iflanguage{english}{comentario sin argumentos}
\\iflanguage{english}{%
  \\input{0-inicio/abstract}
  \\iflanguage{spanish}{\\input{no-existe}}{\\input{0-inicio/resumen}}
}{%
  \\input{0-inicio/resumen}
  \\input{0-inicio/abstract}
}
\\mainmatter
\\chapter{\\iflanguage{english}{Introduction}{Introducción}}
Texto propio.
\\end{document}
`;
      t = await setup({
        'tfg.tex': main.replace(/\n/g, '\r\n'),
        'datos.tex': `% \\idioma{${idioma === 'ingles' ? 'espanol' : 'ingles'}}\n\\idioma{ ${idioma} }\n`,
        '0-inicio/resumen.tex': '\\chapter*{Resumen}\nResumen propio.\n',
        '0-inicio/abstract.tex': '\\chapter*{Abstract}\nEnglish summary.\n',
      }, 'tfg.tex');
      const o = await getOutline();
      expect(o.warnings).toEqual([]);
      const res = o.items.filter((i: OutlineItem) => i.kind === 'frontmatter');
      expect(res.map((i: OutlineItem) => i.title)).toEqual(idioma === 'ingles' ? ['Abstract', 'Resumen'] : ['Resumen', 'Abstract']);
      expect(res.map((i: OutlineItem) => i.words)).toEqual([2, 2]);
      expect(o.items.at(-1)).toMatchObject({
        title: idioma === 'ingles' ? 'Introduction' : 'Introducción',
        number: '1',
        line: main.split('\n').findIndex((line) => line.startsWith('\\chapter')) + 1,
      });
    });
  }

  it('follows the main file, numbers like the PDF and detects disabled/missing/cycles', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex');
    const o = await getOutline();
    expect(o.main).toBe('tfg.tex');
    const top = o.items.map((i: OutlineItem) => [i.kind, i.number, i.title, i.enabled]);
    expect(top).toEqual([
      ['datos', null, 'Datos del trabajo', true],
      ['frontmatter', null, 'Resumen', true],
      ['frontmatter', null, 'Agradecimientos', true],
      ['frontmatter', null, 'Acrónimos', false],
      ['chapter', '1', 'Introducción a todo', true],
      ['chapter', '2', 'Objetivos', true],
      ['chapter', null, 'Antecedentes', false],
      ['chapter', '3', 'Ciclo', true],
      ['chapter', null, 'Falta', true],
      ['chapter', null, 'Nota sin numerar', true],
      ['appendix', 'A', 'Manual', true],
      ['bibliography', null, 'Bibliografía', true],
    ]);
    const intro = byTitle(o.items, 'Introducción a todo');
    expect(intro.file).toBe('1-capitulos/01-introduccion.tex');
    expect(intro.line).toBe(2);
    expect(intro.children.map((c) => [c.kind, c.number, c.title])).toEqual([
      ['section', '1.1', 'Contexto'],
      ['section', '1.2', 'Vacía'],
      ['section', null, 'Sin número'],
    ]);
    expect(byTitle(o.items, 'Detalle')).toMatchObject({ kind: 'subsection', number: '1.1.1', line: 15 });
    expect(byTitle(o.items, 'Instalación').number).toBe('A.1');
    expect(byTitle(o.items, 'Antecedentes')).toMatchObject({ file: '1-capitulos/03-antecedentes.tex', words: 10 });
    expect(byTitle(o.items, 'Acrónimos').file).toBe('0-inicio/acronimos.tex');
    expect(byTitle(o.items, 'Datos del trabajo').file).toBe('datos.tex');
    expect(byTitle(o.items, 'Falta').warnings).toContain('no encontrado');
    expect(byTitle(o.items, 'Bibliografía').entries).toBe(2);
    expect(o.warnings.some((x: string) => x.includes('circular'))).toBe(true);
    expect(o.warnings.some((x: string) => x.includes('05-falta'))).toBe(true);
    // ids unique
    const ids = flat(o.items).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('counts words, rolls them up and flags vacío / TODO', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex');
    const o = await getOutline();
    const intro = byTitle(o.items, 'Introducción a todo');
    expect(byTitle(o.items, 'Detalle').words).toBe(5);
    expect(byTitle(o.items, 'Contexto').words).toBe(35 + 5 + 5);
    expect(byTitle(o.items, 'Vacía').words).toBe(0);
    expect(byTitle(o.items, 'Sin número').words).toBe(3);
    expect(intro.words).toBe(40 + 45 + 0 + 3);
    expect(intro.warnings).toEqual(['TODO']);
    expect(byTitle(o.items, 'Vacía').warnings).toEqual(['vacío']);
    expect(byTitle(o.items, 'Detalle').warnings).toEqual(['vacío']);
    expect(byTitle(o.items, 'Contexto').warnings).toEqual([]);
    expect(byTitle(o.items, 'Nota sin numerar').warnings).toEqual(['vacío']);
    expect(byTitle(o.items, 'Resumen')).toMatchObject({ words: 12, warnings: [] }); // frontmatter: never «vacío»
    expect(byTitle(o.items, 'Manual').words).toBe(61);
    const enabledTop = o.items.filter((i: OutlineItem) => i.enabled).reduce((a: number, i: OutlineItem) => a + i.words, 0);
    expect(o.words).toBe(enabledTop);
    expect(o.words).toBe(12 + 7 + 88 + 94 + 40 + 4 + 61);
  });

  it('marks errores from the last compile (only errors, in the item range)', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex', {
      last: {
        ok: false,
        buildId: 'b1',
        startedAt: new Date().toISOString(),
        durationMs: 1,
        pdfUrl: null,
        sourceRev: 'x',
        diagnostics: [
          { severity: 'error', file: './1-capitulos/02-objetivos.tex', line: 6, message: 'Undefined control sequence' },
          { severity: 'warning', file: '1-capitulos/01-introduccion.tex', line: 3, message: 'algo' },
          { severity: 'error', file: '2-anexos/a-anexo.tex', line: null, message: 'sin línea' },
        ],
      },
    });
    const o = await getOutline();
    expect(byTitle(o.items, 'General').warnings).toContain('errores');
    expect(byTitle(o.items, 'Objetivos').warnings).not.toContain('errores');
    expect(byTitle(o.items, 'Introducción a todo').warnings).not.toContain('errores');
    expect(byTitle(o.items, 'Manual').warnings).toContain('errores');
  });

  it('works with a flat legacy layout (main.tex + \\input{intro.tex})', async () => {
    t = await setup(LEGACY, 'main.tex');
    const o = await getOutline();
    expect(o.items.map((i: OutlineItem) => [i.kind, i.number, i.title, i.file, i.words])).toEqual([
      ['chapter', '1', 'Introducción', 'intro.tex', 35],
      ['chapter', '2', 'Otro', 'otro.tex', 31],
    ]);
    expect(o.items[0].children[0]).toMatchObject({ number: '1.1', title: 'Uno', warnings: ['vacío'] });
    expect(o.words).toBe(66);
  });

  it('reports a missing main file without failing', async () => {
    t = await setup(LEGACY, 'nada.tex');
    const o = await getOutline();
    expect(o.items).toEqual([]);
    expect(o.warnings[0]).toMatch(/nada\.tex/);
  });

  it('emits SSE outline after a file change (debounced)', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex', { watch: true });
    await getOutline();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (t.app.server.address() as AddressInfo).port;
    let buf = '';
    const req = http.get(`http://127.0.0.1:${port}/api/events`);
    const res = await new Promise<http.IncomingMessage>((r) => req.on('response', r));
    res.setEncoding('utf8');
    res.on('data', (c) => (buf += c));
    try {
      await new Promise((r) => setTimeout(r, 100));
      await fs.appendFile(path.join(t.cfg.memoriaDir, '1-capitulos/02-objetivos.tex'), '\\section{Recién añadida}\n');
      const deadline = Date.now() + 8000;
      while (!buf.includes('event: outline') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const m = /event: outline\ndata: (.*)\n/.exec(buf);
      expect(m).toBeTruthy();
      const o = JSON.parse(m![1]);
      expect(byTitle(o.items, 'Recién añadida').number).toBe('2.2');
      // Cache was invalidated too.
      expect(byTitle((await getOutline()).items, 'Recién añadida')).toBeTruthy();
    } finally {
      req.destroy();
    }
  });
});

describe('GET /api/search outline field', () => {
  it('adds the innermost outline item for memoria hits', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex');
    const items = (await t.app.inject({ url: '/api/search?q=palabraunica&root=memoria' })).json().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: '1-capitulos/01-introduccion.tex', line: 16 });
    expect(items[0].outline).toMatchObject({ number: '1.1.1', title: 'Detalle' });
    expect(typeof items[0].outline.id).toBe('string');
    // Guidance comment before \chapter belongs to the chapter of that file.
    const g = (await t.app.inject({ url: '/api/search?q=gu%C3%ADa%20de%20prueba&root=all' })).json().items;
    expect(g[0].outline).toMatchObject({ number: '1', title: 'Introducción a todo' });
    // Preamble lines of the main file: null.
    const p = (await t.app.inject({ url: '/api/search?q=documentclass&root=memoria' })).json().items;
    expect(p.find((i: any) => i.path === 'tfg.tex').outline).toBeNull();
  });
});

describe('POST /api/memoria/sections', () => {
  it('crea subsecciones dentro de su sección y después de una subsección sin invadir la siguiente sección', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex');
    let o = await getOutline();
    const r = await post({ kind: 'subsection', title: 'Nuevo detalle', parent: byTitle(o.items, 'Contexto').id });
    expect(r.statusCode).toBe(200);
    expect(r.json().item).toMatchObject({ kind: 'subsection', number: '1.1.2' });
    o = await getOutline();
    expect(byTitle(o.items, 'Vacía').children).toEqual([]);
    const second = await post({ kind: 'subsection', title: 'Entre detalles', after: byTitle(o.items, 'Detalle').id });
    expect(second.statusCode).toBe(200);
    o = await getOutline();
    expect(byTitle(o.items, 'Entre detalles').number).toBe('1.1.2');
    expect(byTitle(o.items, 'Nuevo detalle').number).toBe('1.1.3');
    expect((await readMem(r.json().file)).match(/\\label\{sec:[^}]+\}/g)).toHaveLength(2);
  });

  it('creates a chapter with the next free number and inserts its include before \\appendix', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex');
    const r = await post({ kind: 'chapter', title: 'Metodología y diseño' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.file).toBe('1-capitulos/05-metodologia-y-diseno.tex');
    expect(body.line).toBe(1);
    expect(body.item).toMatchObject({ kind: 'chapter', number: '4', title: 'Metodología y diseño', file: body.file });
    const content = await readMem(body.file);
    expect(content.startsWith('\\chapter{Metodología y diseño}\\label{cap:metodologia-y-diseno}\n')).toBe(true);
    expect(content.split('\n').filter((l) => l.startsWith('%'))).toHaveLength(2);
    const main = (await readMem('tfg.tex')).split('\n');
    const i = main.indexOf('\\include{1-capitulos/05-metodologia-y-diseno}');
    expect(main[i - 1]).toBe('\\include{1-capitulos/05-falta}');
    expect(i).toBeLessThan(main.indexOf('\\appendix'));
    // Backup of tfg.tex
    const hist = path.join(t.cfg.historyDir, 'memoria', 'tfg.tex');
    expect((await fs.readdir(hist)).length).toBe(1);

    // Second chapter after «Objetivos»: next number 06, placed right after 02.
    const o = await getOutline();
    const r2 = await post({ kind: 'chapter', title: 'Análisis', after: byTitle(o.items, 'Objetivos').id });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().file).toBe('1-capitulos/06-analisis.tex');
    expect(r2.json().item.number).toBe('3');
    const main2 = (await readMem('tfg.tex')).split('\n');
    expect(main2[main2.indexOf('\\include{1-capitulos/02-objetivos}') + 1]).toBe('\\include{1-capitulos/06-analisis}');
  });

  it('creates an annex with the next letter after the last annex include', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex');
    const r = await post({ kind: 'appendix', title: 'Manual de usuario' });
    expect(r.statusCode).toBe(200);
    expect(r.json().file).toBe('2-anexos/b-manual-de-usuario.tex');
    expect(r.json().item).toMatchObject({ kind: 'appendix', number: 'B' });
    const main = (await readMem('tfg.tex')).split('\n');
    expect(main[main.indexOf('\\include{2-anexos/a-anexo}') + 1]).toBe('\\include{2-anexos/b-manual-de-usuario}');
  });

  it('appends a section to a chapter or after a given section', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex');
    let o = await getOutline();
    const r = await post({ kind: 'section', title: 'Específicos', parent: byTitle(o.items, 'Objetivos').id });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ file: '1-capitulos/02-objetivos.tex', item: { kind: 'section', number: '2.2', title: 'Específicos' } });
    const obj = (await readMem('1-capitulos/02-objetivos.tex')).split('\n');
    expect(obj[r.json().line - 1]).toBe('\\section{Específicos}\\label{sec:especificos}');
    expect(obj.at(-1)).toBe('');

    o = await getOutline();
    const r2 = await post({ kind: 'section', title: 'Motivación & alcance', after: byTitle(o.items, 'Contexto').id });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().item.number).toBe('1.2');
    const intro = (await readMem('1-capitulos/01-introduccion.tex')).split('\n');
    const at = intro.indexOf('\\section{Motivación \\& alcance}\\label{sec:motivacion-alcance}');
    expect(at).toBe(r2.json().line - 1);
    expect(intro.indexOf('\\section{Vacía}')).toBeGreaterThan(at);
    o = await getOutline();
    expect(byTitle(o.items, 'Vacía').number).toBe('1.3');
    expect(byTitle(o.items, 'Detalle').number).toBe('1.1.1');
  });

  it('409 when the main file changes between read and write (and leaves no orphan file)', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex');
    const mainAbs = path.join(t.cfg.memoriaDir, 'tfg.tex');
    sectionHooks.beforeCommit = async (file) => {
      if (file === 'tfg.tex') await fs.appendFile(mainAbs, '% cambio externo\n');
    };
    const r = await post({ kind: 'chapter', title: 'Choque' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: 'conflict', path: 'tfg.tex' });
    expect(r.json().content).toContain('% cambio externo');
    await expect(fs.stat(path.join(t.cfg.memoriaDir, '1-capitulos/05-choque.tex'))).rejects.toThrow();
    expect(await readMem('tfg.tex')).not.toContain('choque');
  });

  it('validates input', async () => {
    t = await setup(memoriaFiles(), 'tfg.tex');
    for (const [body, field] of [
      [{ kind: 'chapter', title: 'Con \\comando' }, 'title'],
      [{ kind: 'chapter', title: 'Con {llaves}' }, 'title'],
      [{ kind: 'chapter', title: '   ' }, 'title'],
      [{ kind: 'chapter', title: 'x'.repeat(121) }, 'title'],
      [{ kind: 'capitulo', title: 'Hola' }, 'kind'],
      [{ kind: 'section', title: 'Hola' }, 'parent'],
      [{ kind: 'section', title: 'Hola', parent: 'nope' }, 'parent'],
      [{ kind: 'chapter', title: 'Hola', after: 'nope' }, 'after'],
    ] as const) {
      const r = await post(body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json().field).toBe(field);
    }
    expect((await post({ kind: 'chapter', title: 'x'.repeat(120) })).statusCode).toBe(200);
  });

  it('legacy layout: new chapter file next to the last chapter, include style mimicked', async () => {
    t = await setup(LEGACY, 'main.tex');
    const r = await post({ kind: 'chapter', title: 'Conclusiones' });
    expect(r.statusCode).toBe(200);
    expect(r.json().file).toBe('conclusiones.tex');
    expect(r.json().item.number).toBe('3');
    const main = (await readMem('main.tex')).split('\n');
    expect(main[main.indexOf('\\input{otro}') + 1]).toBe('\\input{conclusiones}');
  });
});

describe('organizador de apartados', () => {
  const sources = () => ({
    'tfg.tex': '\\input{datos}\n\\begin{document}\n\\mainmatter\n\\include{a}\n\\include{b}\n\\appendix\n\\include{anexo}\n\\end{document}\n',
    'datos.tex': '\\idioma{espanol}\n',
    'a.tex': '\\chapter{Uno}\\label{cap:uno}\nIntroducción propia.\n\\section{Primera}\\label{sec:primera}\nTexto de la primera.\n\\subsection{Detalle A}\\label{sub:a}\nTexto A.\n\\subsection{Detalle B}\\label{sub:b}\nTexto B.\n\\section{Segunda}\\label{sec:segunda}\nTexto de la segunda con \\ref{sub:a}.\n\\section{Tercera}\\label{sec:tercera}\nTexto de la tercera.\n',
    'b.tex': '\\chapter{Dos}\\label{cap:dos}\nTexto dos con \\ref{sec:segunda}.\n',
    'anexo.tex': '\\chapter{Manual}\\label{cap:manual}\nTexto del anexo.\n',
  });
  const edit = async (title: string, action: string, extra: Record<string, unknown> = {}) => {
    const o = await getOutline();
    return t!.app.inject({ method: 'POST', url: '/api/memoria/sections/edit', payload: { id: byTitle(o.items, title).id, action, baseRev: o.revisions, ...extra } });
  };

  it('renombra una cabecera multilínea, actualiza su título corto y conserva etiquetas, referencias y CRLF', async () => {
    const files = sources();
    files['a.tex'] = files['a.tex'].replace('\\chapter{Uno}', '\\chapter[Corto]{Uno\ncon formato}').replace(/\n/g, '\r\n');
    t = await setup(files, 'tfg.tex');
    const before = await readMem('a.tex');
    const r = await edit('Uno con formato', 'rename', { title: 'Diseño & evaluación' });
    expect(r.statusCode).toBe(200);
    expect(await readMem('a.tex')).toBe(before.replace('\\chapter[Corto]{Uno\r\ncon formato}', '\\chapter{Diseño \\& evaluación}'));
    expect(await readMem('b.tex')).toBe(files['b.tex']);
    expect((await fs.readdir(path.join(t.cfg.historyDir, 'memoria', 'a.tex'))).length).toBe(1);
  });

  it('mueve capítulos por sus inclusiones, mantiene el anexo y no modifica sus archivos', async () => {
    const files = sources();
    t = await setup(files, 'tfg.tex');
    expect((await edit('Dos', 'up')).statusCode).toBe(200);
    let o = await getOutline();
    expect(o.items.filter((i: OutlineItem) => i.kind === 'chapter').map((i: OutlineItem) => [i.title, i.number])).toEqual([['Dos', '1'], ['Uno', '2']]);
    expect(byTitle(o.items, 'Manual').number).toBe('A');
    expect(await readMem('a.tex')).toBe(files['a.tex']);
    expect(await readMem('b.tex')).toBe(files['b.tex']);
    expect((await edit('Dos', 'down')).statusCode).toBe(200);
    expect(await readMem('tfg.tex')).toBe(files['tfg.tex']);
  });

  it('desactiva y activa un capítulo sin tocar su contenido y restaura exactamente la inclusión', async () => {
    const files = sources();
    files['tfg.tex'] = files['tfg.tex'].replace(/\n/g, '\r\n');
    t = await setup(files, 'tfg.tex');
    expect((await edit('Uno', 'toggle')).statusCode).toBe(200);
    let o = await getOutline();
    expect(byTitle(o.items, 'Uno').enabled).toBe(false);
    expect(byTitle(o.items, 'Dos').number).toBe('1');
    expect(await readMem('a.tex')).toBe(files['a.tex']);
    expect((await edit('Uno', 'toggle')).statusCode).toBe(200);
    expect(await readMem('tfg.tex')).toBe(files['tfg.tex']);
  });

  it('mueve una sección con todas sus subsecciones y conserva cada etiqueta y texto', async () => {
    const files = sources();
    t = await setup(files, 'tfg.tex');
    expect((await edit('Primera', 'down')).statusCode).toBe(200);
    const o = await getOutline();
    expect(byTitle(o.items, 'Uno').children.map((i) => i.title)).toEqual(['Segunda', 'Primera', 'Tercera']);
    expect(byTitle(o.items, 'Primera').children.map((i) => [i.title, i.number])).toEqual([['Detalle A', '1.2.1'], ['Detalle B', '1.2.2']]);
    expect((await edit('Primera', 'up')).statusCode).toBe(200);
    expect(await readMem('a.tex')).toBe(files['a.tex']);
  });

  it('promueve una subsección sin llevarse sus hermanas y puede bajarla bajo la sección anterior', async () => {
    t = await setup(sources(), 'tfg.tex');
    expect((await edit('Detalle A', 'promote')).statusCode).toBe(200);
    let o = await getOutline();
    expect(byTitle(o.items, 'Primera').children.map((i) => i.title)).toEqual(['Detalle B']);
    expect(byTitle(o.items, 'Uno').children.map((i) => i.title)).toEqual(['Primera', 'Detalle A', 'Segunda', 'Tercera']);
    expect((await readMem('a.tex'))).toContain('\\section{Detalle A}\\label{sub:a}\nTexto A.');
    expect((await edit('Detalle A', 'demote')).statusCode).toBe(200);
    o = await getOutline();
    expect(byTitle(o.items, 'Primera').children.map((i) => i.title)).toEqual(['Detalle B', 'Detalle A']);
    expect(byTitle(o.items, 'Detalle A').number).toBe('1.1.2');
    const before = await readMem('a.tex');
    expect((await edit('Primera', 'demote')).statusCode).toBe(400);
    expect(await readMem('a.tex')).toBe(before);
  });

  it('desactiva bloques completos con anidación y conserva el contenido al reactivarlos', async () => {
    const files = sources();
    files['a.tex'] = files['a.tex'].replace(/\n/g, '\r\n');
    t = await setup(files, 'tfg.tex');
    expect((await edit('Detalle A', 'toggle')).statusCode).toBe(200);
    const partial = await readMem('a.tex');
    expect((await edit('Primera', 'toggle')).statusCode).toBe(200);
    let o = await getOutline();
    expect(byTitle(o.items, 'Primera').enabled).toBe(false);
    expect(byTitle(o.items, 'Segunda').number).toBe('1.1');
    expect(flat(o.items).some((i) => i.title === 'Detalle B')).toBe(false);
    expect((await edit('Primera', 'toggle')).statusCode).toBe(200);
    expect(await readMem('a.tex')).toBe(partial);
    o = await getOutline();
    expect(byTitle(o.items, 'Detalle A').enabled).toBe(false);
    expect((await edit('Detalle A', 'toggle')).statusCode).toBe(200);
    expect(await readMem('a.tex')).toBe(files['a.tex']);
  });

  it('409 con una estructura obsoleta o un cambio concurrente en otra fuente, sin escribir', async () => {
    t = await setup(sources(), 'tfg.tex');
    const o = await getOutline();
    await fs.appendFile(path.join(t.cfg.memoriaDir, 'b.tex'), '% cambio externo\n');
    const original = await readMem('a.tex');
    const r = await t.app.inject({ method: 'POST', url: '/api/memoria/sections/edit', payload: { id: byTitle(o.items, 'Uno').id, action: 'rename', title: 'Otro', baseRev: o.revisions } });
    expect(r.statusCode).toBe(409);
    sectionHooks.beforeCommit = async () => { await fs.appendFile(path.join(t!.cfg.memoriaDir, 'b.tex'), '% otra edición\n'); };
    expect((await edit('Uno', 'rename', { title: 'Otro' })).statusCode).toBe(409);
    expect(await readMem('a.tex')).toBe(original);
  });

  it('bloquea solo el archivo modificado, sin invertir los bloqueos de otras operaciones', async () => {
    t = await setup(sources(), 'tfg.tex');
    await t.ctx.locks.run('memoria:tfg.tex', async () => {
      expect((await edit('Uno', 'rename', { title: 'Título revisado' })).statusCode).toBe(200);
    });
    expect(await readMem('a.tex')).toContain('\\chapter{Título revisado}\\label{cap:uno}');
  });

  it('rechaza acciones y revisiones inválidas, extremos, grupos especiales y cambios de nivel imposibles', async () => {
    const files = sources();
    files['a.tex'] = files['a.tex'].replace('\\section{Tercera}', '{\n\\section{Tercera}') + '}\n';
    t = await setup(files, 'tfg.tex');
    expect((await edit('Uno', 'inventada')).statusCode).toBe(400);
    expect((await edit('Uno', 'rename', { title: 'Válido', baseRev: null })).statusCode).toBe(400);
    expect((await edit('Uno', 'rename', { title: '\\input{fuera}' })).statusCode).toBe(400);
    expect((await edit('Uno', 'up')).statusCode).toBe(400);
    expect((await edit('Primera', 'demote')).statusCode).toBe(400);
    expect((await edit('Tercera', 'up')).statusCode).toBe(400);
    expect(await readMem('a.tex')).toBe(files['a.tex']);
    expect(await readMem('tfg.tex')).toBe(files['tfg.tex']);
  });

  it('no modifica otra cabecera cuando varias comparten línea ni aplica tras retirar una fuente', async () => {
    const files = sources();
    files['a.tex'] = '\\chapter{Uno}\\section{Compartida}\nContenido propio.\n';
    t = await setup(files, 'tfg.tex');
    expect((await edit('Compartida', 'rename', { title: 'Otra' })).statusCode).toBe(400);
    expect(await readMem('a.tex')).toBe(files['a.tex']);
    const o = await getOutline();
    await fs.unlink(path.join(t.cfg.memoriaDir, 'b.tex'));
    const r = await t.app.inject({ method: 'POST', url: '/api/memoria/sections/edit', payload: { id: byTitle(o.items, 'Dos').id, action: 'toggle', baseRev: o.revisions } });
    expect(r.statusCode).toBe(409);
    expect(await readMem('tfg.tex')).toBe(files['tfg.tex']);
  });

  it.each(['espanol', 'ingles'])('activa y desactiva las dos inclusiones alternativas del resumen en %s', async (idioma) => {
    const files: Record<string, string> = sources();
    files['datos.tex'] = '\\idioma{' + idioma + '}\n';
    files['resumen.tex'] = '\\chapter*{Resumen}\nResumen propio.\n';
    files['abstract.tex'] = '\\chapter*{Abstract}\nEnglish summary.\n';
    files['tfg.tex'] = files['tfg.tex'].replace('\\begin{document}\n', '\\begin{document}\n\\frontmatter\n\\iflanguage{english}{\n\\input{abstract}\n\\input{resumen}\n}{\n\\input{resumen}\n\\input{abstract}\n}\n');
    t = await setup(files, 'tfg.tex');
    expect((await edit('Resumen', 'toggle')).statusCode).toBe(200);
    expect((await readMem('tfg.tex')).match(/% \\input\{resumen\}/g)).toHaveLength(2);
    expect(byTitle((await getOutline()).items, 'Resumen').enabled).toBe(false);
    expect((await edit('Resumen', 'toggle')).statusCode).toBe(200);
    expect(await readMem('tfg.tex')).toBe(files['tfg.tex']);
  });
});
