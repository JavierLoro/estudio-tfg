import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setFrontmatterKeys } from '../src/frontmatter.ts';
import { rev } from '../src/fsutil.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => t.close());

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
    const res = await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/old.md', status: 'revisado', tags: ['recurso', 'leído', 'tfg'] } });
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
    await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/new.md', status: 'descartado' } });
    expect(await fs.readFile(R('new.md'), 'utf8')).toBe(NEW.replace('status: revisado', 'status: descartado'));
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
    expect((await t.app.inject({ method: 'PATCH', url: '/api/resources', payload: { path: 'Recursos/no.md', status: 'a' } })).statusCode).toBe(404);
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
