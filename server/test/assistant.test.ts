import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { setup, canSymlink, type TestEnv } from './helpers.ts';
import { assistantRoutes, type AssistantProvider } from '../src/assistant.ts';
import { findSources, readSource, sourceId, validateScope, type AssistantSource } from '../src/assistantFiles.ts';
import { prepareChanges, applyChanges, privateJson } from '../src/assistantChanges.ts';
import { instanceId } from '../src/settings.ts';
import { rev } from '../src/fsutil.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.close(); env = undefined; });
const scope = { memoria: true, library: false, notes: ['Sistema'], prepareChanges: true, attachments: true };
const source = (root: 'memoria' | 'notes', rel: string): AssistantSource => ({ id: sourceId(root, rel), root, path: rel, title: rel });
const answer = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
const tool = (name: string, args: unknown) => [{ type: 'function_call', namespace: 'estudio_tfg', name, arguments: JSON.stringify(args), call_id: 'ficticio' }];
function provider(respond: AssistantProvider['respond'] = async () => answer('Respuesta ficticia')) {
  let active = 'cuenta-ficticia'; const listeners = new Set<() => void>();
  const view = () => ({ accounts: [{ id: active, label: 'Cuenta ficticia', connected: true, enabled: true }], active, pending: false, persistent: false, error: '' });
  return { view, connect: async () => view(), select: async (id: string) => { active = id; for (const fn of listeners) fn(); return view(); }, disconnect: async () => view(), cancelSignIn: async () => {},
    models: async () => [{ id: 'modelo-ficticio', name: 'Ficticio' }], respond, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, close: async () => {} } satisfies AssistantProvider;
}
async function fixture(p = provider(), auth = '') {
  env = await setup({ AUTH_TOKEN: auth }, { configure: (app, ctx) => assistantRoutes(app, ctx, p) }); return env;
}
async function thread(t: TestEnv) {
  const response = await t.app.inject({ method: 'POST', url: '/api/assistant/threads', payload: { scope, model: 'modelo-ficticio' } });
  expect(response.statusCode).toBe(200); return response.json();
}
async function finished(t: TestEnv, id: string) {
  let value: any;
  await expect.poll(async () => { value = (await t.app.inject('/api/assistant/threads/' + id)).json(); return value.state; }).not.toBe('running');
  return value;
}

