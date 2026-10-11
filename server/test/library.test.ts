import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { libraryId } from '../src/captureOperations.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import { multipart, setup, type TestEnv } from './helpers.ts';
import { createManifest, verifyManifest } from '../../scripts/respaldo-manifest.mjs';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { vi.restoreAllMocks(); await t.app.close(); await t.close(); });
const uuid = () => crypto.randomUUID();
const R = (p: string) => path.join(t.cfg.notesDir, 'Recursos', p);
const preview = async () => (await t.app.inject('/api/library/migration')).json();
const apply = (items: any[], id = uuid()) => t.app.inject({ method: 'POST', url: '/api/library/migration', payload: { operationId: id, libraryId: libraryId(t.cfg), items: items.map(({path,baseRev,id,proposalRev}) => ({path,baseRev,id,proposalRev})) } });
const detail = (rel: string) => t.app.inject(`/api/resources/file?path=${encodeURIComponent(rel)}`);

async function legacy(name = 'antiguo.md') {
  const src = '---\r\ntitle: Antiguo\r\nurl: https://example.org/antiguo\r\nattachment: "adjuntos/ficticio.pdf"\r\ncustom: {valor: 3}\r\n# comentario ajeno\r\n---\r\n## Nota uno\r\nTexto.\r\n## Nota dos\r\n[[Sistema/Arquitectura]]\r\n';
  await fs.mkdir(R('adjuntos'), { recursive: true });
  await fs.writeFile(R('adjuntos/ficticio.pdf'), '%PDF-1.4 Ficticio\n');
  await fs.writeFile(R(name), src);
  return src;
}
async function add(id = 'alta-ficticia', names = ['ficticio.pdf', 'figura.svg']) {
  const fd = new FormData();
  for (const [key, value] of Object.entries({ libraryVersion: '1', operationId: id, libraryId: libraryId(t.cfg), title: 'Artículo ficticio', note: 'Notas conservadas', kind: 'article', collections: 'Estado del arte' })) fd.set(key, value);
  for (const name of names) fd.append('files', new Blob([name.endsWith('.pdf') ? '%PDF-1.4 Ficticio' : '<svg xmlns="http://www.w3.org/2000/svg"></svg>']), name);
  return t.app.inject({ method: 'POST', url: '/api/capture', ...await multipart(fd) });
}

it('lee antiguos sin escribir y migra/deshace conservando bytes, comentarios y adjuntos', async () => {
  const src = await legacy();
  const p = await preview();
  expect(p.items).toHaveLength(1);
  expect(await fs.readFile(R('antiguo.md'), 'utf8')).toBe(src);
  await expect(fs.stat(R('.biblioteca.json'))).rejects.toMatchObject({code:'ENOENT'});
  const id = uuid();
  expect((await apply(p.items, id)).json().state).toBe('done');
  const converted = await fs.readFile(R('antiguo.md'), 'utf8');
  expect(converted).toContain('custom: {valor: 3}\r\n# comentario ajeno\r\n');
  expect(parseFrontmatter(converted).body).toBe(parseFrontmatter(src).body);
  const file = (await detail('Recursos/antiguo.md')).json();
  expect(file.item.id).toBe(p.items[0].id);
  expect(file.item.urls).toEqual(['https://example.org/antiguo']);
  expect(file.attachments[0].path).toBe('Recursos/adjuntos/ficticio.pdf');
  expect((await apply(p.items, id)).json().state).toBe('done');
  expect((await t.app.inject({method:'POST',url:`/api/library/migration/${id}/undo`})).json().state).toBe('undone');
  expect(await fs.readFile(R('antiguo.md'), 'utf8')).toBe(src);
  expect(await fs.readFile(R('adjuntos/ficticio.pdf'), 'utf8')).toBe('%PDF-1.4 Ficticio\n');
});

it('una revisión obsoleta o cambio posterior detiene migración y deshacer sin pisar datos', async () => {
  const src = await legacy(), p = await preview();
  await fs.writeFile(R('antiguo.md'), src + 'Cambio externo\r\n');
  expect((await apply(p.items)).statusCode).toBe(409);
  await fs.writeFile(R('antiguo.md'), src);
  const next = await preview(), id = uuid();
  await apply(next.items,id);
  const edited = (await fs.readFile(R('antiguo.md'),'utf8'))+'Edición posterior\r\n';
  await fs.writeFile(R('antiguo.md'),edited);
  expect((await t.app.inject({method:'POST',url:`/api/library/migration/${id}/undo`})).statusCode).toBe(409);
  expect(await fs.readFile(R('antiguo.md'),'utf8')).toBe(edited);
});

