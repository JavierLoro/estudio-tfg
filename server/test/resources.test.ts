import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWatcher } from '../src/events.ts';
import { setFrontmatterKeys } from '../src/frontmatter.ts';
import { rev } from '../src/fsutil.ts';
import { canSymlink, setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => { vi.restoreAllMocks(); await t.close(); });

const R = (n: string) => path.join(t.cfg.notesDir, 'Recursos', n);

const OLD = `---
type: resource
title: "Viejo"
url: https://old.example
# comentario que debe sobrevivir
captured: 2026-01-01T10:00:00+01:00
status: inbox
tags:
  - recurso
  - viejo
extra:
  anidado: true
---

Cuerpo **intacto**.

- lista
`;

const NEW = `---
type: resource
title: "Nuevo"
captured: 2026-10-01T09:00:00+02:00
status: revisado
tags: [recurso]
attachment: "adjuntos/x.pdf"
---
cuerpo
`;

beforeEach(async () => {
  await fs.writeFile(R('old.md'), OLD);
  await fs.writeFile(R('new.md'), NEW);
  await fs.writeFile(R('.oculto.md'), NEW);
  await fs.writeFile(R('notas.md.lock'), '');
});

describe('GET /api/resources', () => {
  it('lists frontmatter of .md in Recursos, most recent first', async () => {
    const res = await t.app.inject({ url: '/api/resources' });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.map((i: any) => i.path)).toEqual(['Recursos/new.md', 'Recursos/old.md']);
    expect(items[0]).toMatchObject({ title: 'Nuevo', captured: '2026-10-01T09:00:00+02:00', status: 'revisado', tags: ['recurso'], attachment: 'adjuntos/x.pdf' });
    expect(items[0].url).toBeUndefined();
    expect(items[1]).toMatchObject({ title: 'Viejo', url: 'https://old.example', status: 'inbox', tags: ['recurso', 'viejo'] });
  });

  it('includes freshly captured resources', async () => {
    await t.app.inject({ method: 'POST', url: '/api/capture', payload: { note: 'hoy', title: 'Hoy' } });
    const items = (await t.app.inject({ url: '/api/resources' })).json().items;
    expect(items[0].title).toBe('Hoy');
    expect(items[0].status).toBe('inbox');
  });
});