describe('Asistente local', () => {
  it('no se registra en self-hosted y exige administración y token en escritorio', async () => {
    env = await setup(); expect((await env.app.inject('/api/assistant/account')).statusCode).toBe(404); await env.close(); env = undefined;
    const t = await fixture(provider(), 'token-ficticio');
    expect((await t.app.inject('/api/assistant/account')).statusCode).toBe(401);
    const response = await t.app.inject({ url: '/api/assistant/account', headers: { authorization: 'Bearer token-ficticio' } }); expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json())).not.toMatch(/accessToken|refreshToken/);
  });

  it('autoriza carpetas concretas sin filtrar notas ajenas ni enlaces hacia ellas', async () => {
    const t = await fixture();
    await fs.mkdir(path.join(t.cfg.notesDir, 'Privado'));
    await fs.writeFile(path.join(t.cfg.notesDir, 'Privado/Secreto.md'), 'arquitectura confidencial ficticia');
    if (await canSymlink('file')) await fs.symlink(path.join(t.cfg.notesDir, 'Privado/Secreto.md'), path.join(t.cfg.notesDir, 'Sistema/Enlace.md'));
    const results = await findSources(t.ctx, scope, 'arquitectura');
    expect(results.length).toBeGreaterThan(0); expect(results.every(s => s.root === 'memoria' || s.path.startsWith('Sistema/'))).toBe(true);
    expect(results.some(s => s.path === 'Sistema/Enlace.md')).toBe(false);
    await expect(readSource(t.ctx, scope, source('notes', 'Privado/Secreto.md'))).rejects.toThrow('alcance');
    await expect(readSource(t.ctx, scope, source('notes', 'Sistema/../../fuera.md'))).rejects.toThrow();
    await expect(validateScope(t.ctx, { memoria: true, library: false, notes: ['../'] })).rejects.toThrow();
  });

  it('ejecuta herramientas acotadas y conserva el historial completo para la continuación', async () => {
    const inputs: any[][] = []; let round = 0;
    const p = provider(async (_model, input) => {
      inputs.push(structuredClone(input)); round++;
      if (round === 1) return tool('buscar_fuentes', { query: 'arquitectura' });
      if (round === 2) { const results = JSON.parse(input.at(-1).output); return tool('leer_texto', { id: results[0].id, offset: 0, length: 20_000 }); }
      return answer('Fuente consultada');
    });
    const t = await fixture(p), chat = await thread(t);
    expect((await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Consulta la arquitectura', dirty: [] } })).statusCode).toBe(200);
    const result = await finished(t, chat.id);
    expect(result.state, JSON.stringify(result)).toBe('idle'); expect(result.messages.at(-1).text).toBe('Fuente consultada'); expect(result.sources.some((s: any) => s.rev)).toBe(true);
    expect(inputs[2].some(item => item.type === 'function_call_output')).toBe(true);
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(t.cfg.dataDir, 'assistant', chat.id + '.json'), 'utf8')).history.length).toBe(6);
    expect(result.history).toBeUndefined();
  });

  it('acepta PDF e imágenes válidos y nunca ejecuta herramientas desconocidas', async () => {
    const t = await fixture(provider(async (_m, input) => {
      expect(input[0].content.some((c: any) => c.type === 'input_file')).toBe(true);
      expect(input[0].content.some((c: any) => c.type === 'input_image')).toBe(true);
      return answer('Adjuntos ficticios consultados');
    }));
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'prueba.pdf'), '%PDF-1.7\nDocumento ficticio\n');
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'prueba.png'), Buffer.from([137,80,78,71,13,10,26,10,1]));
    const chat = await thread(t);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Consulta', dirty: [], context: [{ root: 'memoria', path: 'prueba.pdf' }, { root: 'memoria', path: 'prueba.png' }] } });
    expect((await finished(t, chat.id)).state).toBe('idle');
    await expect(readSource(t.ctx, scope, source('memoria', 'tfg.tex'), true)).rejects.toThrow('válido');
  });

  it('cambio de cuenta impide recuperar conversaciones de otra persona y corta la consulta', async () => {
    let started!: () => void; const began = new Promise<void>(resolve => { started = resolve; });
    const p = provider(async (_m, _input, _tools, signal) => { started(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelada')), { once: true })); return []; });
    const t = await fixture(p), chat = await thread(t);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Pregunta', dirty: [] } }); await began;
    await p.select('otra-cuenta');
    expect((await t.app.inject('/api/assistant/threads/' + chat.id)).statusCode).toBe(409);
    expect((await t.app.inject('/api/assistant/threads')).json().threads).toHaveLength(0);
    await p.select('cuenta-ficticia'); expect((await finished(t, chat.id)).state).toBe('cancelled');
  });

  it('mantiene respuestas fallidas sin dar por completado el turno y limita bucles', async () => {
    let calls = 0;
    const t = await fixture(provider(async () => { calls++; return tool('terminal_no_permitido', { command: 'no se ejecuta' }); })), chat = await thread(t);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Pregunta', dirty: [] } });
    const result = await finished(t, chat.id); expect(result.state).toBe('error'); expect(calls).toBe(8); expect(result.error).toContain('ocho rondas');
    expect((await t.app.inject('/api/assistant/threads/' + encodeURIComponent('../settings'))).statusCode).not.toBe(200);
  });

  it('rechaza contexto desbordado antes de consultar el modelo', async () => {
    let called = false;
    const t = await fixture(provider(async () => { called = true; return answer('No debería'); })), chat = await thread(t);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Pregunta', dirty: [], context: [{ root: 'memoria', path: 'tfg.tex', text: 'x'.repeat(100_001) }] } });
    expect((await finished(t, chat.id)).state).toBe('error'); expect(called).toBe(false);
  });

  it('reserva el turno antes de persistir para rechazar dos envíos simultáneos', async () => {
    const t = await fixture(provider(async (_m, _i, _t, signal) => {
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelada')), { once: true })); return [];
    })), chat = await thread(t);
    const send = () => t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Pregunta', dirty: [] } });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/cancel` });
    expect((await finished(t, chat.id)).state).toBe('cancelled');
  });

  it('borra los mensajes y adjuntos conservando únicamente los cambios necesarios para deshacer', async () => {
    let calls = 0;
    const candidate = source('notes', 'Sistema/Uno.md');
    const t = await fixture(provider(async () => ++calls === 1 ? tool('proponer_cambios', { files: [{ id: candidate.id, after: 'Texto nuevo' }] }) : answer('Respuesta privada ficticia')));
    await fs.writeFile(path.join(t.cfg.notesDir, candidate.path), 'Texto original');
    const chat = await thread(t);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Pregunta privada ficticia', dirty: [], context: [candidate] } });
    const result = await finished(t, chat.id), op = result.proposals[0];
    expect(op).toBeDefined();
    const operation = (action: string) => t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/proposals/${op.id}/${action}`, payload: { selected: [candidate.id], dirty: [] } });
    expect((await operation('apply')).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/assistant/threads/${chat.id}` })).json().archived).toBe(true);
    const stored = JSON.parse(await fs.readFile(path.join(t.cfg.dataDir, 'assistant', chat.id + '.json'), 'utf8'));
    expect(stored.history).toEqual([]); expect(stored.messages).toEqual([]); expect(stored.sources).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain('privada ficticia');
    expect((await operation('undo')).statusCode).toBe(200);
    expect(await fs.readFile(path.join(t.cfg.notesDir, candidate.path), 'utf8')).toBe('Texto original');
    await t.app.inject({ method: 'DELETE', url: `/api/assistant/threads/${chat.id}` });
    expect((await t.app.inject(`/api/assistant/threads/${chat.id}`)).statusCode).toBe(404);
  });
});

