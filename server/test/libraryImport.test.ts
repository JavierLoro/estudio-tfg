import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setup, multipart, type TestEnv } from './helpers.ts';
import { libraryId } from '../src/libraryIdentity.ts';
import { sourceHash } from '../src/bibliography.ts';

let t: TestEnv;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});
const text =
  '% Original ficticio\n@string{rev={Revista}}\n@article{Ficticio2026,title={Título ficticio},author={Autor, Ana},year=2026,journal=rev,custom={Conservar}}\n@book{Libro2026,title={Libro ficticio},author={Otro, Autor},year=2026,publisher={Editorial}}';
const preview = async (format = 'bibtex', content = text) =>
  (await t.app.inject({ method: 'POST', url: '/api/library/import/preview', payload: { format, text: content } })).json();
const apply = (p: any, id = crypto.randomUUID(), items = p.items.map((i: any) => ({ ...i, action: 'create' }))) =>
  t.app.inject({
    method: 'POST',
    url: '/api/library/import',
    payload: { operationId: id, libraryId: libraryId(t.cfg), source: p.source, items },
  });
const detail = async (p: string) => (await t.app.inject(`/api/resources/file?path=${encodeURIComponent(p)}`)).json();

it('conserva el original exacto, crea fichas y reimporta/reintenta sin duplicar ni modificar .bib manuales', async () => {
  const manual = path.join(t.cfg.memoriaDir, 'bibliografia.bib'),
    before = await fs.readFile(manual);
  const p = await preview(),
    id = crypto.randomUUID(),
    r = (await apply(p, id)).json();
  expect(r.results.map((i: any) => i.state)).toEqual(['done', 'done']);
  const f = await detail(r.results[0].path);
  expect(f.item.bibliography.fields.custom).toBe('Conservar');
  expect(f.item.bibliography.source).toMatchObject({ hash: sourceHash(text), index: 0 });
  expect(await fs.readFile(path.join(t.cfg.notesDir, 'Recursos/originales', sourceHash(text) + '.bib'), 'utf8')).toBe(text);
  expect((await apply(p, id)).json()).toEqual(r);
  expect((await apply(await preview())).json().results.every((i: any) => i.duplicate)).toBe(true);
  expect((await t.app.inject('/api/resources')).json().items).toHaveLength(2);
  expect(await fs.readFile(manual)).toEqual(before);
});
it('una entrada incompleta no impide guardar las otras; se conserva su formulario para corregirla', async () => {
  const p = await preview('ris', 'TY  - JOUR\nTI  - Correcta\nER  - \nTY  - BOOK\nAU  - Ficticio\nER  - \n');
  const r = (await apply(p)).json();
  expect(r.results.map((i: any) => i.state)).toEqual(['error', 'done']);
  const op = (await t.app.inject('/api/library/import/operations')).json().items[0];
  expect(op.items).toHaveLength(2);
  expect(op.items[1].title).toBe('');
  const fixed = op.items.map((c: any) => ({ ...c, title: c.title || 'Corregida' }));
  expect((await apply(p, crypto.randomUUID(), fixed)).json().results.filter((i: any) => i.state === 'done')).toHaveLength(2);
  expect((await t.app.inject('/api/resources')).json().items).toHaveLength(2);
  const corrected = (await preview('ris', p.source.text)).items[1].candidates[0],
    replacement = await preview('bibtex', '@book{Actualizada,title={Otro título},year={2026}}'),
    choice = { ...replacement.items[0], action: 'merge', targetId: corrected.id, baseRev: corrected.baseRev };
  expect((await apply(replacement, crypto.randomUUID(), [choice])).json().results[0].state).toBe('done');
  const recovered = (await t.app.inject('/api/library/import/operations')).json().items;
  expect(recovered.every((operation: any) => operation.results.every((r: any) => r.state === 'done'))).toBe(true);
});
it('reimporta originales históricos tras combinar sin alterar la ficha ni confundir entradas del mismo lote', async () => {
  const fd = new FormData();
  fd.set('libraryVersion', '1');
  fd.set('title', 'Título ficticio');
  fd.set('note', 'Notas que conservar');
  fd.append('files', new Blob(['%PDF-1.4 Ficticio']), 'ficticio.pdf');
  const created = (await t.app.inject({ method: 'POST', url: '/api/capture', ...(await multipart(fd)) })).json(),
    original = await detail(created.path),
    p = await preview(),
    associate = { ...p.items[0], action: 'associate', targetId: original.item.id, baseRev: original.rev };
  expect((await apply(p, crypto.randomUUID(), [associate])).json().results[0].state).toBe('done');
  const associated = await detail(created.path),
    newer = await preview('bibtex', '@article{Nueva2026,title={Título revisado ficticio},author={Nueva, Ana},year={2027}}'),
    merge = { ...newer.items[0], action: 'merge', targetId: original.item.id, baseRev: associated.rev };
  expect((await apply(newer, crypto.randomUUID(), [merge])).json().results[0].state).toBe('done');
  const merged = await detail(created.path);
  expect(merged.item.title).toBe('Título revisado ficticio');
  expect(merged.item.bibliography.fields.doi).toBeUndefined();
  expect(merged.item.bibliography.key).toBe(associated.item.bibliography.key);
  expect(merged.item.note).toBe(original.item.note);
  expect(merged.attachments).toEqual(original.attachments);
  const reimport = await preview();
  expect(reimport.items[0].candidates).toEqual([expect.objectContaining({ id: original.item.id, reason: 'original', exact: true })]);
  expect(reimport.items[1].candidates).toEqual([]);
  const result = (await apply(reimport)).json();
  expect(result.results[0]).toMatchObject({ state: 'done', id: original.item.id, path: created.path, duplicate: true });
  expect(result.results[1]).toMatchObject({ state: 'done' });
  expect(result.results[1].id).not.toBe(original.item.id);
  expect(result.results[1].duplicate).toBeUndefined();
  expect(await detail(created.path)).toEqual(merged);
  expect((await t.app.inject('/api/resources')).json().items).toHaveLength(2);
});
it('asocia a un PDF sin perder notas, adjuntos ni identidad; un cambio externo impide combinar', async () => {
  const fd = new FormData();
  fd.set('libraryVersion', '1');
  fd.set('title', 'Título ficticio');
  fd.set('note', 'Notas que conservar');
  fd.append('files', new Blob(['%PDF-1.4 Ficticio']), 'ficticio.pdf');
  const created = (await t.app.inject({ method: 'POST', url: '/api/capture', ...(await multipart(fd)) })).json(),
    f = await detail(created.path);
  const p = await preview();
  expect(p.items[0].candidates[0].id).toBe(f.item.id);
  const choice = { ...p.items[0], action: 'associate', targetId: f.item.id, baseRev: f.rev };
  const r = (await apply(p, crypto.randomUUID(), [choice])).json();
  expect(r.results[0].state).toBe('done');
  const after = await detail(created.path);
  expect(after.item.note).toBe(f.item.note);
  expect(after.attachments).toEqual(f.attachments);
  expect(after.item.id).toBe(f.item.id);
  await fs.appendFile(path.join(t.cfg.notesDir, created.path), '\nCambio externo');
  const conflict = (await apply(p, crypto.randomUUID(), [{ ...choice, action: 'merge', baseRev: after.rev }])).json();
  expect(conflict.results[0].state).toBe('error');
  expect((await detail(created.path)).item.note).toContain('Cambio externo');
});
it('recupera un fallo después de publicar la ficha sin repetirla ni perder el registro', async () => {
  const p = await preview(),
    id = crypto.randomUUID(),
    rename = fs.rename.bind(fs);
  let fail = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to).endsWith(id + '.json') && !fail) {
      const names = await fs.readdir(path.join(t.cfg.notesDir, 'Recursos'));
      if (names.some((n) => /^[0-9a-f-]+\.md$/.test(n))) {
        fail = true;
        throw new Error('Fallo ficticio del checkpoint');
      }
    }
    return rename(from, to);
  });
  expect((await apply(p, id)).statusCode).toBe(500);
  vi.restoreAllMocks();
  const r = (await apply(p, id)).json();
  expect(r.results.every((i: any) => i.state === 'done')).toBe(true);
  expect((await t.app.inject('/api/resources')).json().items).toHaveLength(2);
});
it('consulta DOI con el transporte R5 inyectado y conserva campos incompletos para corrección manual', async () => {
  const fetcher = vi.fn().mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(
      JSON.stringify({
        message: {
          DOI: '10.1234/ficticio',
          type: 'journal-article',
          title: ['DOI ficticio'],
          author: [{ family: 'Ficticio', given: 'Autor' }],
          issued: { 'date-parts': [[2026]] },
        },
      }),
    ),
  });
  await t.close();
  t = await setup({}, { fetchMetadata: fetcher });
  const r = (
    await t.app.inject({
      method: 'POST',
      url: '/api/library/import/preview',
      payload: { format: 'doi', doi: 'https://doi.org/10.1234/Ficticio' },
    })
  ).json();
  expect(fetcher).toHaveBeenCalledWith('https://api.crossref.org/works/10.1234%2Fficticio');
  expect(r.items[0].fields.author).toBe('Ficticio, Autor');
  fetcher.mockRejectedValueOnce(new Error('Red ficticia no disponible'));
  const failed = (
    await t.app.inject({ method: 'POST', url: '/api/library/import/preview', payload: { format: 'doi', doi: '10.1234/fallo' } })
  ).json();
  expect(failed.warning).toContain('Red ficticia');
  expect(failed.items[0].title).toBe('');
  expect(failed.items[0].fields.doi).toBe('10.1234/fallo');
});
it('rechaza destino cambiado, datos inseguros y reutilizar un ID con otra selección', async () => {
  const p = await preview(),
    id = crypto.randomUUID();
  await apply(p, id);
  expect((await apply(p, id, [{ ...p.items[0], action: 'skip' }])).statusCode).toBe(409);
  const unsafe = (await apply(p, crypto.randomUUID(), [{ ...p.items[0], key: 'a}\\input{secreto}', action: 'create' }])).json();
  expect(unsafe.results[0].state).toBe('error');
  expect(
    (
      await t.app.inject({
        method: 'POST',
        url: '/api/library/import',
        payload: { operationId: crypto.randomUUID(), libraryId: 'otro', source: p.source, items: [] },
      })
    ).statusCode,
  ).toBe(409);
});
