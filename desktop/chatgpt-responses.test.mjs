import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseStream } from './chatgpt-responses.mjs';

const stream = events => new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''));
const call = { type: 'function_call', id: 'llamada-ficticia', namespace: 'estudio_tfg', name: 'proponer_cambios', call_id: 'ficticio', arguments: '{"files":[]}' };
const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Respuesta ficticia' }] };

test('recupera herramientas y razonamiento finalizados aunque completed.output esté vacío', async () => {
  const reasoning = { type: 'reasoning', id: 'razonamiento-ficticio', encrypted_content: 'cifrado-ficticio-completo', summary: [] };
  const output = await responseStream(stream([
    { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, encrypted_content: 'incompleto' } },
    { type: 'response.output_item.done', output_index: 1, item: call },
    { type: 'response.output_item.done', output_index: 0, item: reasoning },
    { type: 'response.completed', response: { output: [] } },
  ]));
  assert.deepEqual(output, [reasoning, call]);
});

test('conserva el texto completo en el historial además de emitir los deltas', async () => {
  const seen = [];
  const output = await responseStream(stream([
    { type: 'response.output_text.delta', delta: 'Respuesta ficticia' },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response: { output: [] } },
  ]), event => seen.push(event));
  assert.deepEqual(output, [message]); assert.equal(seen[0].delta, 'Respuesta ficticia');
});

test('une output final y elementos terminados por índice, sin duplicar llamadas', async () => {
  const output = await responseStream(stream([
    { type: 'response.output_item.done', output_index: 0, item: call },
    { type: 'response.output_item.done', output_index: 0, item: call },
    { type: 'response.completed', response: { output: [{ ...call, arguments: '' }, message] } },
  ]));
  assert.deepEqual(output, [call, message]);
});

test('no devuelve herramientas antes de completed ni acepta resultados incompletos', async () => {
  await assert.rejects(responseStream(stream([{ type: 'response.output_item.done', output_index: 0, item: call }])), error => error.code === 'interrupted');
  await assert.rejects(responseStream(stream([
    { type: 'response.output_item.done', output_index: 0, item: call },
    { type: 'response.incomplete', response: { output: [call] } },
  ])), error => error.code === 'incomplete');
  await assert.rejects(responseStream(stream([
    { type: 'response.output_item.done', output_index: 1, item: call },
    { type: 'response.completed', response: { output: [] } },
  ])), error => error.code === 'interrupted');
  await assert.rejects(responseStream(stream([{ type: 'response.completed', response: { output: [] } }])), error => error.code === 'empty_response');
});

test('rechaza índices no válidos sin crear arrays dispersos ni ejecutar llamadas', async () => {
  for (const output_index of [-1, 0.5, '0']) await assert.rejects(responseStream(stream([
    { type: 'response.output_item.done', output_index, item: call },
    { type: 'response.completed', response: { output: [] } },
  ])), /no válido/);
  await assert.rejects(responseStream(stream([
    { type: 'response.output_item.done', output_index: 1_000_000_000, item: call },
    { type: 'response.completed', response: { output: [] } },
  ])), error => error.code === 'interrupted');
});