describe('Propuestas recuperables', () => {
  async function proposal(t: TestEnv) {
    await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema/Uno.md'), 'Texto uno');
    await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema/Dos.md'), 'Texto dos');
    const sources = ['Sistema/Uno.md', 'Sistema/Dos.md'].map(rel => ({ ...source('notes', rel), rev: rev(rel.endsWith('Uno.md') ? 'Texto uno' : 'Texto dos') }));
    return prepareChanges(t.ctx, scope, sources, { files: sources.map((s, i) => ({ id: s.id, after: `Nuevo ${i}` })) }, { thread: crypto.randomUUID(), account: 'ficticio', instance: instanceId(t.cfg) }, []);
  }
  it('aplica un subconjunto revisado, hace historial y deshace sin sobrescribir cambios nuevos', async () => {
    const t = await fixture(), op = await proposal(t), file = path.join(t.cfg.dataDir, 'assistant/operacion.json');
    const save = () => privateJson(file, op);
    await applyChanges(t.ctx, scope, op, save, [op.files[0].source.id]); expect(op.state).toBe('done'); expect(op.files).toHaveLength(1);
    expect(await fs.readFile(path.join(t.cfg.notesDir, 'Sistema/Uno.md'), 'utf8')).toBe('Nuevo 0');
    expect(await fs.readFile(path.join(t.cfg.notesDir, 'Sistema/Dos.md'), 'utf8')).toBe('Texto dos');
    await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema/Uno.md'), 'Edición posterior');
    await expect(applyChanges(t.ctx, scope, op, save, [], true)).rejects.toThrow('Cambió');
    await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema/Uno.md'), 'Nuevo 0');
    await applyChanges(t.ctx, scope, op, save, [], true); expect(op.state).toBe('undone');
    expect(await fs.readFile(path.join(t.cfg.notesDir, 'Sistema/Uno.md'), 'utf8')).toBe('Texto uno');
  });
  it('un 409 previo no escribe ningún archivo y los borradores impiden preparar el lote', async () => {
    const t = await fixture(), op = await proposal(t);
    await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema/Dos.md'), 'Cambio ajeno');
    await expect(applyChanges(t.ctx, scope, op, async () => {}, op.files.map(f => f.source.id))).rejects.toThrow('Cambió');
    expect(await fs.readFile(path.join(t.cfg.notesDir, 'Sistema/Uno.md'), 'utf8')).toBe('Texto uno');
    await expect(prepareChanges(t.ctx, scope, op.files.map(f => f.source), { files: [{ id: op.files[0].source.id, after: 'Cambio' }] }, { thread: op.thread, account: op.account, instance: op.instance }, ['notes:Sistema/Uno.md'])).rejects.toThrow('borrador');
  });
  it('una repetición simultánea no aplica un subconjunto distinto del ya revisado', async () => {
    const t = await fixture(), op = await proposal(t), [first, second] = op.files.map(f => f.source.id);
    await Promise.all([applyChanges(t.ctx, scope, op, async () => {}, [first]), applyChanges(t.ctx, scope, op, async () => {}, [second])]);
    expect(op.files.map(f => f.source.id)).toEqual([first]);
    expect(await fs.readFile(path.join(t.cfg.notesDir, 'Sistema/Dos.md'), 'utf8')).toBe('Texto dos');
  });
  it('impide editar mediante un alias que oculta un destino protegido', async () => {
    if (!await canSymlink('file')) return;
    const t = await fixture();
    await fs.mkdir(path.join(t.cfg.memoriaDir, 'estilo'), { recursive: true });
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'estilo/protegido.tex'), 'Texto protegido');
    await fs.symlink(path.join(t.cfg.memoriaDir, 'estilo/protegido.tex'), path.join(t.cfg.memoriaDir, 'alias.tex'));
    const s = { ...source('memoria', 'alias.tex'), rev: rev('Texto protegido') };
    await expect(prepareChanges(t.ctx, scope, [s], { files: [{ id: s.id, after: 'Cambio' }] }, { thread: crypto.randomUUID(), account: 'ficticio', instance: instanceId(t.cfg) }, [])).rejects.toThrow('original');
  });
  it('recupera un fallo después del primer archivo utilizando el registro persistido', async () => {
    const t = await fixture(), op = await proposal(t), file = path.join(t.cfg.dataDir, 'assistant/operacion.json');
    let failed = false;
    const save = async () => { await privateJson(file, op); if (op.files[0].applied && !failed) { failed = true; throw new Error('fallo ficticio'); } };
    await expect(applyChanges(t.ctx, scope, op, save, op.files.map(f => f.source.id))).rejects.toThrow('fallo ficticio');
    const recovered = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(recovered.state).toBe('applying'); expect(recovered.files[0].applied).toBe(true);
    await applyChanges(t.ctx, scope, recovered, () => privateJson(file, recovered), []);
    expect(recovered.state).toBe('done'); expect(await fs.readFile(path.join(t.cfg.notesDir, 'Sistema/Dos.md'), 'utf8')).toBe('Nuevo 1');
  });
  it('no permite modificar bibliografía gestionada, datos internos ni referencias inventadas', async () => {
    const t = await fixture();
    const candidate = { ...source('memoria', 'biblioteca/referencias.bib'), rev: rev('') };
    await expect(prepareChanges(t.ctx, scope, [candidate], { files: [{ id: candidate.id, after: 'No permitido' }] }, { thread: crypto.randomUUID(), account: 'ficticio', instance: instanceId(t.cfg) }, [])).rejects.toThrow('existentes');
    const tex = source('memoria', 'tfg.tex'); const text = await readSource(t.ctx, scope, tex); tex.rev = text.version;
    await expect(prepareChanges(t.ctx, scope, [tex], { files: [{ id: tex.id, after: text.text + '\n\\cite{referencia-inventada}' }] }, { thread: crypto.randomUUID(), account: 'ficticio', instance: instanceId(t.cfg) }, [])).rejects.toThrow('bibliográfica');
  });
});

