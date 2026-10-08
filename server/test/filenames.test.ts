import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sanitizeFilename, sanitizeTitle } from '../src/capture.ts';
import { validSegment } from '../src/paths.ts';
import { multipart, setup, type TestEnv } from './helpers.ts';

describe('nombres portables', () => {
  const reserved = ['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, n) => `COM${n + 1}`), ...Array.from({ length: 9 }, (_, n) => `LPT${n + 1}`), 'COM¹', 'COM²', 'COM³', 'LPT¹', 'LPT²', 'LPT³'];
  it.each(reserved)('rechaza %s sin distinguir mayúsculas o extensión', (name) => {
    expect(validSegment(name)).toBe(false);
    expect(validSegment(`${name.toLowerCase()}.tex`)).toBe(false);
    expect(validSegment(`${name}.tar.gz`)).toBe(false);
    expect(validSegment(`${name} .md`)).toBe(false);
  });
  it.each([...'< > : " | ? * / \\'.split(' ').filter(Boolean), ...Array.from({ length: 32 }, (_, n) => String.fromCharCode(n)), '\u007f'])('rechaza el carácter %j', (char) => {
    expect(validSegment(`nota${char}nombre.md`)).toBe(false);
  });
  it.each(['', '.', '..', 'nota.', 'nota ', 'carpeta. ', 'aux.md'])('rechaza %j', (name) => expect(validSegment(name)).toBe(false));
  it.each(['nota.md', 'Notas del TFG', 'Introducción.tex', '.oculto', 'CON (recurso).md', 'auxiliar.tex', 'COM0', 'COM10', 'LPT0', 'LPT10', 'dos..puntos', 'COM1archivo.txt'])('acepta %s', (name) => expect(validSegment(name)).toBe(true));
  it.each(reserved)('sanea el reservado %s antes de la extensión', (name) => {
    expect(sanitizeTitle(name)).toBe(`${name} (recurso)`);
    expect(sanitizeFilename(`${name}.pdf`)).toBe(`${name} (recurso).pdf`);
    expect(validSegment(sanitizeTitle(`${name}.txt`) + '.md')).toBe(true);
  });
  it.each(['adjunto.', 'foto..', 'CON.txt.', 'nota.???', 'aux .pdf', 'archivo.mp '])('sanea extensiones y espacios inválidos en %j', (name) => {
    expect(validSegment(sanitizeFilename(name))).toBe(true);
  });
});

describe('validación de nombres en la API', () => {
  let t: TestEnv;
  beforeEach(async () => { t = await setup(); });
  afterEach(async () => t.close());

  it.each(['aux.md', 'nota:x.md', 'archivo?.md', 'nombre.md ', 'nombre.md.', 'NUL.tex', 'COM1.md', 'nombre\u0001.md', 'nombre\u007f.md'])('crear %j da 400 con field sin efectos en disco', async (name) => {
    const before = await fs.readdir(t.cfg.notesDir);
    const res = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: name, content: 'datos' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ field: 'path', error: expect.stringContaining('no válido') });
    expect(await fs.readdir(t.cfg.notesDir)).toEqual(before);
  });

  it('validar carpetas intermedias no deja un árbol parcial', async () => {
    for (const name of ['nuevo/aux/nota.md', 'nuevo/mala:carpeta/nota.md']) {
      const res = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: name } });
      expect(res.statusCode).toBe(400);
      expect(res.json().field).toBe('path');
    }
    const dir = await t.app.inject({ method: 'POST', url: '/api/dir', payload: { root: 'notes', path: 'nuevo/carpeta. ' } });
    expect(dir.statusCode).toBe(400);
    expect(dir.json().field).toBe('path');
    await expect(fs.stat(path.join(t.cfg.notesDir, 'nuevo'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('renombrar o mover a un nombre inválido conserva el origen y no emite move', async () => {
    const src = path.join(t.cfg.notesDir, 'origen.md');
    await fs.writeFile(src, 'datos');
    const events: unknown[] = [];
    t.ctx.bus.on('change', (e) => events.push(e));
    for (const to of ['aux.md', 'nuevo/CON/nota.md', 'archivo:ads.md', 'nota.md ']) {
      const res = await t.app.inject({ method: 'POST', url: '/api/move', payload: { root: 'notes', from: 'origen.md', to } });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ field: 'to', error: expect.stringContaining('no válido') });
      expect(await fs.readFile(src, 'utf8')).toBe('datos');
    }
    expect(events).toEqual([]);
    await expect(fs.stat(path.join(t.cfg.notesDir, 'nuevo'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('las rutas no seguras siguen dando 400 con el campo de destino', async () => {
    for (const name of ['../x.md', 'C:/x.md', 'a\\x.md', 'nul\0.md']) {
      const res = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: name } });
      expect(res.statusCode).toBe(400);
      expect(res.json().field).toBe('path');
    }
  });

  it.skipIf(process.platform === 'win32')('lee, guarda y mueve nombres antiguos y permite usar sus carpetas', async () => {
    const dir = path.join(t.cfg.notesDir, 'carpeta:antigua');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'aux.md'), 'original');
    const old = 'carpeta:antigua/aux.md';
    const read = await t.app.inject({ url: `/api/file?root=notes&path=${encodeURIComponent(old)}` });
    expect(read.statusCode).toBe(200);
    const saved = await t.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'notes', path: old, content: 'editado', baseRev: read.json().rev } });
    expect(saved.statusCode).toBe(200);
    const created = await t.app.inject({ method: 'POST', url: '/api/file', payload: { root: 'notes', path: 'carpeta:antigua/nuevo.md', content: 'nuevo' } });
    expect(created.statusCode).toBe(200);
    const moved = await t.app.inject({ method: 'POST', url: '/api/move', payload: { root: 'notes', from: old, to: 'recuperado.md', updateLinks: false } });
    expect(moved.statusCode).toBe(200);
    expect(await fs.readFile(path.join(t.cfg.notesDir, 'recuperado.md'), 'utf8')).toBe('editado');
  });

  it('captura CON como nombre portable y conserva el título mostrado', async () => {
    const fd = new FormData();
    fd.set('title', 'CON');
    fd.set('file', new Blob(['%PDF-ficticio']), 'aux.pdf');
    const res = await t.app.inject({ method: 'POST', url: '/api/capture', ...await multipart(fd) });
    expect(res.statusCode).toBe(200);
    const result = res.json<{ path: string; title: string }>();
    expect(result.path).toMatch(/ CON \(recurso\)\.md$/);
    expect(result.title).toBe('CON');
    expect(await fs.readFile(path.join(t.cfg.notesDir, result.path), 'utf8')).toContain('title: "CON"');
    expect(await fs.readFile(path.join(t.cfg.notesDir, 'Recursos/adjuntos/aux (recurso).pdf'), 'utf8')).toBe('%PDF-ficticio');
  });
});
