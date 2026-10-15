import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { ChatGPT, verifyIdentity } from './chatgpt.mjs';
import { responseStream } from './chatgpt-responses.mjs';

const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: value => Buffer.from(value).map(b => b ^ 173), decryptString: value => Buffer.from(value).map(b => b ^ 173).toString() };
async function fixture(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-chatgpt-'));
  let url, exchanges = 0;
  const fetcher = async (target, init) => {
    if (target.endsWith('/oauth/token')) { exchanges++; return Response.json({ access_token: 'acceso-ficticio-' + exchanges, refresh_token: 'renovacion-ficticia-' + exchanges, id_token: 'identidad-ficticia', scope: scopes, expires_in: 3600 }); }
    if (target.endsWith('/openid-configuration')) return Response.json({ revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (target.endsWith('/revoke')) return new Response('');
    if (target.endsWith('/models')) return Response.json({ models: [{ slug: 'modelo-ficticio', display_name: 'Ficticio', visibility: 'list' }, { slug: 'oculto', visibility: 'hide' }] });
    throw new Error('Petición inesperada');
  };
  const optionsAll = { dataDir, safeStorage: storage, fetcher, openBrowser: value => { url = new URL(value); }, verify: async () => ({ iss: 'https://auth.openai.com', sub: 'persona-ficticia', email: 'persona@example.invalid' }), ...options };
  const client = await new ChatGPT(optionsAll).init();
  t.after(async () => { await client.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const finish = async (extra = {}) => {
    const callback = new URL(url.searchParams.get('redirect_uri'));
    for (const [key, value] of Object.entries({ state: url.searchParams.get('state'), code: 'codigo-ficticio', client_id: 'oaiapp_ficticio', ...extra })) callback.searchParams.set(key, value);
    return fetch(callback);
  };
  return { client, optionsAll, dataDir, finish, get url() { return url; }, get exchanges() { return exchanges; } };
}

test('OAuth usa PKCE, registra una cuenta y persiste credenciales cifradas reutilizables', async t => {
  const f = await fixture(t); await f.client.connect();
  assert.equal(f.url.origin, 'https://auth.openai.com'); assert.equal(f.url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(f.url.searchParams.get('code_challenge_method'), 'S256'); assert.match(f.url.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.equal((await f.finish({ state: 'incorrecto' })).status, 400); assert.equal(f.exchanges, 0);
  assert.equal((await f.finish()).status, 200);
  const view = f.client.view(); assert.equal(view.accounts.length, 1); assert.equal(view.accounts[0].enabled, true);
  assert.ok(!JSON.stringify(view).includes('acceso-ficticio'));
  const bytes = await fs.readFile(path.join(f.dataDir, 'chatgpt/accounts.enc')); assert.ok(!bytes.includes('acceso-ficticio'));
  const restored = await new ChatGPT(f.optionsAll).init(); t.after(() => restored.close());
  assert.equal(restored.view().active, view.active); assert.equal(restored.host, f.client.host);
  await restored.connect(view.active); assert.equal(f.url.searchParams.get('client_id'), 'oaiapp_ficticio');
  assert.equal(f.url.searchParams.has('agent_name_hint'), false);
  assert.deepEqual(await f.client.models(), [{ id: 'modelo-ficticio', name: 'Ficticio' }]);
});

test('la identidad OIDC verifica firma, audiencia, nonce y caducidad', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'ficticio';
  const keys = createLocalJWKSet({ keys: [jwk] });
  const token = await new SignJWT({ nonce: 'nonce-ficticio' }).setProtectedHeader({ alg: 'RS256', kid: 'ficticio' }).setIssuer('https://auth.openai.com').setAudience('oaiapp_ficticio').setSubject('persona').setExpirationTime('5m').sign(privateKey);
  assert.equal((await verifyIdentity(token, 'oaiapp_ficticio', 'nonce-ficticio', keys)).sub, 'persona');
  await assert.rejects(verifyIdentity(token, 'otra-audiencia', 'nonce-ficticio', keys));
  await assert.rejects(verifyIdentity(token, 'oaiapp_ficticio', 'otro-nonce', keys));
  const expired = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'ficticio' }).setIssuer('https://auth.openai.com').setAudience('oaiapp_ficticio').setSubject('persona').setExpirationTime(1).sign(privateKey);
  await assert.rejects(verifyIdentity(expired, 'oaiapp_ficticio', undefined, keys));
});

test('consentimiento rechazado conserva la cuenta activa y no intercambia un código', async t => {
  const f = await fixture(t); await f.client.connect(); await f.finish(); const active = f.client.active;
  await f.client.connect(); assert.equal((await f.finish({ error: 'access_denied' })).status, 400);
  assert.equal(f.client.active, active); assert.equal(f.exchanges, 1); assert.equal(f.client.view().pending, false);
});

test('una cuenta sin permiso solicita consentimiento explícito y rechaza otro cliente de retorno', async t => {
  const f = await fixture(t); await f.client.connect(); await f.finish();
  f.client.account().scopes = ['openid'];
  await assert.rejects(f.client.access(), e => e.code === 'consent');
  await f.client.connect(f.client.active); assert.equal(f.url.searchParams.get('prompt'), 'consent');
  assert.equal((await f.finish({ client_id: 'otro-cliente' })).status, 400);
  assert.equal(f.exchanges, 1);
});

test('serializa renovaciones rotatorias y desconecta sin exponer tokens', async t => {
  const f = await fixture(t); await f.client.connect(); await f.finish();
  f.client.account().expiresAt = 0;
  assert.deepEqual(await Promise.all([f.client.access(), f.client.access()]), ['acceso-ficticio-2', 'acceso-ficticio-2']);
  assert.equal(f.exchanges, 2);
  await f.client.disconnect(f.client.active); assert.equal(f.client.view().accounts[0].connected, false);
  await assert.rejects(f.client.access(), /Conecta/);
  const restored = await new ChatGPT(f.optionsAll).init(); t.after(() => restored.close()); assert.equal(restored.view().accounts[0].connected, false);
});

test('sin almacén seguro no persiste tokens y un archivo corrupto nunca se reemplaza', async t => {
  const f = await fixture(t, { safeStorage: { ...storage, isEncryptionAvailable: () => false } });
  await f.client.connect(); await f.finish(); assert.equal(f.client.view().persistent, false);
  await assert.rejects(fs.access(path.join(f.dataDir, 'chatgpt/accounts.enc')), { code: 'ENOENT' });
  await fs.writeFile(path.join(f.dataDir, 'chatgpt/accounts.enc'), 'corrupto');
  const broken = await new ChatGPT({ ...f.optionsAll, safeStorage: storage }).init(); t.after(() => broken.close());
  await assert.rejects(broken.connect()); assert.equal(await fs.readFile(path.join(f.dataDir, 'chatgpt/accounts.enc'), 'utf8'), 'corrupto');
});

test('SSE procesa UTF-8 fragmentado y exige el evento de finalización', async () => {
  const events = [{ type: 'response.output_text.delta', delta: 'Bibliografía ágil' }, { type: 'response.completed', response: { output: [{ type: 'message', content: [] }] } }];
  const bytes = new TextEncoder().encode(events.map(e => ': comentario\r\ndata: ' + JSON.stringify(e) + '\r\n\r\n').join(''));
  const seen = [];
  const result = await responseStream(new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } })), e => seen.push(e));
  assert.equal(result[0].type, 'message'); assert.equal(seen[0].delta, 'Bibliografía ágil');
  await assert.rejects(responseStream(new Response('data: {"type":"response.output_text.delta","delta":"incompleto"}\n\n')), /interrumpió/);
  await assert.rejects(responseStream(new Response('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Límite"}}}\n\n')), e => e.code === 'subscription_sharing_usage_limit_exceeded');
});
