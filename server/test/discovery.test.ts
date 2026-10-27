import fs from 'node:fs/promises';
import * as records from '../src/assistantChanges.ts';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setup, type TestEnv } from './helpers.ts';
import { assistantRoutes, type AssistantProvider } from '../src/assistant.ts';
import { discoveryUrl, searchEvidence } from '../src/discovery.ts';
import { createMetadataFetcher } from '../src/metadataHttp.ts';
import { buildApp } from '../src/app.ts';
let t: TestEnv, active: string, listeners: Set<() => void>;
let respond: ReturnType<typeof vi.fn>, fetcher: ReturnType<typeof vi.fn>;
const response = (value: unknown, evidence = false) => [ ...(evidence ? [{ type: 'web_search_call', action: { type: 'search', sources: [{ url: 'https://example.org/recurso', title: 'Fuente ficticia' }] } }] : []), { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] } ];
const meta = { DOI: '10.1234/ficticio', title: ['Artículo ficticio'], type: 'journal-article', author: [{ family: 'Ejemplo', given: 'Ana' }], issued: { 'date-parts': [[2026]] }, language: 'es', 'container-title': ['Revista ficticia'] };
const provider = (): AssistantProvider => ({ view: () => ({ accounts: [{ id: active, label: 'Ficticia', connected: true, enabled: true }], active, pending: false, persistent: false, error: '' }), connect: async () => provider().view(), select: async id => { active = id; listeners.forEach(fn => fn()); return provider().view(); }, disconnect: async () => provider().view(), cancelSignIn: async () => {}, models: async () => [{ id: 'ficticio', name: 'Ficticio' }, { id: 'auxiliar', name: 'Auxiliar' }], respond: respond as any, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, close: async () => {} });
const post = (endpoint: string, payload: any) => t.app.inject({ method: 'POST', url: '/api/assistant' + endpoint, payload });
const get = async (endpoint: string) => { const res = await t.app.inject('/api/assistant' + endpoint); expect(res.statusCode, res.body).toBe(200); return res.json(); };
const body = (v: any) => ({ baseRev: v.rev, project: v.project, account: v.account });
beforeEach(async () => {
  active = 'cuenta-ficticia'; listeners = new Set();
  fetcher = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ message: { items: [meta] } })) }));
  respond = vi.fn(async (_m, input, tools, signal, _event, options) => {
    signal.throwIfAborted();
    if (options.purpose === 'search') { expect(tools).toEqual([{ type: 'web_search' }]); return response({ candidates: [{ url: 'https://example.org/recurso', title: 'Web ficticia', kind: 'web', description: 'Descripción ficticia' }, { url: 'https://example.org/inventado', title: 'Inventada', kind: 'web' }] }, true); }
    expect(options.purpose).toBe('review'); expect(tools).toEqual([]);
    const text = input[0].content[0].text, raw = text.split('\nCandidatos: ')[1].split('\nContexto autorizado')[0];
    const candidates = JSON.parse(raw);
    return response({ candidates: candidates.map((c: any) => ({ id: c.id, purpose: 'Introducir el tema', contribution: 'Aportación inferida de los datos disponibles', usage: 'Marco teórico', limitations: 'No se ha leído el texto completo ni validado su calidad' })) });
  });
  t = await setup({}, { fetchMetadata: fetcher as any, configure: (app, ctx) => assistantRoutes(app, ctx, provider()) });
  const v = await get('/context'); expect((await post('/context', { ...body(v), grants: { ...v.grants, search: true } })).statusCode).toBe(200);
});
afterEach(async () => { await t.close(); });
async function start(patch = {}) {
  const v = await get('/context'); const res = await post('/searches', { project: v.project, account: v.account, model: 'ficticio', mode: 'quick', provider: 'web', filters: { need: 'Una necesidad ficticia', kinds: [], language: '' }, ...patch });
  expect(res.statusCode, res.body).toBe(200); return res.json();
}
async function done(id: string) { let r: any; await expect.poll(async () => { r = await get('/searches/' + id); return r.state; }, { timeout: 10_000 }).not.toBe('running'); return r; }
it('espera a liberar una búsqueda terminada antes de permitir la siguiente acción', async () => {
  let markSaved!: () => void, release!: () => void;
  const published = new Promise<void>(resolve => { markSaved = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const write = records.privateJson;
  const spy = vi.spyOn(records, 'privateJson').mockImplementation(async (file, value: any) => {
    await write(file, value);
    if (value.state === 'idle') { markSaved(); await gate; }
  });
  const initial = await start({ provider: 'crossref' }); await published;
  let ready = false;
  const reading = get('/searches/' + initial.id).then(value => { ready = true; return value; });
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(ready).toBe(false);
  } finally { release(); await reading; spy.mockRestore(); }
  expect((await reading).state).toBe('idle');
  expect((await done((await start({ provider: 'crossref' })).id)).state).toBe('idle');
});
it('búsqueda real por herramientas, filtra referencias inventadas, conserva decisiones y no crea recursos', async () => {
  const r = await done((await start()).id); expect(r.state).toBe('idle'); expect(r.candidates).toHaveLength(2); expect(r.candidates.some((c: any) => c.title === 'Inventada')).toBe(false);
  expect(r.candidates.every((c: any) => c.explanation && c.evidence.length)).toBe(true); expect((await t.app.inject('/api/resources')).json().items).toHaveLength(0);
  const c = r.candidates[0]; const res = await post(`/searches/${r.id}/candidates/${c.id}/decision`, { ...body(r), state: 'discarded' }); expect(res.statusCode).toBe(200);
  expect((await get('/searches/' + r.id)).candidates[0].state).toBe('discarded'); expect((await get('/searches')).preferredModel).toBe('ficticio');
});
it('dos especialistas como máximo, deduplicación y límites de cinco peticiones/veinte candidatos', async () => {
  let concurrent = 0, maximum = 0, web = 0, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const base = respond.getMockImplementation()!;
  respond.mockImplementation(async (...args: any[]) => { concurrent++; maximum = Math.max(maximum, concurrent); if (args[5].purpose === 'search') { if (++web === 2) release(); await gate; } try { return await (base as any)(...args); } finally { concurrent--; } });
  const r = await done((await start({ mode: 'extended' })).id); expect(maximum).toBe(2); expect(r.calls).toBe(3); expect(r.candidates).toHaveLength(2);
  expect(r.candidates.filter((c: any) => c.url === 'https://example.org/recurso')).toHaveLength(1);
});
it('los buscadores reciben solo filtros visibles; el contexto se usa después sin navegación', async () => {
  let v = await get('/context');
  v = (await post('/context', { ...body(v), profile: { ...v.profile, topic: 'SECRETO-FICTICIO-AUTORIZADO' }, selection: { ...v.selection, mode: 'partial' }, grants: { ...v.grants, useContext: true } })).json();
  await done((await start({ contextVersion: v.effective.version })).id);
  const searches = respond.mock.calls.filter(c => c[5].purpose === 'search'), reviews = respond.mock.calls.filter(c => c[5].purpose === 'review');
  expect(searches.every(c => !JSON.stringify(c[1]).includes('SECRETO'))).toBe(true); expect(JSON.stringify(reviews[0][1])).toContain('SECRETO-FICTICIO-AUTORIZADO'); expect(reviews[0][2]).toEqual([]);
  expect(fetcher.mock.calls.every(c => !c[0].includes('SECRETO'))).toBe(true);
});
it('web no disponible conserva Crossref, no sustituye el modelo y exige nueva acción', async () => {
  respond.mockImplementationOnce(async () => { throw new Error('Cuota o búsqueda web no disponible'); });
  const r = await done((await start()).id); expect(r.state).toBe('partial'); expect(r.candidates).toHaveLength(1); expect(r.parts['web-general'].state).toBe('error');
  expect(fetcher).toHaveBeenCalledTimes(1); expect(respond).toHaveBeenCalledTimes(2);
  const next = await done((await start({ provider: 'crossref' })).id); expect(Object.keys(next.parts)).toEqual(['crossref', 'review']);
});
it('reintenta solo el descubrimiento fallido y su revisión, sin repetir Crossref ni superar presupuesto', async () => {
  const base = respond.getMockImplementation()!; respond.mockImplementation(async (...args: any[]) => { if (args[5].purpose === 'search') throw new Error('Sin web'); return (base as any)(...args); });
  let r = await done((await start()).id);
  r = (await post(`/searches/${r.id}/retry`, body(r))).json(); r = await done(r.id); expect(r.calls).toBe(4); expect(fetcher).toHaveBeenCalledTimes(1);
  await post(`/searches/${r.id}/retry`, body(r)); r = await done(r.id); expect(r.calls).toBe(5); expect((await post(`/searches/${r.id}/retry`, body(r))).statusCode).toBe(400);
});
it('Crossref respeta fechas, idioma/tipo conocidos y conserva metadatos ausentes para revisar', async () => {
  fetcher.mockResolvedValueOnce({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ message: { items: [meta, { ...meta, DOI: '10.1234/otro', language: 'en' }, { ...meta, DOI: '10.1234/viejo', issued: { 'date-parts': [[2000]] } }] } })) });
  const r = await done((await start({ provider: 'crossref', filters: { need: 'Prueba', kinds: ['article'], language: 'es', fromYear: 2020, toYear: 2026 } })).id);
  expect(r.candidates).toHaveLength(1); const url = new URL(fetcher.mock.calls[0][0]); expect(url.searchParams.get('filter')).toContain('from-pub-date:2020-01-01'); expect(url.searchParams.get('filter')).toContain('type:journal-article');
});
it('guarda solo tras revisión, mediante importación/captura recuperables y con aportación separada', async () => {
  let r = await done((await start()).id);
  for (const c of r.candidates) {
    const form = await get(`/searches/${r.id}/candidates/${c.id}/review`); form.tags = ['tfg']; form.collections = ['Lecturas']; form.assistantNote = 'Aportación revisada ficticia';
    const res = await post(`/searches/${r.id}/candidates/${c.id}/save`, { ...body(r), form }); expect(res.statusCode, res.body).toBe(200); r = res.json(); expect(r.candidates.find((x: any) => x.id === c.id).state).toBe('saved');
    expect((await post(`/searches/${r.id}/candidates/${c.id}/save`, { ...body(r), form })).statusCode).toBe(200);
    expect((await post(`/searches/${r.id}/candidates/${c.id}/save`, { ...body(r), form: { ...form, title: 'Otro formulario' } })).statusCode).toBe(409);
  }
  const resources = (await t.app.inject('/api/resources')).json().items; expect(resources).toHaveLength(2);
  expect(resources.every((r: any) => r.note.includes('## Aportación del asistente') && r.tags.includes('tfg') && r.collections.includes('Lecturas'))).toBe(true);
  expect(resources.find((r: any) => r.kind === 'article').bibliography.fields.doi).toBe('10.1234/ficticio');
  expect(resources.every((r: any) => r.attachments.length === 0)).toBe(true);
});
it('duplicados por DOI/URL/título requieren elección; dos clientes no pierden decisiones', async () => {
  let r = await done((await start({ provider: 'crossref' })).id), c = r.candidates[0], form = await get(`/searches/${r.id}/candidates/${c.id}/review`);
  r = (await post(`/searches/${r.id}/candidates/${c.id}/save`, { ...body(r), form })).json();
  let second = await done((await start({ provider: 'crossref' })).id); c = second.candidates[0]; form = await get(`/searches/${second.id}/candidates/${c.id}/review`); expect(form.duplicates).toHaveLength(1);
  expect((await post(`/searches/${second.id}/candidates/${c.id}/save`, { ...body(second), form })).statusCode).toBe(409); second = await get('/searches/' + second.id); expect(second.candidates[0].saveError).toContain('duplicados');
  second = (await post(`/searches/${second.id}/candidates/${c.id}/save`, { ...body(second), form, duplicate: { path: form.duplicates[0].path, rev: form.duplicates[0].rev } })).json(); expect(second.candidates[0].state).toBe('saved');
  expect((await t.app.inject('/api/resources')).json().items).toHaveLength(1);
  const third = await done((await start({ provider: 'crossref' })).id); c = third.candidates[0];
  const responses = await Promise.all(['pending', 'discarded'].map(state => post(`/searches/${third.id}/candidates/${c.id}/decision`, { ...body(third), state })));
  expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
});
it('retirar acceso cancela tareas y conserva parciales; otra cuenta no accede a consultas', async () => {
  let started!: () => void; const began = new Promise<void>(r => { started = r; });
  respond.mockImplementationOnce(async (_m, _input, _tools, signal) => { started(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Detenido')), { once: true })); return []; });
  const r = await start(); await began;
  const v = await get('/context'); await post('/context', { ...body(v), grants: { ...v.grants, search: false } });
  expect((await done(r.id)).state).toBe('cancelled'); expect((await post(`/searches/${r.id}/retry`, body(await get('/searches/' + r.id)))).statusCode).toBe(403);
  active = 'otra-cuenta'; listeners.forEach(fn => fn()); expect((await t.app.inject('/api/assistant/searches/' + r.id)).statusCode).toBe(404);
});
it('recupera consultas y decisiones tras reiniciar sin repetir solicitudes', async () => {
  const r = await done((await start()).id); await t.app.close();
  const { app } = await buildApp(t.cfg, { serveWeb: false, configure: (app, ctx) => assistantRoutes(app, ctx, provider()) });
  try { const restored = (await app.inject('/api/assistant/searches/' + r.id)).json(); expect(restored.candidates).toEqual(r.candidates); expect(restored.calls).toBe(r.calls); }
  finally { await app.close(); }
});
it('las citas solo vienen de herramientas y los destinos privados no se aceptan', async () => {
  expect(discoveryUrl('http://127.0.0.1/')).toBeNull(); expect(discoveryUrl('https://persona:clave@example.org')).toBeNull();
  expect(searchEvidence(response({ candidates: [{ url: 'https://example.org/falso' }] }))).toEqual([]);
  const controller = new AbortController();
  const fetch = createMetadataFetcher({ lookup: async () => [{ address: '93.184.216.34', family: 4 }], request: async (_u, _a, signal) => { controller.abort(); signal.throwIfAborted(); throw new Error('Inalcanzable'); } });
  await expect(fetch('https://example.org', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
it('al llegar a veinte candidatos muestra parciales y no publica resultados sobrantes', async () => {
  fetcher.mockResolvedValueOnce({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ message: { items: Array.from({ length: 20 }, (_, i) => ({ ...meta, DOI: `10.1234/ficticio-${i}`, title: [`Artículo ${i}`] })) } })) });
  const r = await done((await start()).id); expect(r.candidates).toHaveLength(20); expect(r.state).toBe('partial'); expect(r.warnings.join(' ')).toContain('veinte');
});
it('una publicación seguida de un fallo al guardar el resultado se recupera sin duplicar', async () => {
  let r = await done((await start({ filters: { need: 'Fuente web', kinds: ['web'], language: '' } })).id), c = r.candidates[0];
  const form = await get(`/searches/${r.id}/candidates/${c.id}/review`), rename = fs.rename.bind(fs); let failed = false;
  const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (!failed && String(to).endsWith(r.id + '.json')) {
      const next = JSON.parse(await fs.readFile(from, 'utf8'));
      if (next.candidates?.[0]?.state === 'saved') { failed = true; throw Object.assign(new Error('Fallo ficticio'), { code: 'EIO' }); }
    }
    return rename(from, to);
  });
  try {
    r = (await post(`/searches/${r.id}/candidates/${c.id}/save`, { ...body(r), form })).json(); expect(failed).toBe(true); expect(r.candidates[0].state).toBe('saving');
    r = (await post(`/searches/${r.id}/candidates/${c.id}/save`, { ...body(r), form })).json(); expect(r.candidates[0].state).toBe('saved');
    expect((await t.app.inject('/api/resources')).json().items).toHaveLength(1);
  } finally { spy.mockRestore(); }
});

it('conserva la elección de modelo antes de ejecutar, con revisión y aislamiento por cuenta', async () => {
  const v = await get('/context'), previous = (await get('/searches')).modelPreference;
  const saved = await post('/searches/model', { ...body(v), baseRev: previous.rev, model: 'ficticio' }); expect(saved.statusCode).toBe(200);
  const list = await get('/searches'); expect(list.preferredModel).toBe('ficticio'); expect(list.searches).toEqual([]);
  expect((await post('/searches/model', { ...body(v), baseRev: previous.rev, model: 'auxiliar' })).statusCode).toBe(409);
  active = 'otra-cuenta'; listeners.forEach(fn => fn()); expect((await get('/searches')).preferredModel).toBe('');
});
