import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWatcher } from '../src/events.ts';
import type { ChangeEvent } from '../src/events.ts';
import { rev } from '../src/fsutil.ts';
import { markdownCodeRanges } from '../src/links.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
let events: ChangeEvent[];
beforeEach(async () => {
  t = await setup();
  events = [];
  t.ctx.bus.on('change', (e: ChangeEvent) => events.push(e));
});
afterEach(async () => t.close());

const N = (p: string) => path.join(t.cfg.notesDir, ...p.split('/'));
const M = (p: string) => path.join(t.cfg.memoriaDir, ...p.split('/'));
async function write(abs: string, content: string | Buffer) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}
const read = (abs: string) => fs.readFile(abs, 'utf8');
const exists = (abs: string) => fs.lstat(abs).then(() => true, () => false);

function move(body: Record<string, unknown>, root = 'notes') {
  return t.app.inject({ method: 'POST', url: '/api/move', payload: { root, ...body } });
}

describe('POST /api/dir', () => {
  it('creates nested folders (201) and 409 if it exists', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/dir', payload: { root: 'notes', path: 'A/B/C' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ path: 'A/B/C' });
    expect((await fs.stat(N('A/B/C'))).isDirectory()).toBe(true);
    const again = await t.app.inject({ method: 'POST', url: '/api/dir', payload: { root: 'notes', path: 'A/B/C' } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBeTruthy();
    const file = await t.app.inject({ method: 'POST', url: '/api/dir', payload: { root: 'notes', path: 'Sistema/Arquitectura.md' } });
    expect(file.statusCode).toBe(409);
  });

  it('400 for root, outside root and bad root', async () => {
    for (const p of ['', '/', '../fuera', '/etc/x']) {
      const r = await t.app.inject({ method: 'POST', url: '/api/dir', payload: { root: 'notes', path: p } });
      expect(r.statusCode).toBe(400);
    }
    expect((await t.app.inject({ method: 'POST', url: '/api/dir', payload: { root: 'x', path: 'a' } })).statusCode).toBe(400);
  });
});

describe('POST /api/move', () => {
  it('renames a file and emits move before the watcher', async () => {
    await write(N('a.md'), 'hola');
    const r = await move({ from: 'a.md', to: 'b.md' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ path: 'b.md', moved: [{ from: 'a.md', to: 'b.md' }], updated: [] });
    expect(await exists(N('a.md'))).toBe(false);
    expect(await read(N('b.md'))).toBe('hola');
    expect(events).toEqual([{ root: 'notes', path: 'b.md', from: 'a.md', kind: 'move' }]);
  });

  it('moves a file into a (new) folder', async () => {
    await write(N('a.md'), 'hola');
    const r = await move({ from: 'a.md', to: 'X/Y/a.md' });
    expect(r.statusCode).toBe(200);
    expect(await read(N('X/Y/a.md'))).toBe('hola');
  });

  it('moves a folder with nested files and lists each one', async () => {
    await write(N('F/a.md'), '1');
    await write(N('F/sub/b.md'), '2');
    await write(N('F/sub/img.png'), Buffer.from([1, 2, 3]));
    await write(N('F/.oculto'), 'x');
    const r = await move({ from: 'F', to: 'G/F2' });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.path).toBe('G/F2');
    expect(b.moved).toEqual([
      { from: 'F/a.md', to: 'G/F2/a.md' },
      { from: 'F/sub/b.md', to: 'G/F2/sub/b.md' },
      { from: 'F/sub/img.png', to: 'G/F2/sub/img.png' },
    ]);
    expect(await read(N('G/F2/sub/b.md'))).toBe('2');
    expect(await read(N('G/F2/.oculto'))).toBe('x');
    expect(await exists(N('F'))).toBe(false);
    expect(events.filter((e) => e.kind === 'move')).toHaveLength(3);
  });

  it('404 / 409 / 400 cases', async () => {
    await write(N('F/a.md'), '1');
    await write(N('b.md'), '2');
    expect((await move({ from: 'nada.md', to: 'x.md' })).statusCode).toBe(404);
    expect((await move({ from: 'F/a.md', to: 'b.md' })).statusCode).toBe(409);
    expect((await move({ from: 'F', to: 'F/dentro' })).statusCode).toBe(400);
    expect((await move({ from: 'F', to: '../fuera' })).statusCode).toBe(400);
    expect((await move({ from: '', to: 'x' })).statusCode).toBe(400);
    expect((await move({ from: 'F', to: '' })).statusCode).toBe(400);
    expect((await move({ from: 'b.md', to: 'c.md', updateLinks: 'no' })).statusCode).toBe(400);
    // nothing changed
    expect(await read(N('F/a.md'))).toBe('1');
    expect(await read(N('b.md'))).toBe('2');
  });

  it('with the watcher: move events come before its unlink/add', { timeout: 10_000 }, async () => {
    await write(N('W/a.md'), 'x');
    const watcher = startWatcher(t.cfg, t.ctx.bus);
    await new Promise<void>((r) => watcher.once('ready', () => r()));
    try {
      const r = await move({ from: 'W', to: 'W2' });
      expect(r.statusCode).toBe(200);
      const deadline = Date.now() + 3000;
      while (!events.some((e) => e.kind === 'add' && e.path === 'W2/a.md') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const i = events.findIndex((e) => e.kind === 'move');
      expect(events[i]).toEqual({ root: 'notes', path: 'W2/a.md', from: 'W/a.md', kind: 'move' });
      // Todo lo que detecte el vigilante para esas rutas llega después.
      const watched = events.map((e, k) => ({ e, k })).filter(({ e }) => e.kind !== 'move' && /^W2?(\/|$)/.test(e.path));
      for (const { k } of watched) expect(k).toBeGreaterThan(i);
    } finally {
      await watcher.close();
    }
  });

  it('falls back to copy + remove across devices (EXDEV)', async () => {
    await write(N('F/a.md'), '1');
    await write(N('b.md'), '2');
    const exdev = () => Promise.reject(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }));
    const link = vi.spyOn(fs, 'link').mockImplementation(exdev);
    const rename = vi.spyOn(fs, 'rename').mockImplementation(exdev);
    try {
      expect((await move({ from: 'F', to: 'G' })).statusCode).toBe(200);
      expect((await move({ from: 'b.md', to: 'G/b.md', updateLinks: false })).statusCode).toBe(200);
    } finally {
      link.mockRestore();
      rename.mockRestore();
    }
    expect(await read(N('G/a.md'))).toBe('1');
    expect(await read(N('G/b.md'))).toBe('2');
    expect(await exists(N('F'))).toBe(false);
    expect(await exists(N('b.md'))).toBe(false);
  });

  it('case-only rename works', async () => {
    await write(N('nota.md'), 'x');
    const r = await move({ from: 'nota.md', to: 'Nota.md' });
    expect(r.statusCode).toBe(200);
    expect(await fs.readdir(t.cfg.notesDir)).toContain('Nota.md');
  });
});

