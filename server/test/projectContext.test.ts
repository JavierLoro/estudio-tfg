import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setup, type TestEnv } from './helpers.ts';
import { assistantRoutes, type AssistantProvider } from '../src/assistant.ts';
import { changedWords } from '../src/projectContext.ts';
import { DIAGRAM_TYPES, type ContextView } from '../../shared/assistant.ts';
let t: TestEnv, account: string;
let listeners: Set<() => void>;
let respond: ReturnType<typeof vi.fn>;
const reply = (value: unknown) => [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }];
const view = () => ({ accounts: [{ id: account, label: 'Ficticia', connected: true, enabled: true }], active: account, pending: false, persistent: false, error: '' });
const provider = (): AssistantProvider => ({ view, connect: async () => view(), select: async id => { account = id; listeners.forEach(fn => fn()); return view(); }, disconnect: async () => view(), cancelSignIn: async () => {}, models: async () => [{ id: 'ficticio', name: 'Ficticio' }], respond: respond as any, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, close: async () => {} });
beforeEach(async () => {
  account = 'cuenta-ficticia'; listeners = new Set();
  respond = vi.fn(async (_m, input, _tools, _signal, _event, options) => {
    expect(options.purpose).not.toBe('chat');
    const text = input[0].content[0].text;
    if (options.purpose === 'diagram') return reply({ code: 'flowchart LR\n a-->b', explanation: 'Explicación ficticia', assumptions: 'Sin supuestos confirmados' });
    const batch = JSON.parse(text.slice(text.indexOf('\n') + 1));
    return reply({ fragments: batch.map((b: any) => ({ id: b.id, text: 'Resumen ficticio: ' + b.text.slice(0, 100) })) });
  });
  t = await setup({}, { configure: (app, ctx) => assistantRoutes(app, ctx, provider()) });
  await fs.writeFile(path.join(t.cfg.notesDir, 'Contexto.md'), 'Documento ficticio para contexto.');
});
afterEach(async () => { vi.restoreAllMocks(); await t.close(); });
async function get(): Promise<ContextView> { const res = await t.app.inject('/api/assistant/context'); expect(res.statusCode).toBe(200); return res.json(); }
const body = (v: ContextView) => ({ baseRev: v.rev, project: v.project, account: v.account });
async function post(url: string, payload: any) { return t.app.inject({ method: 'POST', url: '/api/assistant' + url, payload }); }
async function configure(all = false) {
  const v = await get(); const res = await post('/context', { ...body(v), selection: { ...v.selection, mode: all ? 'all' : 'partial', files: all ? [] : [{ root: 'notes', path: 'Contexto.md' }] }, grants: { ...v.grants, prepareContext: true, useContext: true, prepareDiagrams: true } });
  expect(res.statusCode, res.body).toBe(200); return res.json() as ContextView;
}
async function prepare() {
  const v = await get(); const res = await post('/context/prepare', { ...body(v), model: 'ficticio', dirty: [] }); expect(res.statusCode, res.body).toBe(200);
  let current = await get();
  await expect.poll(async () => { current = await get(); return current.proposals.at(-1)?.state; }).not.toBe('running');
  expect(current.proposals.at(-1)?.state, JSON.stringify(current.proposals)).toBe('prepared'); return current;
}
async function accept(v: ContextView) { const p = v.proposals.at(-1)!; const res = await post(`/context/proposals/${p.id}/accept`, { ...body(v), fragments: p.fragments }); expect(res.statusCode, res.body).toBe(200); return res.json() as ContextView; }
it('empieza desactivado y selecciona sin tocar Markdown ni dar otros permisos', async () => {
  let v = await get(); expect(v.selection.mode).toBe('off'); expect(v.grants).toEqual({ prepareContext: false, useContext: false, prepareDiagrams: false, search: false });
  const before = await fs.readFile(path.join(t.cfg.notesDir, 'Contexto.md'), 'utf8');
  const res = await post('/context', { ...body(v), selection: { ...v.selection, files: [{ root: 'notes', path: 'Contexto.md' }] } }); expect(res.statusCode).toBe(200);
  v = await get(); expect(v.selection.mode).toBe('off'); expect(v.effective).toBeNull(); expect(respond).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(t.cfg.notesDir, 'Contexto.md'), 'utf8')).toBe(before);
});
it('propone por lotes, permite corregir, aceptar y deshacer; nunca llama desde watcher', async () => {
  await configure(); let v = await prepare();
  v.proposals.at(-1)!.fragments[0].text = 'Corrección confirmada ficticia';
  v = await accept(v); expect(v.effective?.text).toContain('Corrección confirmada ficticia');
  expect(respond).toHaveBeenCalledTimes(1);
  const res = await post('/context/undo', body(v)); expect(res.statusCode).toBe(200); expect((await get()).fragments).toEqual([]);
  expect(await fs.readdir(path.join(t.cfg.historyDir, 'notes', '.asistente', v.project, 'context.json'))).not.toHaveLength(0);
});
it('un archivo grande continúa por fragmentos acotados sin mezclar procedencia', async () => {
  await fs.writeFile(path.join(t.cfg.notesDir, 'Contexto.md'), 'ficticio '.repeat(9000));
  await configure(); let v = await prepare(); expect(v.proposals.at(-1)!.fragments).toHaveLength(3); expect(v.proposals.at(-1)!.remaining).toBe(2);
  v = await accept(v); expect(v.pending).toBe(2);
  v = await prepare(); expect(v.proposals.at(-1)!.fragments).toHaveLength(2);
  v = await accept(v); expect(v.pending).toBe(0); expect(v.fragments).toHaveLength(5);
  expect(respond.mock.calls.every(call => call[1][0].content[0].text.length < 65_000)).toBe(true);
});
it('excluir una nota impide leerla para avisos y elimina sus derivados de nuevas consultas', async () => {
  await configure(); let v = await accept(await prepare()); const snapshot = v.effective!;
  const chat = (await post('/threads', { model: 'ficticio', scope: { memoria: false, library: false, notes: [], diagrams: false, attachments: false, prepareChanges: false } })).json();
  respond.mockImplementationOnce(async () => reply({ text: 'Respuesta ficticia' }));
  expect((await post(`/threads/${chat.id}/turns`, { text: 'Consulta', dirty: [], contextVersion: snapshot.version })).statusCode).toBe(200);
  await expect.poll(async () => (await t.app.inject('/api/assistant/threads/' + chat.id)).json().state).toBe('idle');
  const res = await post('/context', { ...body(v), selection: { ...v.selection, excluded: [{ root: 'notes', path: 'Contexto.md' }] } }); expect(res.statusCode).toBe(200);
  const read = fs.readFile.bind(fs); const spy = vi.spyOn(fs, 'readFile').mockImplementation((async (...args: any[]) => { if (String(args[0]).endsWith('/Contexto.md')) throw new Error('No debe leerse'); return (read as any)(...args); }) as typeof fs.readFile);
  v = await get(); expect(v.effective?.text).not.toContain('Resumen ficticio'); expect(v.fragments[0].valid).toBe(false);
  expect(spy.mock.calls.some(args => String(args[0]).endsWith('/Contexto.md'))).toBe(false);
  expect((await post(`/threads/${chat.id}/turns`, { text: 'Otra consulta', dirty: [] })).statusCode).toBe(409);
  expect((await t.app.inject('/api/assistant/threads/' + chat.id)).json().projectContexts[0].version).toBe(snapshot.version);
});
it('modificar, eliminar o excluir invalida propuestas y detecta 500 palabras sin contar dos veces', async () => {
  await configure(); let v = await accept(await prepare());
  await fs.writeFile(path.join(t.cfg.notesDir, 'Contexto.md'), 'cambio '.repeat(510));
  t.ctx.bus.change({ root: 'notes', path: 'Contexto.md', kind: 'change' });
  v = await get(); expect(v.changed.warn).toBe(true); expect(v.changed.files).toBe(1); expect(v.fragments[0].valid).toBe(false);
  expect((await get()).changed).toEqual(v.changed); expect(respond).toHaveBeenCalledTimes(1);
  v = await prepare(); await fs.unlink(path.join(t.cfg.notesDir, 'Contexto.md'));
  const p = v.proposals.at(-1)!; expect((await post(`/context/proposals/${p.id}/accept`, { ...body(v), fragments: p.fragments })).statusCode).toBe(409);
  expect(changedWords('uno dos tres', 'uno cuatro tres')).toBe(1);
});
it('detecta tres archivos y las concesiones empiezan cerradas al cambiar cuenta o raíces', async () => {
  await configure(true); await accept(await prepare());
  for (const name of ['uno.md', 'dos.md', 'tres.md']) await fs.writeFile(path.join(t.cfg.notesDir, name), 'Cambio ficticio');
  expect((await get()).changed.warn).toBe(true);
  account = 'otra-cuenta'; listeners.forEach(fn => fn()); expect((await get()).grants.prepareContext).toBe(false);
  const old = await get(); t.cfg.memoriaDir = path.join(t.dir, 'memoria-nueva'); await fs.mkdir(t.cfg.memoriaDir);
  const v = await get(); expect(v.project).not.toBe(old.project); expect(v.selection.mode).toBe('off');
  expect((await post('/context', { ...body(old), profile: old.profile })).statusCode).toBe(409);
});
it('dos clientes reciben 409 sin sobrescribir; valida revisiones y rutas', async () => {
  const v = await get();
  const responses = await Promise.all(['Tema uno', 'Tema dos'].map(topic => post('/context', { ...body(v), profile: { ...v.profile, topic } })));
  expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
  const current = await get(); expect(['Tema uno', 'Tema dos']).toContain(current.profile.topic);
  expect((await post('/context', { ...body(current), baseRev: undefined, profile: current.profile })).statusCode).toBe(400);
  expect((await post('/context', { ...body(current), selection: { ...current.selection, files: [{ root: 'notes', path: '../fuera.md' }] } })).statusCode).toBe(400);
});
it('genera propuestas recuperables de los quince tipos sin crear archivos y exige permiso propio', async () => {
  let v = await get();
  expect((await post('/diagram-generations', { ...body(v), model: 'ficticio', type: 'flujo', name: 'ficticio', description: 'Ejemplo' })).statusCode).toBe(403);
  await configure();
  for (const type of DIAGRAM_TYPES) {
    v = await get(); const res = await post('/diagram-generations', { ...body(v), model: 'ficticio', type, name: 'ejemplo-' + type, description: 'Esquema ficticio' }); expect(res.statusCode, res.body).toBe(200);
    await expect.poll(async () => (await t.app.inject('/api/assistant/diagram-generations')).json().items.at(-1).state).toBe('prepared');
  }
  expect((await t.app.inject('/api/assistant/diagram-generations')).json().items).toHaveLength(15);
  await expect(fs.stat(path.join(t.cfg.memoriaDir, 'diagramas/ejemplo-flujo.mmd'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('retirar permiso detiene una petición y no publica una propuesta tardía', async () => {
  let began!: () => void; const started = new Promise<void>(r => { began = r; });
  respond.mockImplementationOnce(async (_m, _input, _tools, signal) => { began(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Detenida')), { once: true })); return []; });
  let v = await configure(); await post('/context/prepare', { ...body(v), model: 'ficticio', dirty: [] }); await started;
  v = await get(); await post('/context', { ...body(v), grants: { ...v.grants, prepareContext: false } });
  await expect.poll(async () => (await get()).proposals.at(-1)?.state).toBe('cancelled');
  expect((await get()).proposals.at(-1)?.fragments).toEqual([]);
});
it('recupera contexto y propuestas tras reiniciar sin nuevas llamadas al proveedor', async () => {
  await configure(); const v = await accept(await prepare()); const calls = respond.mock.calls.length;
  const { buildApp } = await import('../src/app.ts');
  await t.app.close();
  const { app } = await buildApp(t.cfg, { serveWeb: false, configure: (app, ctx) => assistantRoutes(app, ctx, provider()) });
  try {
    const restored = (await app.inject('/api/assistant/context')).json();
    expect(restored.profile).toEqual(v.profile); expect(restored.effective).toEqual(v.effective); expect(restored.canUndo).toBe(true);
    expect(respond).toHaveBeenCalledTimes(calls);
  } finally { await app.close(); }
});
it('los documentos aún pendientes no se cuentan como cambios tras aceptar el primer lote y las bases no duplican el historial', async () => {
  await configure(true); const v = await accept(await prepare()); expect(v.changed.files).toBe(0);
  const stored = JSON.parse(await fs.readFile(path.join(t.cfg.dataDir, 'project-context', v.project, 'state.json'), 'utf8'));
  expect(stored.baselineFormat).toBe('refs'); expect(Object.values(stored.baselines).every(value => /^[a-f0-9]{16}$/.test(String(value)))).toBe(true);
  expect(await fs.readdir(path.join(t.cfg.dataDir, 'project-context', v.project, 'baselines'))).not.toHaveLength(0);
});
