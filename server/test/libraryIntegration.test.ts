import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setup, multipart, type TestEnv } from './helpers.ts';
import { libraryId } from '../src/libraryIdentity.ts';
import { instanceId } from '../src/settings.ts';
import { LIBRARY_BIB, LIBRARY_MANIFEST } from '../src/libraryIntegration.ts';
import { namespaceBibDocument, parseBibDocument, sourceHash } from '../src/bibliography.ts';

let t: TestEnv;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});
const uuid = () => crypto.randomUUID();
const binding = () => ({ libraryId: libraryId(t.cfg), instanceId: instanceId(t.cfg) });
const mem = (p: string) => path.join(t.cfg.memoriaDir, p);
async function reference(
  text = '@string{rev={Revista ficticia}}\n@article{Prueba2026,title={Referencia {API}},author={Ficticio, Ana},year=2026,journal=rev,custom={Conservar}}',
) {
  const p = (await t.app.inject({ method: 'POST', url: '/api/library/import/preview', payload: { format: 'bibtex', text } })).json();
  const result = (
    await t.app.inject({
      method: 'POST',
      url: '/api/library/import',
      payload: {
        operationId: uuid(),
        libraryId: libraryId(t.cfg),
        source: p.source,
        items: p.items.map((i: any) => ({ ...i, action: 'create' })),
      },
    })
  ).json();
  return (
    await t.app.inject(`/api/resources/file?path=${encodeURIComponent(result.results.find((r: any) => r.state === 'done').path)}`)
  ).json();
}
const preview = (file: any, extra: any = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/api/library/integration/preview',
    payload: { ...binding(), operationId: uuid(), resourceId: file.item.id, baseRev: file.rev, kind: 'reference', ...extra },
  });
const apply = (p: any) =>
  t.app.inject({
    method: 'POST',
    url: '/api/library/integration/apply',
    payload: { ...binding(), operationId: p.operationId, revisions: p.files.map((f: any) => ({ path: f.path, baseRev: f.baseRev })) },
  });
async function combine(file: any, text: string) {
  const p = (await t.app.inject({ method: 'POST', url: '/api/library/import/preview', payload: { format: 'bibtex', text } })).json();
  const result = await t.app.inject({
    method: 'POST',
    url: '/api/library/import',
    payload: {
      operationId: uuid(),
      libraryId: libraryId(t.cfg),
      source: p.source,
      items: [{ ...p.items[0], action: 'merge', targetId: file.item.id, baseRev: file.rev }],
    },
  });
  expect(result.json().results[0].state).toBe('done');
  return (await t.app.inject(`/api/resources/file?path=${encodeURIComponent(file.path)}`)).json();
}

