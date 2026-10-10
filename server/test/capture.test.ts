import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMetadataFetcher } from '../src/metadataHttp.ts';
import { extractTitle, localDate, sanitizeTitle } from '../src/capture.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import { multipart, setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
const siteUrl = 'https://public.example';

beforeEach(async () => {
  const fetchMetadata = createMetadataFetcher({
    lookup: async () => [{address:'8.8.8.8',family:4}],
    request: async (url, _address, signal) => {
      if (url.pathname === '/slow') await new Promise<void>((resolve,reject) => {
        const timer = setTimeout(resolve,6000);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, {once:true});
      });
      const body = url.pathname === '/og' ? '<html><head><title>Fallback</title><meta property="og:title" content="Artículo &amp; OG"></head></html>'
        : '<html><head><title>\n  Página de prueba: TFG  \n</title></head></html>';
      return {status:200,headers:{'content-type':'text/html'},body:Buffer.from(body)};
    },
  });
  t = await setup({}, {fetchMetadata});
});
afterEach(async () => t.close());

async function post(fields: Record<string, string>, file?: { name: string; data: Buffer; type?: string }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('file', new Blob([new Uint8Array(file.data)], { type: file.type ?? 'application/octet-stream' }), file.name);
  const { payload, headers } = await multipart(fd);
  return t.app.inject({ method: 'POST', url: '/api/capture', payload, headers });
}

async function read(rel: string) {
  return fs.readFile(path.join(t.cfg.notesDir, rel), 'utf8');
}

const today = () => localDate();

describe('helpers', () => {
  it('extractTitle prefers og:title and decodes entities', () => {
    expect(extractTitle('<title>A</title><meta content="B &quot;x&quot;" property="og:title">')).toBe('B "x"');
    expect(extractTitle('<title> Hola &amp; adiós </title>')).toBe('Hola & adiós');
    expect(extractTitle('<p>nada</p>')).toBeNull();
  });
  it('sanitizeTitle removes path and forbidden chars', () => {
    expect(sanitizeTitle('a/b\\c:d*e?"f<g>h|i#j^k[l]')).toBe('a b c d e f g h i j k l');
    expect(sanitizeTitle('../../etc')).toBe('etc');
    expect(sanitizeTitle('   ')).toBe('recurso');
  });
});