describe('PATCH /api/resources', () => {
  it('updates only status/tags and preserves the rest of the file byte-for-byte', async () => {
    const res = await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/old.md', status: 'revisado', tags: ['recurso', 'leído', 'tfg'], baseRev: rev(OLD) } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ path: 'Recursos/old.md', status: 'revisado', tags: ['recurso', 'leído', 'tfg'] });
    const after = await fs.readFile(R('old.md'), 'utf8');
    expect(after).toBe(OLD.replace('status: inbox', 'status: revisado').replace('  - viejo\n', '  - leído\n  - tfg\n'));
    expect(res.json().rev).toBe(rev(after));
    // backup of the previous version exists
    const baks = await fs.readdir(path.join(t.cfg.historyDir, 'notes', 'Recursos', 'old.md'));
    expect(baks).toHaveLength(1);
  });

  it('status only; flow-style tags untouched', async () => {
    await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/new.md', status: 'descartado', baseRev: rev(NEW) } });
    expect(await fs.readFile(R('new.md'), 'utf8')).toBe(NEW.replace('status: revisado', 'status: descartado'));
  });

  it('exige revisión válida sin modificar disco ni historial', async () => {
    for (const baseRev of [undefined, null, 2, '', 'abc']) {
      const res = await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/old.md', tags: ['cambio'], baseRev } });
      expect(res.statusCode).toBe(400);
      expect(await fs.readFile(R('old.md'), 'utf8')).toBe(OLD);
    }
    await expect(fs.stat(path.join(t.cfg.historyDir, 'notes', 'Recursos', 'old.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializa dos clientes y permite reaplicar solo tras leer la revisión actual', async () => {
    const responses = await Promise.all([
      { status: 'revisado' }, { tags: ['recurso', 'nuevo'] },
    ].map((changes) => t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/old.md', baseRev: rev(OLD), ...changes } })));
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = responses.findIndex((r) => r.statusCode === 409);
    const current = responses[loser].json();
    expect(current.content).toBe(await fs.readFile(R('old.md'), 'utf8'));
    const retried = await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/old.md', baseRev: current.rev, ...(loser === 0 ? { status: 'revisado' } : { tags: ['recurso', 'nuevo'] }) } });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ status: 'revisado', tags: ['recurso', 'nuevo'] });
    const baks = await fs.readdir(path.join(t.cfg.historyDir, 'notes', 'Recursos', 'old.md'));
    expect(baks).toHaveLength(2);
    expect(await fs.readFile(path.join(t.cfg.historyDir, 'notes', 'Recursos', 'old.md', baks.sort()[0]), 'utf8')).toBe(OLD);
  });

  it('409 on baseRev mismatch, no write', async () => {
    const res = await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/old.md', status: 'revisado', baseRev: '0000000000000000' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'conflict', content: OLD, rev: rev(OLD) });
    expect(await fs.readFile(R('old.md'), 'utf8')).toBe(OLD);
    const ok = await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/old.md', status: 'revisado', baseRev: rev(OLD) } });
    expect(ok.statusCode).toBe(200);
  });

  it('rejects traversal and missing files', async () => {
    expect((await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: '../x.md', status: 'a' } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/no.md', status: 'a', baseRev: rev(OLD) } })).statusCode).toBe(404);
  });
});

describe('setFrontmatterKeys', () => {
  it('adds missing keys and creates frontmatter when absent', () => {
    expect(setFrontmatterKeys('---\na: 1\n---\nbody', { status: 'inbox' })).toBe('---\na: 1\nstatus: inbox\n---\nbody');
    expect(setFrontmatterKeys('hola\n', { tags: ['a', 'b'] })).toBe('---\ntags:\n  - a\n  - b\n---\nhola\n');
  });
  it('handles tags at column 0 list style and CRLF', () => {
    expect(setFrontmatterKeys('---\ntags:\n- a\n- b\nz: 1\n---\nx', { tags: ['c'] })).toBe('---\ntags:\n  - c\nz: 1\n---\nx');
    expect(setFrontmatterKeys('---\r\nstatus: inbox\r\nz: 1\r\n---\r\nx', { status: 'ok' })).toBe('---\r\nstatus: ok\r\nz: 1\r\n---\r\nx');
  });
});


describe('recursos anidados y adjuntos', () => {
  const detail = (name: string) => t.app.inject({ url: `/api/resources/file?path=${encodeURIComponent('Recursos/' + name)}` });
  it('conserva fichas movidas desde la app, enlaces, adjuntos e historial', async () => {
    await fs.mkdir(R('adjuntos'));
    await fs.writeFile(R('adjuntos/x.pdf'), '%PDF-ficticio');
    const moved = await t.app.inject({ method: 'POST', url: '/api/move', payload: { root: 'notes', from: 'Recursos/new.md', to: 'Recursos/Archivo/ficha.md', updateLinks: true } });
    expect(moved.statusCode).toBe(200);
    expect((await t.app.inject('/api/resources')).json().items.map((i: any) => i.path)).toContain('Recursos/Archivo/ficha.md');
    const file = (await detail('Archivo/ficha.md')).json();
    expect(file.attachmentPath).toBe('Recursos/adjuntos/x.pdf');
    expect(file.content).toContain('../adjuntos/x.pdf');
    expect(file.content).toContain('cuerpo');
    expect(await fs.readFile(R('adjuntos/x.pdf'), 'utf8')).toBe('%PDF-ficticio');
    const baks = await fs.readdir(path.join(t.cfg.historyDir, 'notes', 'Recursos/Archivo/ficha.md'));
    expect(baks).toHaveLength(1);
  });

  it('tolera un traslado externo y recalcula después sus enlaces desde la app', async () => {
    await fs.mkdir(R('adjuntos'));
    await fs.writeFile(R('adjuntos/x.pdf'), '%PDF-ficticio');
    await fs.mkdir(R('Externo'));
    await fs.rename(R('new.md'), R('Externo/ficha.md'));
    const result = (await detail('Externo/ficha.md')).json();
    expect(result.attachmentPath).toBe('Recursos/adjuntos/x.pdf');
    expect(result.attachmentWarning).toContain('original');
    const list = (await t.app.inject('/api/resources')).json();
    expect(list.items.map((i: any) => i.path)).toContain('Recursos/Externo/ficha.md');
    const moved = await t.app.inject({ method: 'POST', url: '/api/move', payload: { root: 'notes', from: 'Recursos/Externo/ficha.md', to: 'Recursos/Final/ficha.md', updateLinks: true } });
    expect(moved.statusCode).toBe(200);
    expect((await detail('Final/ficha.md')).json().content).toContain('../adjuntos/x.pdf');
  });

  it('prioriza el adjunto relativo, admite ruta histórica del vault y avisa de ambigüedad', async () => {
    await fs.mkdir(R('sub/adjuntos'), {recursive: true});
    await fs.mkdir(path.join(t.cfg.notesDir, 'adjuntos'));
    await fs.writeFile(R('sub/ficha.md'), NEW);
    await fs.writeFile(R('sub/adjuntos/x.pdf'), 'relativo');
    await fs.writeFile(path.join(t.cfg.notesDir, 'adjuntos/x.pdf'), 'histórico');
    const ambiguous = (await detail('sub/ficha.md')).json();
    expect(ambiguous.attachmentPath).toBe('Recursos/sub/adjuntos/x.pdf');
    expect(ambiguous.attachmentWarning).toContain('varios');
    await fs.rm(R('sub/adjuntos/x.pdf'));
    expect((await detail('sub/ficha.md')).json().attachmentPath).toBe('adjuntos/x.pdf');
    await fs.rm(path.join(t.cfg.notesDir, 'adjuntos/x.pdf'));
    const missing = (await detail('sub/ficha.md')).json();
    expect(missing.attachmentPath).toBeNull();
    expect(missing.attachmentWarning).toContain('no encontrado');
    expect(missing.content).toBe(NEW);
  });

  it('un recurso y una carpeta ilegibles avisan sin ocultar los demás', async () => {
    await fs.mkdir(R('sin-permiso'));
    await fs.writeFile(R('sin-permiso/oculto.md'), NEW);
    const read = fs.readFile.bind(fs);
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, 'readFile').mockImplementation((async (...args: any[]) => {
      if (String(args[0]).endsWith('old.md')) throw Object.assign(new Error('Ficticio'), {code:'EACCES'});
      return (read as any)(...args);
    }) as typeof fs.readFile);
    vi.spyOn(fs, 'readdir').mockImplementation((async (...args: any[]) => {
      if (path.basename(String(args[0])) === 'sin-permiso') throw Object.assign(new Error('Ficticio'), {code:'EACCES'});
      return (readdir as any)(...args);
    }) as typeof fs.readdir);
    const result = (await t.app.inject('/api/resources')).json();
    expect(result.items.map((i: any) => i.path)).toEqual(['Recursos/new.md']);
    expect(result.warnings.map((w: any) => w.path).sort()).toEqual(['Recursos/old.md', 'Recursos/sin-permiso']);
  });

  it('ignora carpetas excluidas, enlaces externos y ciclos', async ({skip}) => {
    if (!(await canSymlink('dir'))) return skip();
    await fs.mkdir(R('.oculta'));
    await fs.writeFile(R('.oculta/ficha.md'), NEW);
    await fs.mkdir(path.join(t.dir, 'fuera'));
    await fs.writeFile(path.join(t.dir, 'fuera/secreto.md'), NEW);
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(path.join(t.dir, 'fuera'), R('escape'), kind);
    await fs.symlink(R(''), R('ciclo'), kind);
    const result = (await t.app.inject('/api/resources')).json();
    expect(result.items.map((i: any) => i.path)).toEqual(['Recursos/new.md', 'Recursos/old.md']);
    // Adjunto a través de enlace fuera del vault: nunca se abre.
    await fs.writeFile(R('new.md'), NEW.replace('adjuntos/x.pdf', 'escape/secreto.md'));
    const file = (await detail('new.md')).json();
    expect(file.attachmentPath).toBeNull();
    expect(file.attachmentWarning).toContain('segura');
  });

  it.each(['/etc/passwd', '../../../fuera.pdf', 'https://example.org/x.pdf', 'C:\\secreto.pdf'])('rechaza adjunto %s sin perder la ficha', async (attachment) => {
    await fs.writeFile(R('new.md'), NEW.replace('"adjuntos/x.pdf"', JSON.stringify(attachment)));
    const file = (await detail('new.md')).json();
    expect(file.attachmentPath).toBeNull();
    expect(file.attachmentWarning).toBeTruthy();
    expect(file.content).toContain('cuerpo');
  });
});


it('publica eventos del traslado externo y mantiene la ficha anidada', async () => {
  await fs.mkdir(R('externo'));
  const events: any[] = [];
  t.ctx.bus.on('change', (e) => events.push(e));
  const watcher = startWatcher(t.cfg, t.ctx.bus);
  await new Promise<void>((r) => watcher.once('ready', r));
  try {
    await fs.rename(R('new.md'), R('externo/ficha.md'));
    await vi.waitFor(() => {
      expect(events).toContainEqual({root:'notes',path:'Recursos/new.md',kind:'unlink'});
      expect(events).toContainEqual({root:'notes',path:'Recursos/externo/ficha.md',kind:'add'});
    }, {timeout:5000});
    const paths = (await t.app.inject('/api/resources')).json().items.map((i: any) => i.path);
    expect(paths).toContain('Recursos/externo/ficha.md');
    expect(paths).not.toContain('Recursos/new.md');
  } finally { await watcher.close(); }
});
