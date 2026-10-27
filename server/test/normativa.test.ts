import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { setup, multipart, type TestEnv } from './helpers.ts';
import { assistantRoutes, type AssistantProvider } from '../src/assistant.ts';
import { HERRAMIENTA_NORMATIVA, interpretarNormativa } from '../src/normativa.ts';
import { normativaFixture } from '../../test/normativa-fixture.ts';
import * as estilo from '../src/styleProposals.ts';
import * as records from '../src/assistantChanges.ts';
import { parseDatos } from '../src/datos.ts';

let env: TestEnv | undefined;
afterEach(async () => { vi.restoreAllMocks(); await env?.close(); env = undefined; });
const result = (raw = normativaFixture()) => [{ type: 'function_call', name: 'proponer_plantilla', arguments: JSON.stringify(raw), call_id: 'plantilla-ficticia' }];
function provider(respond: AssistantProvider['respond'] = async () => result()) {
  let id = 'cuenta-normativa-a', connected = true;
  const listeners = new Set<() => void>();
  const view = () => ({ active: id, accounts: [{ id, label: 'Ficticia', connected, enabled: connected }], pending: false, persistent: false, error: '' });
  return {
    view, connect: async () => view(), select: async (next: string) => { id = next; for (const fn of listeners) fn(); return view(); },
    disconnect: async () => { connected = false; for (const fn of listeners) fn(); return view(); }, cancelSignIn: async () => {},
    models: async () => [{ id: 'gpt-6-luna', name: 'Modelo ficticio' }], respond,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, close: async () => {},
  } satisfies AssistantProvider;
}
async function fixture(p = provider()) {
  env = await setup({}, { configure: (app, ctx) => assistantRoutes(app, ctx, p) });
  return env;
}
const list = async () => (await env!.app.inject('/api/assistant/template-generations')).json();
const post = (url: string, payload: unknown) => env!.app.inject({ method: 'POST', url: '/api/assistant/template-generations' + url, payload: payload as object });
const body = (r: any) => ({ account: r.account, project: r.project, baseRev: r.rev });
async function upload(overrides: Record<string, unknown> = {}, name = 'normativa.txt', bytes = Buffer.from('Normativa ficticia. Interior 35 mm. Exterior 20 o 25 mm.')) {
  const view = await list(), fd = new FormData();
  fd.append('metadata', JSON.stringify({ account: view.account, project: view.project, consent: true, ...overrides }));
  fd.append('file', new Blob([new Uint8Array(bytes)]), name);
  return env!.app.inject({ method: 'POST', url: '/api/assistant/template-generations', ...(await multipart(fd)) });
}
async function finished(id: string) {
  let r: any;
  await expect.poll(async () => {
    r = (await list()).items.find((item: any) => item.id === id);
    return !!r && r.state !== 'running';
  }, { timeout: 10_000 }).toBe(true);
  return r;
}