describe('POST /api/capture', () => {
  it('url without title: fetches <title>', async () => {
    const res = await post({ url: `${siteUrl}/page`, tags: 'ia, tfg ,#lectura' });
    expect(res.statusCode).toBe(200);
    const { path: p, title } = res.json();
    expect(title).toBe('Página de prueba: TFG');
    expect(p).toBe(`Recursos/${today()} Página de prueba TFG.md`);
    const content = await read(p);
    const { data, body } = parseFrontmatter(content);
    expect(data).toMatchObject({ type: 'resource', title: 'Página de prueba: TFG', url: `${siteUrl}/page`, status: 'inbox', tags: ['recurso', 'ia', 'tfg', 'lectura'] });
    expect(data.captured).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(data.attachment).toBeUndefined();
    expect(body.trim()).toBe('');
    // field order matches the contract
    expect(content.split('\n').slice(0, 6)).toEqual(['---', 'type: resource', 'title: "Página de prueba: TFG"', `url: ${siteUrl}/page`, `captured: ${data.captured}`, 'status: inbox']);
  });

  it('url: prefers og:title', async () => {
    const res = await post({ url: `${siteUrl}/og` });
    expect(res.json().title).toBe('Artículo & OG');
  });

  it('unreachable url falls back to the host', async () => {
    const res = await post({ url: 'http://127.0.0.1:1/algo', note: 'leer luego' });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('127.0.0.1');
    const { data, body } = parseFrontmatter(await read(res.json().path));
    expect(data.url).toBe('http://127.0.0.1:1/algo');
    expect(body.trim()).toBe('leer luego');
  });

  it('title fetch times out after ~4 s and uses the host', async () => {
    const t0 = Date.now();
    const res = await post({ url: `${siteUrl}/slow` });
    expect(Date.now() - t0).toBeLessThan(5500);
    expect(res.json().title).toBe('public.example');
    expect(res.json().warning).toContain('4 segundos');
  }, 10000);

  it('explicit title skips the fetch', async () => {
    const res = await post({ url: 'http://127.0.0.1:1/x', title: 'Mi título' });
    expect(res.json()).toEqual({ path: `Recursos/${today()} Mi título.md`, title: 'Mi título' });
  });

  it('note only', async () => {
    const res = await post({ note: 'Idea: usar CRDT para el editor\nmás detalles' });
    expect(res.statusCode).toBe(200);
    const { data, body } = parseFrontmatter(await read(res.json().path));
    expect(data.title).toBe('Idea: usar CRDT para el editor');
    expect(data.url).toBeUndefined();
    expect(body).toBe('\nIdea: usar CRDT para el editor\nmás detalles\n');
  });

  it('file upload goes to adjuntos/ and is referenced in frontmatter', async () => {
    const data = Buffer.from('%PDF-1.4 fake');
    const res = await post({ tags: 'paper' }, { name: 'Paper: CRDTs?.pdf', data, type: 'application/pdf' });
    expect(res.statusCode).toBe(200);
    const fm = parseFrontmatter(await read(res.json().path)).data;
    expect(fm.title).toBe('Paper: CRDTs?');
    expect(fm.attachment).toBe('adjuntos/Paper CRDTs.pdf');
    const saved = await fs.readFile(path.join(t.cfg.notesDir, 'Recursos', 'adjuntos', 'Paper CRDTs.pdf'));
    expect(saved.equals(data)).toBe(true);
    // no temp uploads left
    const left = await fs.readdir(path.join(t.cfg.notesDir, 'Recursos', 'adjuntos'));
    expect(left).toEqual(['Paper CRDTs.pdf']);
  });

  it('name collisions get " 2", " 3" suffixes (notes and attachments)', async () => {
    const f = { name: 'doc.txt', data: Buffer.from('uno') };
    const r1 = await post({ title: 'Igual' }, f);
    const r2 = await post({ title: 'Igual' }, { ...f, data: Buffer.from('dos') });
    const r3 = await post({ title: 'Igual' }, { ...f, data: Buffer.from('tres') });
    expect([r1, r2, r3].map((r) => r.json().path)).toEqual([
      `Recursos/${today()} Igual.md`,
      `Recursos/${today()} Igual 2.md`,
      `Recursos/${today()} Igual 3.md`,
    ]);
    const adj = path.join(t.cfg.notesDir, 'Recursos', 'adjuntos');
    expect(await fs.readFile(path.join(adj, 'doc.txt'), 'utf8')).toBe('uno');
    expect(await fs.readFile(path.join(adj, 'doc 2.txt'), 'utf8')).toBe('dos');
    expect(await fs.readFile(path.join(adj, 'doc 3.txt'), 'utf8')).toBe('tres');
    expect(parseFrontmatter(await read(r3.json().path)).data.attachment).toBe('adjuntos/doc 3.txt');
  });

  it('requires url, note or file', async () => {
    const res = await post({ title: 'solo título', tags: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('frontmatter stays valid YAML with tricky values', async () => {
    const res = await post({ url: 'https://ex.com/a?b=1#frag', title: 'Dice "hola": sí # no', tags: 'a: b, c' });
    const content = await read(res.json().path);
    const yamlPart = content.split('---')[1];
    const data = YAML.parse(yamlPart);
    expect(data.title).toBe('Dice "hola": sí # no');
    expect(data.url).toBe('https://ex.com/a?b=1#frag');
    expect(data.tags).toEqual(['recurso', 'a:-b', 'c']);
  });

  it('accepts JSON body too', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/capture', payload: { note: 'json', title: 'J' } });
    expect(res.statusCode).toBe(200);
  });
});


it('conserva una URL privada como recurso manual con aviso, sin consultar el servidor', async () => {
  const response = await post({url:'http://127.0.0.1/privado',note:'Referencia ficticia privada'});
  expect(response.statusCode).toBe(200);
  expect(response.json().warning).toContain('Destino privado');
  expect(parseFrontmatter(await read(response.json().path)).data.url).toBe('http://127.0.0.1/privado');
});

it('el recibo conserva el aviso de metadatos al reintentar', async () => {
  const {libraryId} = await import('../src/captureOperations.ts');
  const input={url:'http://127.0.0.1/privado',operationId:'metadatos-privados',libraryId:libraryId(t.cfg)};
  const first=await t.app.inject({method:'POST',url:'/api/capture',payload:input});
  const second=await t.app.inject({method:'POST',url:'/api/capture',payload:input});
  expect(first.statusCode).toBe(200);
  expect(second.json()).toEqual(first.json());
  expect(second.json().warning).toContain('Destino privado');
});