describe('links in notes', () => {
  it('rewrites wikilinks keeping their form', async () => {
    await write(N('A/Nota.md'), '# Nota\n');
    await write(N('A/img.png'), Buffer.from([1]));
    const src = [
      '[[Nota]] y [[nota]]',
      '[[A/Nota]] y [[A/Nota.md]] y [[Nota.md]]',
      '[[Nota|alias]] [[Nota#Título|x]] [[Nota^bloque]] [[Nota#^b2]]',
      '![[Nota]] ![[img.png|200]] ![[A/img.png]]',
      '| [[Nota\\|tabla]] |',
      '[[ Nota ]] [[Otra]] [[#Sección]]',
    ].join('\n');
    await write(N('B/ref.md'), src);
    const r = await move({ from: 'A', to: 'C/A2' });
    expect(r.statusCode).toBe(200);
    // Bare names still unique: unchanged. Paths: new path.
    const out = await read(N('B/ref.md'));
    expect(out).toBe(
      [
        '[[Nota]] y [[nota]]',
        '[[C/A2/Nota]] y [[C/A2/Nota.md]] y [[Nota.md]]',
        '[[Nota|alias]] [[Nota#Título|x]] [[Nota^bloque]] [[Nota#^b2]]',
        '![[Nota]] ![[img.png|200]] ![[C/A2/img.png]]',
        '| [[Nota\\|tabla]] |',
        '[[ Nota ]] [[Otra]] [[#Sección]]',
      ].join('\n'),
    );
    expect(r.json().updated).toEqual([{ path: 'B/ref.md', rev: rev(out) }]);
  });

  it('renaming updates bare names, aliases, headings, blocks and embeds', async () => {
    await write(N('A/Nota.md'), 'x');
    await write(N('ref.md'), '[[Nota]] [[Nota.md|a]] [[Nota#T]] [[Nota^b]] ![[Nota]] [[A/Nota#T|z]] `[[Nota]]`\n```\n[[Nota]]\n```\n');
    const r = await move({ from: 'A/Nota.md', to: 'A/Nueva.md' });
    expect(r.statusCode).toBe(200);
    expect(await read(N('ref.md'))).toBe('[[Nueva]] [[Nueva.md|a]] [[Nueva#T]] [[Nueva^b]] ![[Nueva]] [[A/Nueva#T|z]] `[[Nota]]`\n```\n[[Nota]]\n```\n');
  });

  it('bare name that would become ambiguous becomes path-qualified', async () => {
    await write(N('A/Vieja.md'), 'x');
    await write(N('B/Nueva.md'), 'y');
    await write(N('ref.md'), 'ver [[Vieja]] y [[Nueva]]\n');
    const r = await move({ from: 'A/Vieja.md', to: 'A/Nueva.md' });
    expect(r.statusCode).toBe(200);
    // [[Vieja]] → path to the moved file; [[Nueva]] kept pointing to B/Nueva.md.
    const out = await read(N('ref.md'));
    expect(out).toBe('ver [[A/Nueva]] y [[B/Nueva]]\n');
  });

  it('a link to an unmoved note whose meaning would change is fixed', async () => {
    await write(N('A/Nota.md'), 'x');
    await write(N('B/Nota.md'), 'y');
    await write(N('ref.md'), '[[Nota]]\n'); // tie → A/Nota.md (shortest, alphabetical)
    const r = await move({ from: 'B/Nota.md', to: 'Nota.md' });
    expect(r.statusCode).toBe(200);
    expect(await read(N('ref.md'))).toBe('[[A/Nota]]\n');
  });

  it('markdown links in other notes and inside the moved note', async () => {
    await write(N('A/Mi Nota.md'), 'ver [otra](../B/otra.md#sec) y [img](<./img x.png>) y [abs](B/otra.md) y [web](https://x.org/a.md)\n');
    await write(N('A/img x.png'), Buffer.from([1]));
    await write(N('B/otra.md'), 'ir a [mi](../A/Mi%20Nota.md#Título "t") y ![i](../A/img%20x.png)\n');
    const r = await move({ from: 'A/Mi Nota.md', to: 'C/D/Mi Nota 2.md' });
    expect(r.statusCode).toBe(200);
    expect(await read(N('C/D/Mi Nota 2.md'))).toBe(
      'ver [otra](../../B/otra.md#sec) y [img](<../../A/img x.png>) y [abs](B/otra.md) y [web](https://x.org/a.md)\n',
    );
    expect(await read(N('B/otra.md'))).toBe('ir a [mi](../C/D/Mi%20Nota%202.md#Título "t") y ![i](../A/img%20x.png)\n');
    expect(r.json().updated.map((u: any) => u.path).sort()).toEqual(['B/otra.md', 'C/D/Mi Nota 2.md']);
  });

  it('markdown link without encoding gets %20 when the new name has spaces', async () => {
    await write(N('a.md'), 'x');
    await write(N('ref.md'), '[a](a.md)\n');
    await move({ from: 'a.md', to: 'una nota.md' });
    expect(await read(N('ref.md'))).toBe('[a](una%20nota.md)\n');
  });

  it('code blocks and inline code are not touched; CRLF and the rest stay byte-identical', async () => {
    await write(N('a.md'), 'x');
    const src = '---\r\ntitle: "x"\r\n---\r\nA [[a]] B\r\n~~~\r\n[[a]] [t](a.md)\r\n~~~\r\n``[[a]]`` [t](a.md)\r\n';
    await write(N('ref.md'), src);
    await move({ from: 'a.md', to: 'b.md' });
    expect(await read(N('ref.md'))).toBe('---\r\ntitle: "x"\r\n---\r\nA [[b]] B\r\n~~~\r\n[[a]] [t](a.md)\r\n~~~\r\n``[[a]]`` [t](b.md)\r\n');
  });

  it('updateLinks:false only moves', async () => {
    await write(N('a.md'), 'x');
    await write(N('ref.md'), '[[a]]\n');
    const r = await move({ from: 'a.md', to: 'b.md', updateLinks: false });
    expect(r.json().updated).toEqual([]);
    expect(await read(N('ref.md'))).toBe('[[a]]\n');
  });

  it('rewritten files get a history backup', async () => {
    await write(N('a.md'), 'x');
    await write(N('ref.md'), '[[a]]\n');
    await move({ from: 'a.md', to: 'b.md' });
    const hist = path.join(t.cfg.historyDir, 'notes', 'ref.md');
    const baks = await fs.readdir(hist);
    expect(baks).toHaveLength(1);
    expect(await read(path.join(hist, baks[0]))).toBe('[[a]]\n');
  });

  it('a moved note that is rewritten is backed up under its new path', async () => {
    await write(N('A/n.md'), '[x](../B/o.md)\n');
    await write(N('B/o.md'), 'o');
    const r = await move({ from: 'A/n.md', to: 'n.md' });
    expect(r.json().updated).toEqual([{ path: 'n.md', rev: rev('[x](B/o.md)\n') }]);
    expect(await read(N('n.md'))).toBe('[x](B/o.md)\n');
    expect(await fs.readdir(path.join(t.cfg.historyDir, 'notes', 'n.md'))).toHaveLength(1);
  });

  it('resource attachment: moving the attachment and moving the note', async () => {
    const note = '---\ntype: resource\ntitle: "R"\nattachment: "adjuntos/doc.pdf"\n---\n\nTexto\n';
    await write(N('Recursos/2026-10-06 R.md'), note);
    await write(N('Recursos/adjuntos/doc.pdf'), Buffer.from('%PDF'));
    const r1 = await move({ from: 'Recursos/adjuntos/doc.pdf', to: 'Recursos/adjuntos/papel.pdf' });
    expect(r1.statusCode).toBe(200);
    expect(await read(N('Recursos/2026-10-06 R.md'))).toBe(note.replace('adjuntos/doc.pdf', 'adjuntos/papel.pdf'));
    const r2 = await move({ from: 'Recursos/2026-10-06 R.md', to: 'Archivo/R.md' });
    expect(r2.statusCode).toBe(200);
    expect(await read(N('Archivo/R.md'))).toBe(note.replace('adjuntos/doc.pdf', '../Recursos/adjuntos/papel.pdf'));
    const list = await t.app.inject({ url: '/api/resources' });
    expect(list.statusCode).toBe(200);
  });

  it('inline code ranges do not cross blank lines', () => {
    const s = 'a ` b\n\nc `x` d';
    const r = markdownCodeRanges(s);
    expect(r.map(([a, b]) => s.slice(a, b))).toEqual(['`x`']);
  });
});