it('recupera migración interrumpida después de publicar y antes de guardar su avance', async () => {
  await legacy('primero.md'); await legacy('segundo.md');
  const p = await preview(), id = uuid(), rename = fs.rename.bind(fs);
  vi.spyOn(fs,'rename').mockImplementation(async (from,to) => {
    if (String(to).endsWith(`${id}.json`)) throw Object.assign(new Error('Interrupción ficticia'),{code:'EIO'});
    return rename(from,to);
  });
  expect((await apply(p.items,id)).statusCode).toBe(500);
  vi.restoreAllMocks();
  const before = p.items.map((item:any)=>item.id);
  await t.app.close();
  const rebuilt = await buildApp(t.cfg,{watch:false,serveWeb:false}); t.app=rebuilt.app; t.ctx=rebuilt.ctx;
  const result = await preview();
  expect(result.items).toHaveLength(0);
  expect(result.operations[0]).toMatchObject({id,state:'done',applied:2});
  const ids = (await t.app.inject('/api/resources')).json().items.map((item:any)=>item.id);
  expect(new Set(ids)).toEqual(new Set(before));
});

it('deshacer interrumpido se reanuda sin perder el original ni repetir fichas', async () => {
  const original=await legacy('uno.md'); await legacy('dos.md');
  const p=await preview(), id=uuid(); await apply(p.items,id);
  const rename=fs.rename.bind(fs); let failed=false;
  vi.spyOn(fs,'rename').mockImplementation(async(from,to)=>{
    if (String(to).endsWith('uno.md') && !failed) { failed=true; throw Object.assign(new Error('Interrupción ficticia'),{code:'EIO'}); }
    return rename(from,to);
  });
  expect((await t.app.inject({method:'POST',url:`/api/library/migration/${id}/undo`})).statusCode).toBe(500);
  vi.restoreAllMocks();
  expect((await t.app.inject({method:'POST',url:`/api/library/migration/${id}/retry`})).json().state).toBe('undone');
  expect(await fs.readFile(R('uno.md'),'utf8')).toBe(original);
  expect(await fs.readFile(R('dos.md'),'utf8')).toBe(original);
});

it('varios adjuntos, URL, referencia y notas conviven; mover conserva ID y enlaces', async () => {
  const result = await add(); expect(result.statusCode).toBe(200);
  const file=(await detail(result.json().path)).json();
  expect(file.attachments).toHaveLength(2);
  const bibliography={authority:'library',entryType:'article',fields:{author:'Autor ficticio',year:'2026',custom:'Conservar'}};
  const updated=await t.app.inject({method:'PATCH',url:'/api/resources',payload:{path:file.path,baseRev:file.rev,urls:['https://example.org/articulo','https://example.org/datos'],bibliography}});
  expect(updated.statusCode).toBe(200);
  await fs.mkdir(R('archivados'));
  const target='Recursos/archivados/articulo.md';
  expect((await t.app.inject({method:'POST',url:'/api/move',payload:{root:'notes',from:file.path,to:target}})).statusCode).toBe(200);
  const moved=(await detail(target)).json();
  expect(moved.item.id).toBe(file.item.id);
  expect(moved.item.bibliography).toEqual(bibliography);
  expect(moved.attachments.map((att:any)=>att.path)).toEqual(file.attachments.map((att:any)=>att.path));
  expect((await add()).json().path).toBe(target); // El recibo encuentra la ficha por ID.
});

it('un fallo de adjunto conserva el lote para reenvío y no publica una ficha incompleta', async () => {
  const rename=fs.rename.bind(fs); let failed=false;
  vi.spyOn(fs,'rename').mockImplementation(async(from,to)=>{
    if (String(to).endsWith('attachment-1') && !failed) { failed=true; throw Object.assign(new Error('Interrupción ficticia'),{code:'EIO'}); }
    return rename(from,to);
  });
  expect((await add()).statusCode).toBe(500);
  vi.restoreAllMocks();
  expect((await t.app.inject('/api/resources')).json().items).toHaveLength(0);
  const retry=await add(); expect(retry.statusCode).toBe(200);
  expect((await detail(retry.json().path)).json().attachments).toHaveLength(2);
  expect((await t.app.inject('/api/resources')).json().items).toHaveLength(1);
  expect((await add()).json()).toEqual(retry.json());
});

it('identidades duplicadas o versión desconocida avisan y bloquean escrituras', async () => {
  const created=(await add()).json(), file=(await detail(created.path)).json();
  await fs.copyFile(path.join(t.cfg.notesDir,created.path),R('copia.md'));
  const list=(await t.app.inject('/api/resources')).json();
  expect(list.warnings).toHaveLength(2);
  expect((await t.app.inject({method:'PATCH',url:'/api/resources',payload:{path:file.path,baseRev:file.rev,title:'No pisar'}})).statusCode).toBe(409);
  await fs.rm(R('copia.md'));
  await fs.writeFile(path.join(t.cfg.notesDir,created.path),file.content.replace('version: 1','version: 99'));
  const unknown=(await detail(created.path)).json();
  expect(unknown.item.libraryError).toContain('Versión');
  expect((await t.app.inject({method:'PATCH',url:'/api/resources',payload:{path:file.path,baseRev:unknown.rev,title:'No pisar'}})).statusCode).toBe(422);
});