it('la vista previa no cambia la memoria; aplicar incorpora bibliografía portable y conserva los .bib manuales', async () => {
  const file = await reference(),
    mainBefore = await fs.readFile(mem('tfg.tex')),
    manualBefore = await fs.readFile(mem('bibliografia.bib'));
  const p = (await preview(file)).json();
  expect(p.result.key).toBe('Prueba2026');
  expect(p.result.snippet).toBe('\\cite{Prueba2026}');
  expect(await fs.readFile(mem('tfg.tex'))).toEqual(mainBefore);
  await expect(fs.stat(mem(LIBRARY_BIB))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await apply(p)).statusCode).toBe(200);
  expect((await apply(p)).statusCode).toBe(200);
  const bib = await fs.readFile(mem(LIBRARY_BIB), 'utf8');
  expect(bib).toContain('custom={Conservar}');
  expect(bib).toContain('@string{et');
  expect(parseBibDocument(bib).entries[0].fields.journal).toBe('Revista ficticia');
  expect(await fs.readFile(mem('bibliografia.bib'))).toEqual(manualBefore);
  expect((await fs.readFile(mem('tfg.tex'), 'utf8')).match(/\\addbibresource\{biblioteca\/referencias\.bib\}/g)).toHaveLength(1);
  await fs.rm(path.join(t.cfg.notesDir, 'Recursos'), { recursive: true, force: true });
  expect(await fs.readFile(mem(LIBRARY_BIB), 'utf8')).toBe(bib);
});
it('los originales con macros iguales conservan significados distintos al exportarse juntos', async () => {
  const a = await reference(),
    b = await reference('@string{rev={Otra revista}}\n@article{Otro2026,title={Otro artículo},author={Otro, Autor},year=2026,journal=rev}');
  await apply((await preview(a)).json());
  await apply((await preview(b)).json());
  const parsed = parseBibDocument(await fs.readFile(mem(LIBRARY_BIB), 'utf8'));
  expect(parsed.entries.map((e) => e.fields.journal).sort()).toEqual(['Otra revista', 'Revista ficticia']);
  expect(parsed.entries.some((e) => e.error)).toBe(false);
});
it('incluye xdata y referencias auxiliares con claves privadas sin perder comentarios', async () => {
  const file = await reference(
    '% conservar comentario\n@article{Hijo,title={Hijo},author={Ficticio, Ana},xdata={Datos}}\n@xdata{Datos,year=2026,journal={Revista ficticia}}',
  );
  const p = (await preview(file)).json();
  expect(p.result.key).toBe('Hijo');
  await apply(p);
  const bib = await fs.readFile(mem(LIBRARY_BIB), 'utf8'),
    parsed = parseBibDocument(bib);
  expect(bib).toContain('% conservar comentario');
  expect(parsed.entries).toHaveLength(2);
  expect(parsed.entries.find((e) => e.key === 'Hijo')?.fields.xdata).toMatch(/^et[0-9a-f_]+$/);
});
it.each(['crossref', 'xref', 'xdata', 'entryset', 'related'])('combinar conserva el original del campo %s heredado aunque haya un padre homónimo nuevo', async (association) => {
  const file = await reference(
    `@string{editorial={Editorial original}}\n@incollection{Hijo,title={Anterior},author={Ficticio, Ana},${association}={Padre}}\n@book{Padre,title={Padre original},publisher=editorial}`,
  );
  const combined = await combine(
    file,
    '@incollection{Actualizado,title={Revisado},author={Ficticio, Ana}}\n@book{Padre,title={Padre homónimo nuevo},publisher={Otra editorial}}',
  );
  const response = await preview(combined);
  expect(response.statusCode).toBe(200);
  expect((await apply(response.json())).statusCode).toBe(200);
  const parsed = parseBibDocument(await fs.readFile(mem(LIBRARY_BIB), 'utf8')),
    child = parsed.entries.find((e) => e.key === 'Hijo'),
    parent = parsed.entries.find((e) => e.key === child?.fields[association]);
  expect(parent?.title).toBe('Padre original');
  expect(parent?.fields.publisher).toBe('Editorial original');
  expect(parsed.entries.some((e) => e.error)).toBe(false);
});
it('una asociación heredada sin padre en el nuevo original sigue exportando y actualizando la cita', async () => {
  const file = await reference('@incollection{Hijo,title={Anterior},author={Ficticio, Ana},crossref={Padre}}\n@book{Padre,title={Padre original}}');
  expect((await apply((await preview(file)).json())).statusCode).toBe(200);
  const combined = await combine(file, '@incollection{Actualizado,title={Revisado},author={Ficticio, Ana}}'),
    response = await preview(combined);
  expect(response.statusCode).toBe(200);
  expect((await apply(response.json())).statusCode).toBe(200);
  const output = await fs.readFile(mem(LIBRARY_BIB), 'utf8');
  expect(output).toContain('Padre original');
  expect(parseBibDocument(output).entries.find((e) => e.key === 'Hijo')?.title).toBe('Revisado');
});
it('varias combinaciones usan la asociación del último original que aportó el campo', async () => {
  const first = await reference('@incollection{Hijo,title={Primero},author={Ficticio, Ana},crossref={Padre}}\n@book{Padre,title={Primer padre}}'),
    second = await combine(first, '@incollection{Otro,title={Segundo},author={Ficticio, Ana},crossref={Padre}}\n@book{Padre,title={Segundo padre}}'),
    third = await combine(second, '@incollection{Actualizado,title={Tercero},author={Ficticio, Ana}}');
  const response = await preview(third);
  expect(response.statusCode).toBe(200);
  expect((await apply(response.json())).statusCode).toBe(200);
  const parsed = parseBibDocument(await fs.readFile(mem(LIBRARY_BIB), 'utf8'));
  expect(parsed.entries.map((e) => e.title)).toContain('Segundo padre');
  expect(parsed.entries.map((e) => e.title)).not.toContain('Primer padre');
});
it('una asociación editada ambigua se rechaza antes de publicar y una inequívoca conserva su original', async () => {
  const first = await reference('@incollection{Hijo,title={Primero},author={Ficticio, Ana}}\n@book{Padre,title={Primer padre}}\n@book{Unico,title={Padre único}}'),
    combined = await combine(first, '@incollection{Otro,title={Segundo},author={Ficticio, Ana}}\n@book{Padre,title={Segundo padre}}');
  const edit = async (file: any, crossref: string) => {
    expect((await t.app.inject({
      method: 'PATCH', url: '/api/resources',
      payload: { path: file.path, baseRev: file.rev, bibliography: { ...file.item.bibliography, fields: { crossref } } },
    })).statusCode).toBe(200);
    return (await t.app.inject(`/api/resources/file?path=${encodeURIComponent(file.path)}`)).json();
  };
  const ambiguous = await edit(combined, 'Padre'),
    rejected = await preview(ambiguous);
  expect(rejected.statusCode).toBe(400);
  expect(rejected.json().error).toContain('ambigua');
  await expect(fs.stat(mem(LIBRARY_BIB))).rejects.toMatchObject({ code: 'ENOENT' });
  const unique = await edit(ambiguous, 'Unico'),
    response = await preview(unique);
  expect(response.statusCode).toBe(200);
  expect((await apply(response.json())).statusCode).toBe(200);
  expect(await fs.readFile(mem(LIBRARY_BIB), 'utf8')).toContain('Padre único');
});
it('respeta el borrador del principal y detiene una revisión obsoleta sin publicar ninguna salida', async () => {
  const file = await reference(),
    main = (await t.app.inject('/api/file?root=memoria&path=tfg.tex')).json();
  const p = (await preview(file, { mainDraft: { content: main.content + '\nBorrador ficticio', baseRev: main.rev } })).json();
  expect(p.result.mainEdit.after).toContain('Borrador ficticio');
  expect(p.files.some((f: any) => f.path === 'tfg.tex')).toBe(false);
  await fs.mkdir(mem('biblioteca'));
  await fs.writeFile(mem(LIBRARY_MANIFEST), 'Cambio externo');
  expect((await apply(p)).statusCode).toBe(409);
  await expect(fs.stat(mem(LIBRARY_BIB))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(mem('tfg.tex'), 'utf8')).toBe(main.content);
});
it('recupera una publicación parcial con el mismo registro sin sobrescribir cambios posteriores', async () => {
  const file = await reference(),
    p = (await preview(file)).json(),
    rename = fs.rename.bind(fs);
  let failed = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to).endsWith('tfg.tex') && !failed) {
      failed = true;
      throw new Error('Fallo ficticio de publicación');
    }
    return rename(from, to);
  });
  expect((await apply(p)).statusCode).toBe(500);
  vi.restoreAllMocks();
  const existing = await fs.readFile(mem(LIBRARY_BIB), 'utf8');
  expect((await apply(p)).statusCode).toBe(200);
  expect(await fs.readFile(mem(LIBRARY_BIB), 'utf8')).toBe(existing);
});
it('copia una imagen dentro de la memoria, detecta usos y conserva la copia después de eliminar el recurso', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGPwd3tKU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAE0y6EwonOyyAAAAAElFTkSuQmCC',
    'base64',
  );
  const fd = new FormData();
  fd.set('libraryVersion', '1');
  fd.set('title', 'Imagen ficticia');
  fd.append('files', new Blob([png]), 'figura.png');
  const created = (await t.app.inject({ method: 'POST', url: '/api/capture', ...(await multipart(fd)) })).json(),
    file = (await t.app.inject(`/api/resources/file?path=${encodeURIComponent(created.path)}`)).json();
  const p = (
    await preview(file, {
      kind: 'figure',
      attachmentPath: file.attachments[0].path,
      caption: 'Figura & prueba',
      credit: 'Autor ficticio',
      label: 'fig:prueba',
      width: 80,
    })
  ).json();
  expect(p.result.snippet).toContain('Figura \\& prueba');
  expect((await apply(p)).statusCode).toBe(200);
  expect(await fs.readFile(mem(p.result.figurePath))).toEqual(png);
  await fs.appendFile(mem('tfg.tex'), '\n' + p.result.snippet + '\n');
  const uses = (await t.app.inject(`/api/library/uses?id=${file.item.id}`)).json();
  expect(uses.uses[0]).toMatchObject({ kind: 'figure', file: 'tfg.tex' });
  expect(uses.figures[0].hash).toBe(sourceHash(png));
  await t.app.inject({ method: 'DELETE', url: `/api/file?root=notes&path=${encodeURIComponent(created.path)}` });
  expect(await fs.readFile(mem(p.result.figurePath))).toEqual(png);
});
it('no sobrescribe un .bib ajeno ni usa un destino cambiado', async () => {
  const file = await reference();
  await fs.mkdir(mem('biblioteca'));
  await fs.writeFile(mem(LIBRARY_BIB), 'Archivo manual intacto');
  expect((await preview(file)).statusCode).toBe(409);
  expect(await fs.readFile(mem(LIBRARY_BIB), 'utf8')).toBe('Archivo manual intacto');
  const changed = await preview(file, { instanceId: 'otro' });
  expect(changed.statusCode).toBe(409);
});
it('una colisión nueva en un .bib manual impide cambiar silenciosamente la cita integrada', async () => {
  const file = await reference(),
    p = (await preview(file)).json();
  await apply(p);
  await fs.appendFile(mem('bibliografia.bib'), '\n@book{Prueba2026,title={Manual},author={Otro, Autor},year=2026}\n');
  expect((await preview(file)).statusCode).toBe(409);
  expect(await fs.readFile(mem(LIBRARY_BIB), 'utf8')).toContain('Prueba2026');
});
it('la Biblioteca sigue operativa sin una carpeta de memoria configurada', async () => {
  const file = await reference();
  await fs.rm(t.cfg.memoriaDir, { recursive: true, force: true });
  const response = await t.app.inject(`/api/library/uses?id=${file.item.id}`);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ available: false, uses: [] });
});
it('el namespace preserva expresiones, campos y cadenas con comillas protegidas', () => {
  const source = '@string{rev={Revista}}\n@article{K,title="Una {\"cita\"} protegida",journal=rev # { de prueba}}';
  const doc = namespaceBibDocument(source, 'prueba_');
  expect(doc.entries[0].fields.journal).toBe('Revista de prueba');
  expect(doc.entries[0].error).toBeUndefined();
  expect(doc.text).toContain('journal=prueba_rev # { de prueba}');
  expect(doc.text).toContain('title="Una {\"cita\"} protegida"');
});
it('editar un título BibTeX conserva comandos y agrupación LaTeX sin doble escape', async () => {
  const file = await reference('@article{Tex,title={Un \\emph{ejemplo}},author={Ficticio, Ana},year=2026,journal={Revista}}');
  const changed = await t.app.inject({
    method: 'PATCH',
    url: '/api/resources',
    payload: { path: file.path, baseRev: file.rev, title: 'Un \\emph{ejemplo} & ampliación' },
  });
  expect(changed.statusCode).toBe(200);
  const fresh = (await t.app.inject(`/api/resources/file?path=${encodeURIComponent(file.path)}`)).json();
  const p = (await preview(fresh)).json();
  expect((await apply(p)).statusCode).toBe(200);
  const output = await fs.readFile(mem(LIBRARY_BIB), 'utf8');
  expect(output).toContain('\\emph{ejemplo} \\& ampliación');
  expect(output).not.toContain('\\textbackslash');
});