describe('Permisos explícitos del asistente', () => {
  const none = { memoria: false, library: false, notes: [] };
  it('no reenvía el contexto de chats antiguos al continuar con permisos incompletos', async () => {
    let calls = 0;
    const p = provider(async () => { calls++; return answer('No debería enviarse'); }), t = await fixture(p), chat = await thread(t);
    const file = path.join(t.cfg.dataDir, 'assistant', chat.id + '.json'), stored = JSON.parse(await fs.readFile(file, 'utf8'));
    stored.scope = { memoria: true, library: false, notes: ['Sistema'] };
    stored.history = [{ role: 'user', content: [{ type: 'input_file', filename: 'ficticio.pdf', file_data: 'data:application/pdf;base64,ZmljdGljaW8=' }] }];
    await privateJson(file, stored);
    const reopened = Fastify();
    try {
      await assistantRoutes(reopened, t.ctx, p);
      expect((await reopened.inject(`/api/assistant/threads/${chat.id}`)).json().permissionsOutdated).toBe(true);
      expect((await reopened.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Continúa', dirty: [] } })).statusCode).toBe(403);
      expect(calls).toBe(0);
      expect(JSON.parse(await fs.readFile(file, 'utf8')).history).toEqual(stored.history);
    } finally { await reopened.close(); }
  });
  it('separa diagramas, adjuntos y propuestas sin ampliar permisos antiguos', async () => {
    const t = await fixture(), legacy = { memoria: true, library: false, notes: ['Sistema'] };
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'dibujo.mmd'), 'flowchart LR\n A-->B');
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'fuente.pdf'), '%PDF-1.7\nFicticio');
    const normalized = await validateScope(t.ctx, legacy);
    expect(normalized).toMatchObject({ diagrams: false, attachments: false, prepareChanges: false, documents: [] });
    await expect(readSource(t.ctx, normalized, source('memoria', 'tfg.tex'))).resolves.toBeDefined();
    await expect(readSource(t.ctx, legacy, source('memoria', 'dibujo.mmd'))).rejects.toThrow('alcance');
    await expect(readSource(t.ctx, legacy, source('memoria', 'fuente.pdf'), true)).rejects.toThrow('por separado');
    await expect(prepareChanges(t.ctx, legacy, [], {}, { thread: crypto.randomUUID(), account: 'ficticio', instance: instanceId(t.cfg) }, [])).rejects.toThrow('Autoriza preparar');
    const diagrams = { ...none, diagrams: true };
    await expect(readSource(t.ctx, diagrams, source('memoria', 'dibujo.mmd'))).resolves.toBeDefined();
    await expect(readSource(t.ctx, diagrams, source('memoria', 'tfg.tex'))).rejects.toThrow('alcance');
    expect((await findSources(t.ctx, diagrams, 'flowchart')).map(s => s.path)).toEqual(['dibujo.mmd']);
    await expect(readSource(t.ctx, { ...none, attachments: true }, source('memoria', 'fuente.pdf'), true)).rejects.toThrow('alcance');
    await expect(readSource(t.ctx, { ...legacy, attachments: true }, source('memoria', 'fuente.pdf'), true)).resolves.toBeDefined();
  });

  it('limita archivos concretos y rechaza rutas, enlaces y capacidades no implementadas', async () => {
    const t = await fixture();
    await fs.writeFile(path.join(t.cfg.notesDir, 'Sistema/Uno.md'), 'Texto ficticio exacto');
    const exact = await validateScope(t.ctx, { ...none, documents: [{ root: 'notes', path: 'Sistema/Uno.md' }] });
    await expect(readSource(t.ctx, exact, source('notes', 'Sistema/Uno.md'))).resolves.toBeDefined();
    await expect(readSource(t.ctx, exact, source('memoria', 'tfg.tex'))).rejects.toThrow('alcance');
    expect((await findSources(t.ctx, exact, 'ficticio')).map(s => s.path)).toEqual(['Sistema/Uno.md']);
    for (const patch of [{ attachments: 'sí' }, { prepareChanges: 1 }, { create: true }, { documents: [{ root: 'notes', path: '../oculto' }] }, { documents: [{ root: 'notes', path: '.env' }] }, { documents: [{ root: 'fuera', path: 'Uno.md' }] }]) {
      await expect(validateScope(t.ctx, { ...none, ...patch })).rejects.toThrow();
    }
    if (await canSymlink('file')) {
      await fs.symlink(path.join(t.cfg.notesDir, 'Sistema/Uno.md'), path.join(t.cfg.notesDir, 'alias.md'));
      await expect(validateScope(t.ctx, { ...none, documents: [{ root: 'notes', path: 'alias.md' }] })).rejects.toThrow('enlaces');
    }
  });

  it('no ofrece herramientas de escritura ni adjuntos sin permiso y deniega llamadas forzadas', async () => {
    const candidate = source('notes', 'Sistema/Uno.md'); let calls = 0;
    const t = await fixture(provider(async (_m, input, tools) => {
      expect(tools[0].tools.map((t: any) => t.name)).not.toContain('proponer_cambios');
      expect(tools[0].tools.map((t: any) => t.name)).not.toContain('consultar_adjunto');
      if (++calls === 1) return tool('proponer_cambios', { files: [{ id: candidate.id, after: 'No permitido' }] });
      expect(JSON.parse(input.at(-1).output).error).toContain('Autoriza preparar');
      return answer('Solo consulta');
    }));
    await fs.writeFile(path.join(t.cfg.notesDir, candidate.path), 'Texto original ficticio');
    const chat = (await t.app.inject({ method: 'POST', url: '/api/assistant/threads', payload: { scope: { ...none, documents: [candidate] } } })).json();
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Revisa', dirty: [], context: [candidate] } });
    const result = await finished(t, chat.id);
    expect(result.proposals).toHaveLength(0); expect(result.state).toBe('idle');
    expect(await fs.readFile(path.join(t.cfg.notesDir, candidate.path), 'utf8')).toBe('Texto original ficticio');
  });

  it('rechaza adjuntos iniciales y texto de fuentes ajenas antes de enviar nada al modelo', async () => {
    let calls = 0;
    const t = await fixture(provider(async () => { calls++; return answer('No debería enviarse'); }));
    await fs.writeFile(path.join(t.cfg.memoriaDir, 'fuente.pdf'), '%PDF-1.7\nDocumento ficticio');
    for (const context of [[{ root: 'memoria', path: 'fuente.pdf' }], [{ root: 'notes', path: 'Privado.md', text: 'Texto ajeno ficticio' }]]) {
      const chat = (await t.app.inject({ method: 'POST', url: '/api/assistant/threads', payload: { scope: { ...none, memoria: true } } })).json();
      await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Consulta', context, dirty: [] } });
      expect((await finished(t, chat.id)).state).toBe('error');
    }
    expect(calls).toBe(0);
  });

  it('retira acceso durante la respuesta y descarta herramientas y deltas tardíos', async () => {
    let began!: () => void, release!: () => void;
    const started = new Promise<void>(r => { began = r; }), wait = new Promise<void>(r => { release = r; });
    let rounds = 0;
    const t = await fixture(provider(async (_m, _i, _t, _signal, onEvent) => {
      rounds++; began(); await wait;
      onEvent({ type: 'response.output_text.delta', delta: 'Respuesta tardía ficticia' });
      return tool('buscar_fuentes', { query: 'arquitectura' });
    })), chat = await thread(t);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Consulta', dirty: [] } }); await started;
    const revoked = await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/revoke`, payload: {} });
    expect(revoked.json().revoked).toBe(true); release();
    const result = await finished(t, chat.id);
    expect(result.state).toBe('cancelled'); expect(result.revoked).toBe(true); expect(rounds).toBe(1); expect(result.sources).toEqual([]);
    expect(JSON.stringify(result.messages)).not.toContain('Respuesta tardía');
    expect((await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Otra', dirty: [] } })).statusCode).toBe(403);
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(t.cfg.dataDir, 'assistant', chat.id + '.json'), 'utf8')).revoked).toBe(true);
  });

  it('retirar acceso invalida una aplicación ya iniciada que esperaba el bloqueo de archivos', async () => {
    const candidate = source('notes', 'Sistema/Uno.md'); let calls = 0;
    const t = await fixture(provider(async () => ++calls === 1 ? tool('proponer_cambios', { files: [{ id: candidate.id, after: 'Nuevo ficticio' }] }) : answer('Propuesta preparada')));
    await fs.writeFile(path.join(t.cfg.notesDir, candidate.path), 'Original ficticio');
    const chat = await thread(t);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Prepara', context: [candidate], dirty: [] } });
    const result = await finished(t, chat.id), op = result.proposals[0];
    let locked!: () => void, release!: () => void;
    const began = new Promise<void>(r => { locked = r; }), wait = new Promise<void>(r => { release = r; });
    const lock = t.ctx.locks.run('notes:' + candidate.path, async () => { locked(); await wait; }); await began;
    let reached!: () => void;
    const queued = new Promise<void>(r => { reached = r; }), originalRun = t.ctx.locks.run.bind(t.ctx.locks);
    t.ctx.locks.run = <T>(key: string, fn: () => Promise<T>) => { if (key === 'notes:' + candidate.path) reached(); return originalRun(key, fn); };
    const applying = t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/proposals/${op.id}/apply`, payload: { selected: [candidate.id], dirty: [] } });
    const pending = applying.then(r => r);
    await queued;
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/revoke`, payload: {} });
    release(); await lock;
    expect((await pending).statusCode).toBe(403);
    expect(await fs.readFile(path.join(t.cfg.notesDir, candidate.path), 'utf8')).toBe('Original ficticio');
    expect((await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/proposals/${op.id}/undo`, payload: { dirty: [] } })).statusCode).toBe(409);
  });

  it('una conversación antigua puede deshacer lo ya aplicado sin preparar nuevos cambios', async () => {
    const t = await fixture(), candidate = source('notes', 'Sistema/Uno.md');
    await fs.writeFile(path.join(t.cfg.notesDir, candidate.path), 'Original ficticio');
    const op = await prepareChanges(t.ctx, scope, [{ ...candidate, rev: rev('Original ficticio') }], { files: [{ id: candidate.id, after: 'Nuevo ficticio' }] }, { thread: crypto.randomUUID(), account: 'ficticio', instance: instanceId(t.cfg) }, []);
    await applyChanges(t.ctx, scope, op, async () => {}, [candidate.id]);
    await applyChanges(t.ctx, { ...scope, prepareChanges: undefined }, op, async () => {}, [], true);
    expect(await fs.readFile(path.join(t.cfg.notesDir, candidate.path), 'utf8')).toBe('Original ficticio');
  });

  it('conserva la recuperación local tras revocar sin permitir aplicar más propuestas', async () => {
    const candidate = source('notes', 'Sistema/Uno.md'); let calls = 0;
    const t = await fixture(provider(async () => ++calls === 1 ? tool('proponer_cambios', { files: [{ id: candidate.id, after: 'Nuevo ficticio' }] }) : answer('Lista para revisar')));
    await fs.writeFile(path.join(t.cfg.notesDir, candidate.path), 'Original ficticio');
    const chat = await thread(t);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/turns`, payload: { text: 'Prepara', context: [candidate], dirty: [] } });
    const op = (await finished(t, chat.id)).proposals[0];
    const operate = (action: string) => t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/proposals/${op.id}/${action}`, payload: { selected: [candidate.id], dirty: [] } });
    expect((await operate('apply')).statusCode).toBe(200);
    await t.app.inject({ method: 'POST', url: `/api/assistant/threads/${chat.id}/revoke`, payload: {} });
    expect((await operate('apply')).statusCode).toBe(403);
    expect((await operate('undo')).statusCode).toBe(200);
    expect(await fs.readFile(path.join(t.cfg.notesDir, candidate.path), 'utf8')).toBe('Original ficticio');
    expect(calls).toBe(2);
  });
});
