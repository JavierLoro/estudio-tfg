import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setup, canSymlink, type TestEnv } from './helpers.ts';
import { assistantRoutes, type AssistantProvider } from '../src/assistant.ts';
import { findSources, readSource, sourceId, validateScope, type AssistantSource } from '../src/assistantFiles.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.close(); env = undefined; });
const scope = { memoria: true, library: false, notes: ['Sistema'] };
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
    const persisted = JSON.parse(await fs.readFile(path.join(t.cfg.dataDir, 'assistant', chat.id + '.json'), 'utf8'));
    expect(persisted.history).toHaveLength(6); expect(result.history).toBeUndefined();
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

});
