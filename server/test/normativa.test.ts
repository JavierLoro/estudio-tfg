import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { setup, multipart, type TestEnv } from './helpers.ts';
import { assistantRoutes, type AssistantProvider } from '../src/assistant.ts';
import { interpretarNormativa } from '../src/normativa.ts';
import { normativaFixture } from '../../test/normativa-fixture.ts';
import { parseDatos } from '../src/datos.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.close(); env = undefined; });
const result = (raw = normativaFixture()) => [{ type: 'function_call', name: 'proponer_plantilla', arguments: JSON.stringify(raw), call_id: 'plantilla-ficticia' }];
function provider(respond: AssistantProvider['respond'] = async () => result()) {
  let id = 'cuenta-normativa-a', connected = true;
  const listeners = new Set<() => void>();
  const view = () => ({ active: id, accounts: [{ id, label: 'Ficticia', connected, enabled: connected }], pending: false, persistent: false, error: '' });
  return {
    view, connect: async () => view(), select: async (next: string) => { id = next; for (const fn of listeners) fn(); return view(); },
    disconnect: async () => { connected = false; for (const fn of listeners) fn(); return view(); }, cancelSignIn: async () => {},
    models: async () => [{ id: 'modelo-normativa', name: 'Modelo ficticio' }], respond,
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
  fd.append('metadata', JSON.stringify({ account: view.account, project: view.project, consent: true, model: 'modelo-normativa', ...overrides }));
  fd.append('file', new Blob([new Uint8Array(bytes)]), name);
  return env!.app.inject({ method: 'POST', url: '/api/assistant/template-generations', ...(await multipart(fd)) });
}
async function finished(id: string) {
  let r: any;
  await expect.poll(async () => {
    r = (await list()).items.find((item: any) => item.id === id);
    return r?.state;
  }, { timeout: 10_000 }).not.toBe('running');
  return r;
}
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
    { ambito: 'institucion', campo: 'margenInterior', valor: '\\input{secreto}' },
  ]) expect(() => interpretarNormativa({ ...raw, ajustes: [{ ...raw.ajustes[0], ...adjustment }] })).toThrow();
  expect(() => interpretarNormativa({ ...raw, ajustes: [raw.ajustes[0], raw.ajustes[0]] })).toThrow();
  expect(() => interpretarNormativa({ ...raw, dudas: [{ id: '../fuera', pregunta: 'Duda', opciones: [], pagina: 1, cita: 'Origen' }] })).toThrow();
});
it('exige consentimiento y modelo válido; la revisión no crea ni cambia la memoria', async () => {
  let calls = 0;
  const t = await fixture(provider(async (_model, input, tools, _signal, _event, options) => {
    calls++;
    expect(options?.purpose).toBe('template');
    expect(tools[0].name).toBe('proponer_plantilla');
    expect(input[0].content).toHaveLength(2);
    expect(input[0].content[1].text).toContain('Normativa ficticia');
    expect(JSON.stringify(input)).not.toContain(t.cfg.memoriaDir);
    return result();
  }));
  const before = await fs.readFile(path.join(t.cfg.memoriaDir, 'tfg.tex'), 'utf8');
  expect((await upload({ consent: false })).statusCode).toBe(403);
  expect((await upload({ model: 'modelo-inexistente' })).statusCode).toBe(400);
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
it('bloquea dudas, conserva las respuestas y exige aceptar las limitaciones antes de crear', async () => {
  let calls = 0;
  const t = await fixture(provider(async (_m, input) => {
    calls++;
    if (calls > 1) expect(input[0].content[0].text).toContain('"margen":"20 mm"');
    return result(normativaFixture(calls === 1));
  }));
  const current = t.cfg.memoriaDir;
  const r = await upload(), id = r.json().id;
  let ready = await finished(id);
  const dir = path.join(t.dir, 'desde-normativa');
  expect((await post('/' + id + '/create', { ...body(ready), dir, configuracion: ready.config, acceptLimitations: true })).statusCode).toBe(409);
  const sent = await post('/' + id + '/answers', { ...body(ready), answers: { margen: '20 mm' } });
  expect(sent.statusCode, sent.body).toBe(200);
  ready = await finished(id);
  expect(ready.dudas).toEqual([]);
  expect(ready.config.institucion.margenExterior).toBe('20mm');
  expect(t.cfg.memoriaDir).toBe(current);
  expect((await post('/' + id + '/create', { ...body(ready), dir, configuracion: ready.config })).statusCode).toBe(403);
  const edited = structuredClone(ready.config); edited.datos.titulo = 'Memoria ficticia revisada';
  const create = await post('/' + id + '/create', { ...body(ready), dir, configuracion: edited, acceptLimitations: true });
  expect(create.statusCode, create.body).toBe(200);
  expect(t.cfg.memoriaDir).toBe(dir);
  expect(parseDatos(await fs.readFile(path.join(dir, 'datos.tex'), 'utf8'), 'datos').titulo).toBe('Memoria ficticia revisada');
  expect(parseDatos(await fs.readFile(path.join(dir, 'estilo/institucion.tex'), 'utf8'), 'institucion').margenExterior).toBe('20mm');
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
  expect((await post('/' + id + '/answers', { ...body(current), answers: {} })).statusCode).toBe(200);
  current = await finished(id);
  expect(current.state).toBe('prepared'); expect(calls).toBe(2);
  while (current.calls < 5) {
    const answers = Object.fromEntries(current.dudas.map((q: any) => [q.id, '20 mm']));
    expect((await post('/' + id + '/answers', { ...body(current), answers })).statusCode).toBe(200);
    current = await finished(id);
  }
  expect((await post('/' + id + '/answers', { ...body(current), answers: { margen: '20 mm' } })).statusCode).toBe(400);
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