it('rechaza rutas inseguras, autoridades divergentes y colisiones de migración', async () => {
  const created=(await add()).json(), file=(await detail(created.path)).json();
  const patch=(changes:any)=>t.app.inject({method:'PATCH',url:'/api/resources',payload:{path:file.path,baseRev:file.rev,...changes}});
  expect((await patch({attachments:['../../../fuera.pdf']})).statusCode).toBe(400);
  expect((await patch({urls:['javascript:alert(1)']})).statusCode).toBe(400);
  expect((await patch({bibliography:{authority:'library',entryType:'article',fields:{title:'Duplicado'}}})).statusCode).toBe(400);
  expect((await patch({bibliography:{authority:'manual',path:'../fuera.bib',key:'x'}})).statusCode).toBe(400);
  expect((await apply([{path:'../fuera.md',baseRev:file.rev,id:uuid()}])).statusCode).toBe(400);
  expect((await detail(created.path)).json().content).toBe(file.content);
});

it('la autoridad manual permanece en el bib y no admite una copia editable de campos', async () => {
  const created=(await add()).json(), file=(await detail(created.path)).json();
  const bib='@book{ficticio,title={Libro manual},year={2026}}\n';
  await fs.writeFile(path.join(t.cfg.memoriaDir,'manual.bib'),bib);
  expect((await t.app.inject({method:'PATCH',url:'/api/resources',payload:{path:file.path,baseRev:file.rev,bibliography:{authority:'manual',path:'manual.bib',key:'ficticio'}}})).statusCode).toBe(200);
  const next=(await detail(file.path)).json();
  expect((await t.app.inject({method:'PATCH',url:'/api/resources',payload:{path:file.path,baseRev:next.rev,bibliography:{authority:'library',entryType:'book',fields:{}}}})).statusCode).toBe(400);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir,'manual.bib'),'utf8')).toBe(bib);
});

it('una identidad corrupta conserva lectura y bloquea altas en vez de asignar otro destino', async () => {
  await legacy(); await fs.writeFile(R('.biblioteca.json'),'{roto');
  await t.app.close(); const built=await buildApp(t.cfg,{serveWeb:false}); t.app=built.app; t.ctx=built.ctx;
  const status=(await t.app.inject('/api/status')).json();
  expect(status.libraryId).toBeUndefined(); expect(status.libraryError).toContain('identidad');
  expect((await t.app.inject('/api/resources')).statusCode).toBe(200);
  expect((await t.app.inject({method:'POST',url:'/api/capture',payload:{libraryVersion:1,title:'No publicar'}})).statusCode).toBe(422);
});

it('restaurar biblioteca y registros conserva UUID, adjuntos, recibos e identidad del destino', async () => {
  await legacy(); await apply((await preview()).items);
  const created=(await add()).json(), original=(await detail(created.path)).json(), oldId=libraryId(t.cfg);
  await t.app.close();
  const restored=path.join(t.dir,'biblioteca-restaurada'); await fs.mkdir(restored);
  for (const [name,source] of Object.entries({notes:t.cfg.notesDir,data:path.dirname(t.cfg.buildDir)})) {
    const manifest=path.join(restored,`${name}.json`);
    await createManifest(source,manifest);
    await fs.cp(source,path.join(restored,name),{recursive:true,force:false,errorOnExist:true});
    await verifyManifest(path.join(restored,name),manifest);
  }
  const cfg={...t.cfg,notesDir:path.join(restored,'notes'),buildDir:path.join(restored,'data/builds'),historyDir:path.join(restored,'data/history'),settingsFile:path.join(restored,'data/settings.json')};
  const next=await buildApp(cfg,{serveWeb:false});
  try {
    expect(libraryId(cfg)).toBe(oldId);
    const file=(await next.app.inject(`/api/resources/file?path=${encodeURIComponent(created.path)}`)).json();
    expect(file.item.id).toBe(original.item.id);
    for (const att of file.attachments) expect(await fs.readFile(path.join(cfg.notesDir,att.path))).toEqual(await fs.readFile(path.join(t.cfg.notesDir,att.path)));
    expect((await next.app.inject(`/api/capture/operation?operationId=alta-ficticia&libraryId=${oldId}`)).json().state).toBe('done');
    expect((await next.app.inject('/api/library/migration')).json().operations[0].state).toBe('done');
  } finally { await next.app.close(); }
  await verifyManifest(t.cfg.notesDir,path.join(restored,'notes.json'));
  await verifyManifest(path.dirname(t.cfg.buildDir),path.join(restored,'data.json'));
});

it('deshacer una ficha trasladada detiene la operación con conflicto recuperable', async () => {
  await legacy(); const p=await preview(), id=uuid(); await apply(p.items,id);
  await fs.rename(R('antiguo.md'),R('trasladado.md'));
  const before=await fs.readFile(R('trasladado.md'));
  const result=await t.app.inject({method:'POST',url:`/api/library/migration/${id}/undo`});
  expect(result.statusCode).toBe(409);
  expect(result.json().error).toContain('nueva ubicación');
  expect(await fs.readFile(R('trasladado.md'))).toEqual(before);
});
