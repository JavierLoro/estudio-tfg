export class ChatGPTError extends Error {
  constructor(message, code = 'chatgpt_error', status = 502) { super(message); this.code = code; this.statusCode = status; }
}

export async function responseStream(response, onEvent = () => {}) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ChatGPTError(body.error?.message || body.detail || 'ChatGPT no pudo aceptar la consulta', body.error?.code, response.status);
  }
  if (!response.body) throw new ChatGPTError('ChatGPT devolvió una respuesta vacía');
  let pending = '', data = [], dataSize = 0, completed, outputSize = 0;
  const doneItems = new Map();
  const dispatch = () => {
    if (!data.length) return;
    const value = data.join('\n'); data = []; dataSize = 0;
    if (value === '[DONE]') return;
    const event = JSON.parse(value);
    if (event.type === 'response.failed' || event.type === 'error')
      throw new ChatGPTError(event.response?.error?.message || event.error?.message || event.message || 'La consulta a ChatGPT falló', event.response?.error?.code || event.code);
    if (event.type === 'response.incomplete') throw new ChatGPTError('ChatGPT no completó la respuesta', 'incomplete');
    if (event.type === 'response.output_item.done') {
      if (!Number.isInteger(event.output_index) || event.output_index < 0 || !event.item || typeof event.item !== 'object') throw new ChatGPTError('Elemento de respuesta de ChatGPT no válido');
      outputSize += value.length;
      if (outputSize > 32 * 1024 * 1024) throw new ChatGPTError('La respuesta de ChatGPT es demasiado grande');
      doneItems.set(event.output_index, event.item);
    }
    if (event.type === 'response.completed') completed = event.response;
    onEvent(event);
  };
  const line = value => {
    if (!value) dispatch();
    else if (value.startsWith('data:')) {
      dataSize += value.length;
      if (dataSize > 32 * 1024 * 1024) throw new ChatGPTError('Evento de ChatGPT demasiado grande');
      data.push(value.slice(5).replace(/^ /, ''));
    }
  };
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += value;
      if (pending.length > 32 * 1024 * 1024) throw new ChatGPTError('Evento de ChatGPT demasiado grande');
      let end;
      while ((end = pending.indexOf('\n')) >= 0) { line(pending.slice(0, end).replace(/\r$/, '')); pending = pending.slice(end + 1); }
    }
    if (pending) line(pending.replace(/\r$/, ''));
    dispatch();
    if (!completed || !Array.isArray(completed.output)) throw new ChatGPTError('Se interrumpió la respuesta de ChatGPT', 'interrupted');
    // El evento final puede omitir los elementos que ya llegaron completos por streaming.
    const output = new Map(completed.output.map((item, index) => [index, item]));
    for (const [index, item] of doneItems) output.set(index, item);
    const ordered = [...output].sort(([a], [b]) => a - b);
    if (ordered.some(([index], i) => index !== i)) throw new ChatGPTError('Se interrumpió la respuesta de ChatGPT', 'interrupted');
    if (!ordered.length) throw new ChatGPTError('ChatGPT no devolvió texto ni herramientas. Vuelve a intentar la consulta.', 'empty_response');
    return ordered.map(([, item]) => item);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
