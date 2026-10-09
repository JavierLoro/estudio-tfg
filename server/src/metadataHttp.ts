import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

export const METADATA_LIMIT = 1024 * 1024;
const TIMEOUT = 4000;
class MetadataError extends Error {}
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const blocked = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
  ['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],
  ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
] as const) blocked.addSubnet(ip, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [ip, prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked.addSubnet(ip, prefix, 'ipv6');

/** Política conservadora: solo IPv4 pública o IPv6 global sin rangos especiales/transición. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
function checkedUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new MetadataError('URL no válida para consultar metadatos'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || input.length > 8192) throw new MetadataError('Solo se consultan URLs HTTP/HTTPS sin credenciales');
  return url;
}
export interface MetadataResponse { status: number; headers: Record<string, string | undefined>; body: Buffer }
export interface MetadataDependencies {
  lookup: (hostname: string) => Promise<{ address: string; family: number }[]>;
  request: (url: URL, address: { address: string; family: number }, signal: AbortSignal) => Promise<MetadataResponse>;
}
export type MetadataFetcher = (input: string) => Promise<MetadataResponse>;

/** Conexión nueva a la IP validada, conservando Host y la validación TLS del nombre original. */
export const requestMetadata: MetadataDependencies['request'] = (url, address, signal) => new Promise((resolve, reject) => {
  const request = (url.protocol === 'https:' ? https : http).request(url, {
    agent: false, signal, family: address.family, maxHeaderSize: 8192,
    lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    headers: { 'user-agent': 'EstudioTFG metadata', accept: 'text/html,application/xhtml+xml,application/json', 'accept-encoding': 'identity' },
  }, (res) => {
    const status = res.statusCode ?? 0;
    const headers = Object.fromEntries(Object.entries(res.headers).map(([k,v]) => [k, Array.isArray(v) ? v.join(', ') : v]));
    if (REDIRECTS.has(status) || status < 200 || status >= 300) {
      res.destroy(); resolve({ status, headers, body: Buffer.alloc(0) }); return;
    }
    const type = headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (type && !['text/html','application/xhtml+xml','application/json','text/plain'].includes(type) && !type.endsWith('+json')) {
      res.destroy(); reject(new MetadataError('La URL no devuelve metadatos de texto; no se descargan adjuntos automáticamente')); return;
    }
    if (Number(headers['content-length']) > METADATA_LIMIT || (headers['content-encoding'] && headers['content-encoding'] !== 'identity')) {
      res.destroy(); reject(new MetadataError('Metadatos demasiado grandes o comprimidos')); return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > METADATA_LIMIT) { res.destroy(); reject(new MetadataError('Los metadatos superan 1 MB')); }
      else chunks.push(chunk);
    });
    res.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks) }));
    res.on('error', reject);
    res.on('aborted', () => reject(new MetadataError('La respuesta de metadatos se interrumpió')));
  });
  request.on('error', reject);
  request.on('upgrade', (_res, socket) => { socket.destroy(); reject(new MetadataError('Respuesta de metadatos no permitida')); });
  request.end();
});

/** Resolver/transporte inyectables solo desde código; no hay excepciones configurables de red. */
export function createMetadataFetcher(dependencies: MetadataDependencies = {
  lookup: (hostname) => dns.lookup(hostname, { all: true, verbatim: true }), request: requestMetadata,
}): MetadataFetcher {
  let active = 0;
  return async (input) => {
    if (active >= 4) throw new MetadataError('Hay demasiadas consultas de metadatos; puedes completar el recurso manualmente');
    active++;
    const controller = new AbortController();
    const expired = new MetadataError('La consulta de metadatos superó 4 segundos');
    const timer = setTimeout(() => controller.abort(expired), TIMEOUT);
    const run = (async () => {
      let url = checkedUrl(input);
      for (let hops = 0; ; hops++) {
        const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
        const literal = isIP(hostname);
        const addresses = literal ? [{ address: hostname, family: literal }] : await dependencies.lookup(hostname);
        controller.signal.throwIfAborted();
        if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address) || isIP(a.address) !== a.family)) throw new MetadataError('Destino privado o reservado: se conserva la referencia sin consultarlo');
        // El transporte recibe esta IP fija; no vuelve a resolver DNS al conectar (rebinding).
        const response = await dependencies.request(url, addresses[0], controller.signal);
        controller.signal.throwIfAborted();
        if (REDIRECTS.has(response.status)) {
          if (hops >= 3 || !response.headers.location) throw new MetadataError('Demasiadas redirecciones o destino de redirección ausente');
          url = checkedUrl(new URL(response.headers.location, url).href);
          continue;
        }
        if (response.status < 200 || response.status >= 300) throw new MetadataError(`El servidor de metadatos respondió HTTP ${response.status}`);
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new MetadataError('Metadatos comprimidos no permitidos');
        if (Number(response.headers['content-length']) > METADATA_LIMIT || response.body.length > METADATA_LIMIT) throw new MetadataError('Los metadatos superan 1 MB');
        const type = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
        if (type && !['text/html','application/xhtml+xml','application/json','text/plain'].includes(type) && !type.endsWith('+json')) throw new MetadataError('La URL no devuelve metadatos de texto; no se descargan adjuntos automáticamente');
        return response;
      }
    })().finally(() => { active--; clearTimeout(timer); });
    // El límite incluye DNS; una resolución no cancelable retiene su plaza hasta terminar.
    let onAbort: () => void = () => {};
    const abort = new Promise<never>((_resolve, reject) => { onAbort = () => reject(expired); controller.signal.addEventListener('abort', onAbort, { once: true }); });
    try { return await Promise.race([run, abort]); }
    catch (e) {
      if (e instanceof MetadataError) throw e;
      throw new MetadataError('No se pudo conectar o resolver el servidor de metadatos');
    }
    finally { controller.signal.removeEventListener('abort', onAbort); }
  };
}
export const fetchPublicMetadata = createMetadataFetcher();
