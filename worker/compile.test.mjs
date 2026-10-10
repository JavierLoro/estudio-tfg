import assert from 'node:assert/strict';
import { test, before, after, mock } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { tarFiles } from './test-tar.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-compile-test-'));
process.env.OUT_DIR = path.join(scratch, 'out');
process.env.COMPILE_TIMEOUT_MS = '500';
const { server, compileEnvironment } = await import('./server.mjs');
let url;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/compile`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
});

function fakeEngine(t, mode = 'ok') {
  const calls = [], kills = [];
  let child;
  mock.method(process, 'kill', (pid, signal) => {
    kills.push({ pid, signal });
    if (signal === 'SIGTERM') setImmediate(() => child.emit('close', null, signal));
  });
  mock.method(childProcess, 'spawn', (command, args, options) => {
    calls.push({ command, args, options });
    child = new EventEmitter();
    child.pid = 123456;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => {
      if (mode === 'timeout' || mode === 'wait') return;
      if (mode === 'error') { child.emit('error', new Error('Motor ficticio no disponible')); return; }
      fs.writeFileSync(path.join(options.cwd, 'main.pdf'), '%PDF-1.7\nFicticio');
      fs.writeFileSync(path.join(options.cwd, 'main.log'), 'This is pdfTeX\n');
      fs.writeFileSync(path.join(options.cwd, 'main.synctex.gz'), zlib.gzipSync(`Input:1:${options.cwd}/main.tex\n`));
      child.stdout.write('Motor ficticio\n');
      child.emit('close', 0, null);
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
  return { calls, kills };
}

const compile = (files = { 'main.tex': 'Documento ficticio' }) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/x-tar' }, body: tarFiles(files),
});

test('el entorno de TeX no hereda secretos ni configuración ejecutable', () => {
  const env = compileEnvironment(path.join(scratch, 'runtime'));
  assert.equal(env.PATH, '/usr/local/bin:/usr/bin:/bin');
  assert.equal(env.openout_any, 'p');
  assert.equal(env.shell_escape, '0');
  for (const key of ['AUTH_TOKEN', 'LATEXMKRCSYS', 'PERL5OPT', 'LD_PRELOAD', 'TEXMFCNF', 'TEXINPUTS', 'BIBINPUTS', 'XDG_CONFIG_HOME']) {
    assert.equal(Object.hasOwn(env, key), false, key);
  }
  for (const key of ['HOME', 'TMPDIR', 'TEXMFHOME', 'TEXMFVAR', 'TEXMFCONFIG', 'TEXMFCACHE']) {
    assert.equal(path.dirname(env[key]), path.join(scratch, 'runtime'));
  }
});

test('compilar ignora rc, aísla temporales, conserva PDF/SyncTeX y borra el trabajo', async (t) => {
  const { calls, kills } = fakeEngine(t);
  const body = await (await compile({ 'main.tex': 'Ficticio', 'latexmkrc': 'No ejecutar' })).json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.diagnostics, []);
  const { command, args, options } = calls[0];
  assert.equal(command, 'latexmk');
  assert.ok(args.includes('-norc'));
  assert.ok(args.includes('-no-shell-escape'));
  assert.ok(args.includes('$biber = "biber --noconf %O %B";'));
  assert.equal(options.detached, true);
  assert.deepEqual(options.env, compileEnvironment(path.join(path.dirname(options.cwd), 'runtime')));
  assert.equal(fs.existsSync(path.dirname(options.cwd)), false);
  assert.equal(fs.readFileSync(path.join(process.env.OUT_DIR, body.pdf), 'utf8').slice(0, 5), '%PDF-');
  const syn = zlib.gunzipSync(fs.readFileSync(path.join(process.env.OUT_DIR, body.buildId, 'main.synctex.gz'))).toString();
  assert.equal(syn, 'Input:1:main.tex\n');
  assert.ok(kills.some(({ pid, signal }) => pid === -123456 && signal === 'SIGKILL'));
});

test('el timeout mata el grupo entero y no publica PDF', async (t) => {
  const { calls, kills } = fakeEngine(t, 'timeout');
  const body = await (await compile()).json();
  assert.equal(body.ok, false);
  assert.equal(body.pdf, null);
  assert.match(body.diagnostics[0].message, /Compilación cancelada/);
  assert.ok(kills.some(({ pid, signal }) => pid === -123456 && signal === 'SIGTERM'));
  assert.equal(fs.existsSync(path.dirname(calls[0].options.cwd)), false);
});

test('un fallo al arrancar el motor libera el trabajo y conserva el diagnóstico', async (t) => {
  const { calls } = fakeEngine(t, 'error');
  const body = await (await compile()).json();
  assert.equal(body.ok, false);
  assert.match(body.diagnostics[0].message, /Motor ficticio no disponible/);
  assert.equal(fs.existsSync(path.dirname(calls[0].options.cwd)), false);
});

test('la cola admite como máximo cuatro trabajos y vuelve a aceptar tras terminarlos', async (t) => {
  fakeEngine(t, 'wait');
  const requests = Array.from({ length: 4 }, () => compile());
  // Los cuatro POST entran antes del quinto: esperar a que se extraigan sus fuentes.
  await new Promise((resolve) => setTimeout(resolve, 40));
  const extra = await compile();
  assert.equal(extra.status, 503);
  assert.match((await extra.json()).error, /ocupado/);
  await Promise.all(requests.map(async (request) => assert.equal((await request).status, 200)));
  const next = await compile({ '../fuera.tex': 'No escribir' });
  assert.equal(next.status, 400);
});
