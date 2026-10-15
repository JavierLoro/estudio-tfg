// Entrada exclusiva de pruebas: el empaquetado no incluye test/.
import { ChatGPT } from '../../desktop/chatgpt.mjs';
let round = 0, sources = [];
ChatGPT.prototype.init = async function () { return this; };
ChatGPT.prototype.view = () => ({ accounts: [{ id: 'cuenta-ficticia', label: 'Persona ficticia', connected: true, enabled: true }], active: 'cuenta-ficticia', pending: false, persistent: false, error: '' });
ChatGPT.prototype.models = async () => [{ id: 'modelo-ficticio', name: 'Modelo ficticio' }];
const call = (name, args) => [{ type: 'function_call', namespace: 'estudio_tfg', name, arguments: JSON.stringify(args), call_id: 'ficticio-' + round }];
ChatGPT.prototype.respond = async (_model, input, _tools, signal, onEvent) => {
  signal.throwIfAborted(); round++;
  if (round === 1) return call('buscar_fuentes', { query: 'nf1-prueba' });
  if (round === 2) { sources = JSON.parse(input.at(-1).output); return call('leer_texto', { id: sources[0].id, offset: 0, length: 20_000 }); }
  if (round === 3) return call('leer_texto', { id: sources[1].id, offset: 0, length: 20_000 });
  if (round === 4) return call('proponer_cambios', { files: sources.slice(0, 2).map((s, i) => ({ id: s.id, after: `# Nota ficticia ${i}\n\nTexto revisado por el asistente de pruebas.\n` })) });
  const text = 'He preparado una propuesta para revisar. Las fuentes son ficticias y no se ha enviado contenido a OpenAI.';
  onEvent({ type: 'response.output_text.delta', delta: text });
  return [{ type: 'message', content: [{ type: 'output_text', text }] }];
};
await import('../../desktop/main.mjs');