it('no publica una propuesta terminada antes de liberar el análisis que la guarda', async () => {
  let complete!: (value: ReturnType<typeof result>) => void, markSaved!: () => void, release!: () => void;
  const model = new Promise<ReturnType<typeof result>>(resolve => { complete = resolve; });
  await fixture(provider(async () => model));
  const sent = (await upload()).json();
  const published = new Promise<void>(resolve => { markSaved = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const write = records.privateJson;
  vi.spyOn(records, 'privateJson').mockImplementation(async (file, value: any) => {
    await write(file, value);
    if (path.basename(file) === sent.id + '.json' && value.state === 'prepared') {
      markSaved(); await gate;
    }
  });
  complete(result()); await published;
  let ready = false;
  const reading = list().then(value => { ready = true; return value; });
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(ready).toBe(false);
  } finally { release(); await reading; }
  const proposal = (await reading).items.find((r: any) => r.id === sent.id);
  expect(proposal.state).toBe('prepared');
  expect((await post('/' + sent.id + '/correct', { ...body(proposal), text: 'Corrección ficticia' })).statusCode).toBe(200);
});
it('interpreta ajustes documentados sin admitir macros, campos inventados ni fuentes fuera del catálogo', () => {
  const raw = normativaFixture();
  const parsed = interpretarNormativa(raw);
  expect(parsed.config.institucion).toMatchObject({ margenInterior: '35mm', margenExterior: '20mm', fuenteTexto: 'latinmodern' });
  expect(parsed.config.datos.autor).toBe('');
  expect(parsed.requisitos.find(r => r.nombre === 'Fuente del texto')?.valor).toContain('Latin Modern Roman');
  expect(parsed.requisitos[1]).toMatchObject({ nombre: 'Margen interior', cita: 'Margen interior de 35 mm.', pagina: 1 });
  for (const adjustment of [
    { ambito: 'institucion', campo: 'logo', valor: '../privado.pdf' },
    { ambito: 'institucion', campo: 'fuenteTexto', valor: 'arial' },
    { ambito: 'datos', campo: 'autor', valor: 'Inventado' },
    { ambito: 'datos', campo: 'universidad', valor: 'Universidad ficticia' },
    { ambito: 'institucion', campo: 'margenInterior', valor: '\\input{secreto}' },
  ]) expect(() => interpretarNormativa({ ...raw, ajustes: [{ ...raw.ajustes[0], ...adjustment }] })).toThrow();
  expect(() => interpretarNormativa({ ...raw, ajustes: [raw.ajustes[0], raw.ajustes[0]] })).toThrow();
  expect(() => interpretarNormativa({ ...raw, supuestos: [42] })).toThrow();
});
it('el esquema impide mezclar campos de institución, datos y apartados', () => {
  const schema = HERRAMIENTA_NORMATIVA.parameters as any;
  const branches = schema.properties.ajustes.items.anyOf;
  const fields = (scope: string) => branches.find((b: any) => b.properties.ambito.enum[0] === scope).properties.campo.enum;
  expect(fields('datos')).toContain('idioma'); expect(fields('datos')).not.toContain('universidad');
  expect(fields('institucion')).toContain('universidad'); expect(fields('institucion')).not.toContain('idioma');
  expect(fields('apartados')).toContain('resumen'); expect(fields('apartados')).not.toContain('margenInterior');
});
it('exige consentimiento y decide el modelo en la app; la revisión no crea ni cambia la memoria', async () => {
  let calls = 0;
  const t = await fixture(provider(async (_model, input, tools, _signal, _event, options) => {
    calls++;
    expect(_model).toBe('gpt-6-luna');
    expect(options?.purpose).toBe('template');
    expect(tools[0].name).toBe('proponer_plantilla');
    expect(input[0].content).toHaveLength(2);
    expect(input[0].content[1].text).toContain('Normativa ficticia');
    expect(JSON.stringify(input)).not.toContain(t.cfg.memoriaDir);
    return result();
  }));
  const before = await fs.readFile(path.join(t.cfg.memoriaDir, 'tfg.tex'), 'utf8');
  expect((await upload({ consent: false })).statusCode).toBe(403);
  expect(calls).toBe(0);
  const r = await upload();
  expect(r.statusCode, r.body).toBe(200);
  const ready = await finished(r.json().id);
  expect(ready.state).toBe('prepared');
  expect(ready.rev).toMatch(/^[a-f0-9]{16}$/);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir, 'tfg.tex'), 'utf8')).toBe(before);
  expect((await t.app.inject('/api/assistant/template-generations/' + ready.id + '/source')).body).toContain('Normativa ficticia');
  expect(calls).toBe(1);
});
it('lee el PDF únicamente como adjunto autorizado y rechaza formatos o cabeceras inválidos', async () => {
  await fixture(provider(async (_m, input) => {
    expect(input[0].content[1]).toMatchObject({ type: 'input_file', filename: 'reglas.pdf' });
    expect(input[0].content[1].file_data).toMatch(/^data:application\/pdf;base64,/);
    return result();
  }));
  expect((await upload({}, 'reglas.exe')).statusCode).toBe(400);
  expect((await upload({}, 'reglas.pdf', Buffer.from('%PDF-1.7\ntruncado'))).statusCode).toBe(400);
  expect((await upload({}, 'reglas.txt', Buffer.from([255, 254, 0, 255]))).statusCode).toBe(400);
  const r = await upload({}, 'reglas.pdf', Buffer.from('%PDF-1.7\nFicticio\n%%EOF\n'));
  expect(r.statusCode).toBe(200);
  expect((await finished(r.json().id)).state).toBe('prepared');
});
it('genera sin preguntas, descarta avisos y aplica correcciones conservando el resto de la plantilla', async () => {
  let calls = 0;
  const t = await fixture(provider(async (_m, input) => {
    calls++;
    const raw = normativaFixture();
    if (calls > 1) {
      expect(input[0].content[0].text).toContain('Pon el margen superior a 28 mm');
      expect(input[0].content[0].text).toContain('"fuenteTexto":"latinmodern"');
      raw.ajustes = [{ ambito: 'institucion', campo: 'margenSuperior', nombre: 'Margen superior', valor: '28mm', pagina: 1, cita: 'Corrección del usuario.' }];
      raw.capitulos = [];
    }
    return result(raw);
  }));
  const original = t.cfg.memoriaDir;
  const initial = await finished((await upload()).json().id);
  expect(initial.state).toBe('prepared'); expect(initial.dudas).toEqual([]);
  expect(initial.avisos).toHaveLength(2);
  expect(initial.config.institucion.margenExterior).toBe('20mm');
  const dismissed = await post('/' + initial.id + '/dismiss', { ...body(initial), noticeId: initial.avisos[0].id });
  expect(dismissed.statusCode, dismissed.body).toBe(200);
  let ready = dismissed.json();
  expect(ready.avisos[0].descartado).toBe(true);
  expect((await post('/' + initial.id + '/dismiss', { ...body(initial), noticeId: initial.avisos[0].id })).statusCode).toBe(409);
  expect((await post('/' + ready.id + '/correct', { ...body(ready), text: '' })).statusCode).toBe(400);
  const corrected = await post('/' + ready.id + '/correct', { ...body(ready), text: 'Pon el margen superior a 28 mm' });
  expect(corrected.statusCode, corrected.body).toBe(200);
  ready = await finished(ready.id);
  expect(ready.config.institucion).toMatchObject({ margenSuperior: '28mm', margenInterior: '35mm', margenExterior: '20mm', fuenteTexto: 'latinmodern' });
  expect(ready.avisos[0].descartado).toBe(true);
  expect(ready.correcciones).toEqual(['Pon el margen superior a 28 mm']);
  expect(ready.config.capitulos).toEqual(initial.config.capitulos);
  expect(t.cfg.memoriaDir).toBe(original);
  const dir = path.join(t.dir, 'desde-normativa');
  expect((await post('/' + ready.id + '/create', { ...body(ready), dir })).statusCode).toBe(409);
  vi.spyOn(estilo, 'compararEstilo').mockResolvedValue({id:'00000000-0000-4000-8000-000000000000',rev:'0000000000000000',ok:true,diagnostics:[],actual:null,propuesta:null});
  ready = (await post('/' + ready.id + '/preview', body(ready))).json();
  ready = (await post('/' + ready.id + '/apply', body(ready))).json();
  const created = await post('/' + ready.id + '/create', { ...body(ready), dir });
  expect(created.statusCode, created.body).toBe(200);
  expect(t.cfg.memoriaDir).toBe(dir);
  expect(parseDatos(await fs.readFile(path.join(dir, 'estilo/institucion.tex'), 'utf8'), 'institucion').margenSuperior).toBe('28mm');
  expect(await fs.readdir(path.join(dir, '1-capitulos'))).toHaveLength(3);
  expect(calls).toBe(2);
});
it('no acepta escrituras sin revisión ni sobrescribe una carpeta existente', async () => {
  const t = await fixture();
  const ready = await finished((await upload()).json().id), dir = path.join(t.dir, 'ocupada');
  await fs.mkdir(dir); await fs.writeFile(path.join(dir, 'no-tocar.txt'), 'Original ficticio');
  for (const baseRev of [undefined, '0000000000000000']) {
    const response = await post('/' + ready.id + '/create', { ...body(ready), baseRev, dir, configuracion: ready.config, acceptLimitations: true });
    expect([400, 409]).toContain(response.statusCode);
  }
  const used = await post('/' + ready.id + '/create', { ...body(ready), dir, configuracion: ready.config, acceptLimitations: true });
  expect(used.statusCode).toBe(409);
  expect(await fs.readFile(path.join(dir, 'no-tocar.txt'), 'utf8')).toBe('Original ficticio');
  expect(t.cfg.memoriaDir).not.toBe(dir);
});
it('cancela al cambiar de cuenta y descarta una respuesta tardía sin crear archivos', async () => {
  let release!: (output: any[]) => void;
  const p = provider(async () => new Promise(resolve => { release = resolve; }));
  const t = await fixture(p), r = await upload(), id = r.json().id;
  await expect.poll(() => !!release).toBe(true);
  await p.select('cuenta-normativa-b'); release(result());
  expect((await list()).items).toEqual([]);
  expect((await t.app.inject('/api/assistant/template-generations/' + id + '/source')).statusCode).toBe(404);
  expect((await post('/' + id + '/create', { account: 'cuenta-normativa-a', project: r.json().project, baseRev: r.json().rev, dir: path.join(t.dir, 'ajena'), configuracion: {} })).statusCode).toBe(409);
  await p.select('cuenta-normativa-a');
  expect((await finished(id)).state).toBe('cancelled');
  await expect(fs.stat(path.join(t.dir, 'ajena'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('una salida del modelo inválida queda como error recuperable y no provoca reintentos automáticos', async () => {
  let calls = 0;
  await fixture(provider(async () => { calls++; return result({ ...normativaFixture(), ajustes: [{ ambito: 'institucion', campo: 'tamanoLetra', nombre: 'Texto', valor: '99pt', pagina: 1, cita: 'Texto' }] }); }));
  const r = await upload(), ready = await finished(r.json().id);
  expect(ready.state).toBe('error');
  expect(ready.config).toBeNull();
  expect(calls).toBe(1);
});
it('elimina propuesta y normativa guardada sin alterar las fuentes originales', async () => {
  const t = await fixture(), original = await fs.readFile(path.join(t.cfg.memoriaDir, 'tfg.tex'), 'utf8');
  const ready = await finished((await upload()).json().id);
  const deleted = await t.app.inject({ method: 'DELETE', url: '/api/assistant/template-generations/' + ready.id, payload: body(ready) });
  expect(deleted.statusCode).toBe(200);
  expect((await list()).items).toEqual([]);
  expect((await t.app.inject('/api/assistant/template-generations/' + ready.id + '/source')).statusCode).toBe(404);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir, 'tfg.tex'), 'utf8')).toBe(original);
});
it('detener descarta la respuesta tardía y permite repetir solo por una acción explícita', async () => {
  let release!: (output: any[]) => void, calls = 0;
  await fixture(provider(async () => { calls++; return calls === 1 ? new Promise(resolve => { release = resolve; }) : result(); }));
  const sent = await upload(), id = sent.json().id;
  await expect.poll(() => !!release).toBe(true);
  expect((await upload()).statusCode).toBe(409);
  expect((await post('/' + id + '/cancel', body(sent.json()))).statusCode).toBe(200);
  release(result());
  let current = await finished(id);
  expect(current.state).toBe('cancelled'); expect(current.config).toBeNull(); expect(calls).toBe(1);
  expect((await post('/' + id + '/correct', { ...body(current), text: 'Repite la adaptación' })).statusCode).toBe(200);
  current = await finished(id);
  expect(current.state).toBe('prepared'); expect(calls).toBe(2);
  while (current.calls < 5) {
    expect((await post('/' + id + '/correct', { ...body(current), text: 'Usa 20 mm de margen exterior' })).statusCode).toBe(200);
    current = await finished(id);
  }
  expect((await post('/' + id + '/correct', { ...body(current), text: 'Usa 20 mm de margen exterior' })).statusCode).toBe(400);
  expect(calls).toBe(5);
});
it('cambiar los ajustes del proyecto cancela el análisis sin aplicar una respuesta antigua', async () => {
  let release!: (output: any[]) => void;
  const t = await fixture(provider(async () => new Promise(resolve => { release = resolve; })));
  const sent = await upload(); await expect.poll(() => !!release).toBe(true);
  t.ctx.bus.emit('settings', {}); release(result());
  const current = await finished(sent.json().id);
  expect(current.state).toBe('cancelled'); expect(current.config).toBeNull();
  expect(t.cfg.memoriaDir).toBe(path.join(t.dir, 'fixtures/memoria'));
});
it('elige el modelo económico de la app sin obedecer el modelo enviado por un cliente', async () => {
  let selected = '';
  const p = provider(async model => { selected = model; return result(); });
  p.models = async () => [{ id: 'gpt-6-astra', name: 'Superior' }, { id: 'gpt-5.6-luna', name: 'Anterior' }, { id: 'gpt-6-luna', name: 'Económico' }];
  await fixture(p);
  const response = await upload({ model: 'gpt-6-astra' });
  expect(response.statusCode).toBe(200);
  expect((await finished(response.json().id)).model).toBe('gpt-6-luna');
  expect(selected).toBe('gpt-6-luna');
});
it('admite la alternativa económica aprobada y no escala a una superior al dejar de estar disponible', async () => {
  let calls = 0;
  const p = provider(async model => { calls++; expect(model).toBe('gpt-5.6-luna'); return result(); });
  p.models = async () => [{ id: 'gpt-5.6-luna', name: 'Económico anterior' }];
  await fixture(p);
  const ready = await finished((await upload()).json().id);
  p.models = async () => [{ id: 'gpt-6-astra', name: 'Superior' }];
  expect((await upload()).statusCode).toBe(503);
  expect((await post('/' + ready.id + '/correct', { ...body(ready), text: 'Repite la adaptación' })).statusCode).toBe(503);
  expect((await list()).items[0].rev).toBe(ready.rev);
  expect(calls).toBe(1);
});
it('una compilación fallida bloquea aplicar y crear sin cambiar la memoria', async () => {
  const t=await fixture(), original=await fs.readFile(path.join(t.cfg.memoriaDir,'estilo/institucion.tex'));
  let ready=await finished((await upload()).json().id);
  vi.spyOn(estilo,'compararEstilo').mockResolvedValue({id:'00000000-0000-4000-8000-000000000000',rev:'0000000000000000',ok:false,diagnostics:[{severity:'error',message:'Error ficticio de compilación'}],actual:null,propuesta:null});
  const preview=await post('/'+ready.id+'/preview',body(ready));expect(preview.statusCode,preview.body).toBe(200);ready=preview.json();
  expect((await post('/'+ready.id+'/apply',body(ready))).statusCode).toBe(409);
  expect((await post('/'+ready.id+'/create',{...body(ready),dir:path.join(t.dir,'no-creada')})).statusCode).toBe(409);
  expect(await fs.readFile(path.join(t.cfg.memoriaDir,'estilo/institucion.tex'))).toEqual(original);
});
it('la normativa parte de una plantilla personal y conserva los valores no modificados', async () => {
  const t=await fixture(provider(async (_model,input) => {
    expect(JSON.stringify(input)).toContain('schola');const raw=normativaFixture();raw.ajustes=[];raw.capitulos=[];return result(raw);
  }));
  const file=path.join(t.cfg.memoriaDir,'estilo/institucion.tex');await fs.appendFile(file,'\n\\fuenteTexto{schola}\n');
  const {baseRev}=(await t.app.inject('/api/memoria/estilo/revision')).json();
  const saved=await t.app.inject({method:'POST',url:'/api/templates/personal',payload:{nombre:'Referencia ficticia',baseRev}});expect(saved.statusCode,saved.body).toBe(200);
  const ready=await finished((await upload({referenciaId:saved.json().id,referenciaRev:saved.json().rev})).json().id);
  expect(ready.state).toBe('prepared');expect(ready.config.institucion.fuenteTexto).toBe('schola');
});
it('descartar una corrección recupera valores, evidencias y correcciones aceptadas', async () => {
  await fixture();let ready=await finished((await upload()).json().id);
  vi.spyOn(estilo,'compararEstilo').mockResolvedValue({id:'00000000-0000-4000-8000-000000000000',rev:'0000000000000000',ok:true,diagnostics:[],actual:null,propuesta:null});
  ready=(await post('/'+ready.id+'/preview',body(ready))).json();ready=(await post('/'+ready.id+'/apply',body(ready))).json();
  const accepted=structuredClone(ready);
  await post('/'+ready.id+'/correct',{...body(ready),text:'Corrección ficticia descartada'});ready=await finished(ready.id);expect(ready.correcciones).toContain('Corrección ficticia descartada');
  const restored=(await post('/'+ready.id+'/discard',body(ready))).json();
  expect(restored.config).toEqual(accepted.config);expect(restored.requisitos).toEqual(accepted.requisitos);expect(restored.correcciones).toEqual(accepted.correcciones);expect(restored.appliedRev).toBeUndefined();
});

it('las portadas ofrecidas al modelo siempre tienen los datos necesarios para el generador', () => {
  const schema=HERRAMIENTA_NORMATIVA.parameters as any;
  const [metadata,custom]=schema.properties.portadas.anyOf[1].properties.interior.items.anyOf;
  expect(metadata.properties.texto.type).toBe('null');
  expect(metadata.properties.tipo.enum).not.toContain('imagen');
  expect(metadata.properties.tipo.enum).not.toContain('texto');
  expect(custom.properties.tipo.enum).toEqual(['texto']);expect(custom.properties.texto).toMatchObject({type:'string',minLength:1,maxLength:500});
  for(const tipo of [...metadata.properties.tipo.enum,'texto']) {
    const raw=normativaFixture();
    raw.portadas={interior:[{tipo,zona:'central',texto:tipo==='texto'?'Texto propio':null}],exterior:[],pagina:6,cita:'Modelo de portada ficticio.'} as any;
    expect(()=>interpretarNormativa(raw)).not.toThrow();
  }
});