describe('links in memoria (LaTeX)', () => {
  it('\\input, \\include, \\includegraphics (graphicspath), \\bibliography; with and without extension', async () => {
    await write(M('capitulos/intro.tex'), 'Intro\n');
    await write(M('figuras/esquema.png'), Buffer.from([1]));
    await write(M('figuras/otra.pdf'), Buffer.from([1]));
    const src = [
      '\\input{capitulos/intro}',
      '\\input{capitulos/intro.tex}',
      '\\include{capitulos/intro}',
      '% \\input{capitulos/intro}',
      '\\begin{verbatim}',
      '\\input{capitulos/intro}',
      '\\end{verbatim}',
      '\\includegraphics[width=\\linewidth]{esquema}',
      '\\includegraphics{esquema.png}',
      '\\includegraphics{figuras/esquema}',
      '\\includegraphics{otra}',
      '\\bibliography{bibliografia}',
      '\\verb|\\input{capitulos/intro}|',
      '',
    ].join('\n');
    await write(M('cap.tex'), src);
    const r1 = await move({ from: 'capitulos/intro.tex', to: '1-capitulos/introduccion.tex' }, 'memoria');
    expect(r1.statusCode).toBe(200);
    const r2 = await move({ from: 'figuras/esquema.png', to: 'figuras/diagramas/esquema-v2.png' }, 'memoria');
    expect(r2.statusCode).toBe(200);
    const r3 = await move({ from: 'bibliografia.bib', to: 'refs/biblio.bib' }, 'memoria');
    expect(r3.statusCode).toBe(200);
    expect(r3.json().updated.map((u: any) => u.path)).toContain('tfg.tex');
    expect(await read(M('cap.tex'))).toBe(
      [
        '\\input{1-capitulos/introduccion}',
        '\\input{1-capitulos/introduccion.tex}',
        '\\include{1-capitulos/introduccion}',
        '% \\input{capitulos/intro}',
        '\\begin{verbatim}',
        '\\input{capitulos/intro}',
        '\\end{verbatim}',
        '\\includegraphics[width=\\linewidth]{diagramas/esquema-v2}',
        '\\includegraphics{diagramas/esquema-v2.png}',
        '\\includegraphics{figuras/diagramas/esquema-v2}',
        '\\includegraphics{otra}',
        '\\bibliography{refs/biblio}',
        '\\verb|\\input{capitulos/intro}|',
        '',
      ].join('\n'),
    );
    expect(await read(M('tfg.tex'))).toContain('\\bibliography{refs/biblio}');
  });

  it('moving a chapter folder updates \\include in tfg.tex', async () => {
    const before = await read(M('tfg.tex'));
    const r = await move({ from: '1-capitulos', to: 'capitulos' }, 'memoria');
    expect(r.statusCode).toBe(200);
    const after = await read(M('tfg.tex'));
    expect(after).toBe(before.replace(/\\include\{1-capitulos\//g, '\\include{capitulos/'));
  });
});

describe('DELETE /api/file (papelera) and restore', () => {
  const del = (root: string, p: string) => t.app.inject({ method: 'DELETE', url: `/api/file?root=${root}&path=${encodeURIComponent(p)}` });
  const restore = (root: string, p: string, trashPath: string) =>
    t.app.inject({ method: 'POST', url: '/api/trash/restore', payload: { root, path: p, trashPath } });

  it('notes: moves to .trash with (n) suffix on collision, hidden from tree; restore and 409', async () => {
    await write(N('A/n.md'), 'uno');
    const r1 = await del('notes', 'A/n.md');
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ path: 'A/n.md' });
    expect(await read(path.join(t.cfg.notesDir, '.trash', 'A', 'n.md'))).toBe('uno');
    expect(await exists(N('A/n.md'))).toBe(false);

    await write(N('A/n.md'), 'dos');
    const r2 = await del('notes', 'A/n.md');
    expect(await read(path.join(t.cfg.notesDir, '.trash', 'A', 'n (2).md'))).toBe('dos');

    const tree = await t.app.inject({ url: '/api/tree?root=notes' });
    expect(JSON.stringify(tree.json())).not.toContain('.trash');

    const ok = await restore('notes', 'A/n.md', r2.json().trashPath);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ path: 'A/n.md' });
    expect(await read(N('A/n.md'))).toBe('dos');
    const conflict = await restore('notes', 'A/n.md', r1.json().trashPath);
    expect(conflict.statusCode).toBe(409);
    expect(await read(path.join(t.cfg.notesDir, '.trash', 'A', 'n.md'))).toBe('uno');
    expect((await restore('notes', 'A/x.md', 'no/existe.md')).statusCode).toBe(404);
    expect((await restore('notes', 'A/x.md', '../../fuera.md')).statusCode).toBe(400);
  });

  it('notes: a folder goes to the trash and comes back', async () => {
    await write(N('F/a.md'), '1');
    await write(N('F/s/b.md'), '2');
    const r = await del('notes', 'F');
    expect(r.statusCode).toBe(200);
    expect(await exists(N('F'))).toBe(false);
    expect(await read(path.join(t.cfg.notesDir, '.trash', 'F', 's', 'b.md'))).toBe('2');
    const back = await restore('notes', 'F', r.json().trashPath);
    expect(back.statusCode).toBe(200);
    expect(await read(N('F/s/b.md'))).toBe('2');
  });

  it('memoria: goes to data/trash/memoria/<timestamp>/<path> (outside the memoria)', async () => {
    const r = await del('memoria', '0-inicio/resumen.tex');
    expect(r.statusCode).toBe(200);
    const { trashPath } = r.json();
    expect(trashPath).toMatch(/^[0-9T-]+Z\/0-inicio\/resumen\.tex$/);
    const abs = path.join(path.dirname(t.cfg.buildDir), 'trash', 'memoria', ...trashPath.split('/'));
    expect(await exists(abs)).toBe(true);
    expect(await exists(M('0-inicio/resumen.tex'))).toBe(false);
    const back = await restore('memoria', '0-inicio/resumen.tex', trashPath);
    expect(back.statusCode).toBe(200);
    expect(await exists(M('0-inicio/resumen.tex'))).toBe(true);
    // the empty timestamp folder is cleaned up
    expect(await fs.readdir(path.join(path.dirname(t.cfg.buildDir), 'trash', 'memoria'))).toEqual([]);
  });

  it('404 missing, 400 root/outside', async () => {
    expect((await del('notes', 'nada.md')).statusCode).toBe(404);
    expect((await del('notes', '')).statusCode).toBe(400);
    expect((await del('notes', '../x')).statusCode).toBe(400);
  });
});

describe('auth', () => {
  it('write routes require the token when AUTH_TOKEN is set', async () => {
    const a = await setup({ AUTH_TOKEN: 's3cret' });
    try {
      await fs.writeFile(path.join(a.cfg.notesDir, 'a.md'), 'x');
      const calls = [
        { method: 'POST' as const, url: '/api/dir', payload: { root: 'notes', path: 'D' } },
        { method: 'POST' as const, url: '/api/move', payload: { root: 'notes', from: 'a.md', to: 'b.md' } },
        { method: 'DELETE' as const, url: '/api/file?root=notes&path=a.md' },
        { method: 'POST' as const, url: '/api/trash/restore', payload: { root: 'notes', path: 'a.md', trashPath: 'a.md' } },
      ];
      for (const c of calls) expect((await a.app.inject(c)).statusCode).toBe(401);
      expect(await fs.readFile(path.join(a.cfg.notesDir, 'a.md'), 'utf8')).toBe('x');
      const ok = await a.app.inject({ ...calls[1], headers: { authorization: 'Bearer s3cret' } });
      expect(ok.statusCode).toBe(200);
    } finally {
      await a.close();
    }
  });
});
