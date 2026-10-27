import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { setup, multipart, type TestEnv } from './helpers.ts';
import { fontFixture } from '../../test/font-fixture.ts';
import { inspeccionarFuente, importarFuentes, leerFuentes } from '../src/fuentes.ts';
import { applyChanges } from '../src/datos.ts';
import { computeSourceRev } from '../src/compile.ts';
import { rev } from '../src/fsutil.ts';
import { muestraEstilo, guardarTransaccion, aplicarTransaccion, proposalFolder } from '../src/styleProposals.ts';
import { readPrivate, privateJson } from '../src/assistantChanges.ts';
import { extraerPlantilla } from '../src/plantilla-propia.ts';
import { generarPortadas, validarPortadas } from '../src/portadas.ts';
import { portadasIniciales } from '../../shared/portadas.ts';
let t: TestEnv;
afterEach(async () => { await t?.close(); });
it('comparte capacidades, guarda valores con revisión e historial y rechaza longitudes fuera de rango', async () => {
  t = await setup();
  const style = (await t.app.inject('/api/memoria/estilo')).json();
  expect(style.compatible).toBe(true); expect(style.capacidades.some((c: any) => c.key === 'alineacionParrafo')).toBe(true);
  const save = (valores: object, baseRev = style.baseRev) => t.app.inject({method:'PUT',url:'/api/memoria/estilo',payload:{valores,baseRev}});
  expect((await save({sangriaParrafo:'2em', espacioLista:'4pt', alineacionSeccion:'centro'})).statusCode).toBe(200);
  const current = await fs.readFile(path.join(t.cfg.memoriaDir,'estilo/institucion.tex'),'utf8');
  expect(current).toContain('\\sangriaParrafo{2em}');
  expect((await save({espacioLista:'3pt'})).statusCode).toBe(409);
  const latest = (await t.app.inject('/api/memoria/estilo')).json();
  for (const value of ['-1pt','100pt','2mm','\\input{x}']) expect((await save({espacioLista:value},latest.baseRev)).statusCode).toBe(400);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir,'estilo/institucion.tex'),'utf8')).toBe(current);
});
it('valida SFNT y variantes, limita tamaños y rechaza tablas truncadas', () => {
  expect(inspeccionarFuente(fontFixture())).toMatchObject({nombre:'Familia ficticia',variante:'regular'});
  expect(inspeccionarFuente(fontFixture('Otra','Bold Italic')).variante).toBe('negritaCursiva');
  for (const b of [Buffer.from('font'), fontFixture().subarray(0,80), Buffer.alloc(11*1024*1024)]) expect(() => inspeccionarFuente(b)).toThrow();
  const bad=fontFixture(); bad.writeUInt32BE(0xffffffff,20); expect(() => inspeccionarFuente(bad)).toThrow();
});
it('importa fuentes con revisión, avisa de variantes ausentes y conserva la regular sin simular', async () => {
  t=await setup(); const r=await importarFuentes(t.ctx,[fontFixture()],null), family=r.registro.familias[0];
  expect(r.avisos[0]).toContain('sin simular');
  const tex=await fs.readFile(path.join(t.cfg.memoriaDir,'estilo/fuentes.tex'),'utf8');
  expect(tex).toContain('BoldFont='+family.archivos.regular); expect(tex).not.toMatch(/FakeBold|FakeSlant/);
  await expect(importarFuentes(t.ctx,[fontFixture('Otra')],null)).rejects.toMatchObject({statusCode:409});
  const style=(await t.app.inject('/api/memoria/estilo')).json();
  expect((await t.app.inject({method:'PUT',url:'/api/memoria/estilo',payload:{baseRev:style.baseRev,valores:{fuenteTexto:family.id}}})).statusCode).toBe(200);
  const latest=(await t.app.inject('/api/memoria/estilo')).json();
  expect((await t.app.inject({method:'PUT',url:'/api/memoria/estilo',payload:{baseRev:latest.baseRev,valores:{fuenteLeyendaFigura:family.id}}})).statusCode).toBe(400);
  expect((await t.app.inject({method:'PUT',url:'/api/memoria/estilo',payload:{baseRev:latest.baseRev,valores:{fuenteTexto:'propia-aaaaaaaaaaaaaaaa'}}})).statusCode).toBe(400);
  await fs.appendFile(path.join(t.cfg.memoriaDir,'estilo/fuentes.tex'),'% Cambio propio\n');
  await expect(leerFuentes(t.cfg)).rejects.toMatchObject({statusCode:409});
});
it('valida alineaciones, separación e imágenes de portada sin admitir rutas externas', async () => {
  const cfg=portadasIniciales(); cfg.interior=[{id:'firma',tipo:'firma',zona:'inferior',alineacion:'derecha',espacio:8},{id:'extra',tipo:'imagen',zona:'superior',recurso:'estilo/imagenes/aaaaaaaaaaaaaaaa.png'}];
  const tex=generarPortadas(cfg); expect(tex).toContain('\\raggedleft');expect(tex).toContain('vspace{8mm}'); expect(tex).toContain('includegraphics');
  for(const recurso of ['../secreto.png','/tmp/logo.png','estilo/imagenes/enlace.png']) expect(()=>validarPortadas({...cfg,interior:[{id:'extra',tipo:'imagen',zona:'superior',recurso}]})).toThrow();
  t=await setup(); const form=new FormData(); form.append('baseRev','null');form.append('file',new Blob([new Uint8Array([0x89,0x50,0x4e,0x47,13,10,26,10,0])]),'imagen.png');
  const r=await t.app.inject({method:'POST',url:'/api/memoria/portadas/imagen',...await multipart(form)});expect(r.statusCode,r.body).toBe(200);expect(r.json().recurso).toMatch(/^estilo\/imagenes\/[a-f0-9]{16}\.png$/);
});
async function transaction() {
  const id=randomUUID(), file='estilo/institucion.tex', before=await fs.readFile(path.join(t.cfg.memoriaDir,file));
  const after=applyChanges(before.toString(),'institucion',{espacioLista:'4pt'});
  await fs.mkdir(proposalFolder(t.cfg,id),{recursive:true});
  await privateJson(path.join(proposalFolder(t.cfg,id),'preview.json'),{ok:true});
  await guardarTransaccion(t.cfg,id,await computeSourceRev(t.cfg),new Map([[file,after]]));
  const record=await readPrivate(path.join(proposalFolder(t.cfg,id),'transaction.json'));
  return {id,file,before,after,baseRev:rev(JSON.stringify(record))};
}
it('aplica y deshace una propuesta con historial; una revisión vieja o una edición nueva bloquea la escritura', async () => {
  t=await setup();const tr=await transaction();
  await expect(aplicarTransaccion(t.ctx,tr.id,'aaaaaaaaaaaaaaaa')).rejects.toMatchObject({statusCode:409});
  const applied=await aplicarTransaccion(t.ctx,tr.id,tr.baseRev);expect(await fs.readFile(path.join(t.cfg.memoriaDir,tr.file),'utf8')).toBe(tr.after);
  await fs.appendFile(path.join(t.cfg.memoriaDir,tr.file),'% Edición posterior');
  await expect(aplicarTransaccion(t.ctx,tr.id,applied.baseRev,true)).rejects.toMatchObject({statusCode:409});
  await fs.writeFile(path.join(t.cfg.memoriaDir,tr.file),tr.after);await aplicarTransaccion(t.ctx,tr.id,applied.baseRev,true);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir,tr.file))).toEqual(tr.before);
});
it('bloquea propuestas si cambió cualquier fuente de la memoria', async () => {
  t=await setup(); const tr=await transaction(); await fs.appendFile(path.join(t.cfg.memoriaDir,'datos.tex'),'% cambio\n');
  await expect(aplicarTransaccion(t.ctx,tr.id,tr.baseRev)).rejects.toMatchObject({statusCode:409});
  expect(await fs.readFile(path.join(t.cfg.memoriaDir,tr.file))).toEqual(tr.before);
});
it('una plantilla personal exporta estructura vacía y recursos; excluye identidad, textos y bibliografía', async () => {
  t=await setup();
  const datos=path.join(t.cfg.memoriaDir,'datos.tex'); await fs.writeFile(datos,applyChanges(await fs.readFile(datos,'utf8'),'datos',{autor:'Persona privada única',titulo:'Título privado único',fechaMes:'Mes privado',tutor:'Tutor privado'}));
  const institution=path.join(t.cfg.memoriaDir,'estilo/institucion.tex');await fs.appendFile(institution,'\n\\pieCentroTexto{Pie privado único}\n\\fuenteTexto{schola}\n');
  const cover=portadasIniciales();cover.interior.push({id:'texto',tipo:'texto',zona:'inferior',texto:'Correo privado único'});await fs.writeFile(path.join(t.cfg.memoriaDir,'estilo/portadas.tex'),generarPortadas(cover));
  await importarFuentes(t.ctx,[fontFixture()],null);
  const source=await computeSourceRev(t.cfg);
  const saved=await t.app.inject({method:'POST',url:'/api/templates/personal',payload:{nombre:'Mi estilo',baseRev:source}});expect(saved.statusCode,saved.body).toBe(200);
  const id=saved.json().id; expect((await t.app.inject('/api/templates/personal/'+id)).json().config.institucion.fuenteTexto).toBe('schola');
  const exported=await t.app.inject('/api/templates/personal/'+id+'/export');expect(exported.statusCode,exported.body).toBe(200);
  const dir=path.join(t.dir,'descomprimida');await fs.mkdir(dir);const root=await extraerPlantilla(exported.rawPayload,dir);
  const all=await fs.readFile(path.join(root,'datos.tex'),'utf8')+await fs.readFile(path.join(root,'estilo/portadas.tex'),'utf8')+await fs.readFile(path.join(root,'estilo/institucion.tex'),'utf8');
  expect(all).not.toMatch(/Persona privada|Título privado|Mes privado|Tutor privado|Correo privado|Pie privado/);
  expect(await fs.readFile(path.join(root,'bibliografia.bib'),'utf8')).not.toMatch(/@book/);
  expect(await fs.readFile(path.join(root,'estilo/LICENCIAS-FUENTES.txt'),'utf8')).toContain('Licencia ficticia');
  const created=await t.app.inject({method:'POST',url:'/api/templates/personal/'+id+'/create',payload:{dir:path.join(t.dir,'nueva-personal'),baseRev:saved.json().rev}});expect(created.statusCode,created.body).toBe(200);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir,'datos.tex'),'utf8')).not.toContain('Persona privada');
});
it('deshace también una aplicación interrumpida registrada antes de escribir', async () => {
  t=await setup(); const tr=await transaction(), recordFile=path.join(proposalFolder(t.cfg,tr.id),'transaction.json');
  const record=await readPrivate(recordFile);record.applied=true;await privateJson(recordFile,record);
  // Simula cierre antes de la primera escritura: las fuentes siguen intactas.
  const result=await aplicarTransaccion(t.ctx,tr.id,rev(JSON.stringify(record)),true);expect(result.undone).toBe(true);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir,tr.file))).toEqual(tr.before);
});
it('no permite que archivos de fuente huérfanos eludan la cuota y detecta fuentes alteradas', async () => {
  t=await setup(); const current=await importarFuentes(t.ctx,[fontFixture()],null), dir=path.join(t.cfg.memoriaDir,'estilo/fuentes');
  for(let i=0;i<5;i++) {const file=path.join(dir,String(i).padStart(16,'0')+'.ttf');await fs.writeFile(file,'');await fs.truncate(file,10*1024*1024);}
  await expect(importarFuentes(t.ctx,[fontFixture('Otra')],current.baseRev)).rejects.toMatchObject({statusCode:413});
  const file=Object.values(current.registro.familias[0].archivos)[0]!;await fs.appendFile(path.join(dir,file),'Cambio ajeno');
  await expect(leerFuentes(t.cfg)).rejects.toMatchObject({statusCode:409});
});

it('la comparación rellena la portada con ejemplos sin escribir datos inventados en la configuración', () => {
  const config={datos:{titulo:'',autor:'',tutor:''},institucion:{},apartados:{portada:true,portadaInterior:true},capitulos:['Introducción']};
  const before=structuredClone(config),sample=muestraEstilo(config);
  expect(sample.get('datos.tex')!.toString()).toContain('Título del documento de ejemplo');
  expect(sample.get('datos.tex')!.toString()).toContain('Autor/a de ejemplo');
  expect(config).toEqual(before);
});
