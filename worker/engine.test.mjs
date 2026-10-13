import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { compile, compileEnvironment, run, svgToPdf } from './engine.mjs';

function fakeSpawn(t, onCall) {
  const calls = [];
  mock.method(childProcess, 'spawn', (cmd, args, options) => {
    const child = new EventEmitter();
    child.pid = 987654;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit('close', null, 'SIGTERM');
    calls.push({ cmd, args, options, child });
    setImmediate(() => onCall(calls.at(-1)));
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
  return calls;
}

test('entorno local aislado en POSIX y Windows con binarios explícitos y sin credenciales', () => {
  const posix = compileEnvironment('/tmp/ficticio/runtime', { platform: 'linux', tools: { latexmk: '/opt/tex/bin/latexmk', biber: '/opt/biber/bin/biber' } });
  assert.equal(posix.PATH, '/opt/tex/bin:/opt/biber/bin:/usr/local/bin:/usr/bin:/bin');
  assert.equal(posix.TMP, '/tmp/ficticio/runtime/tmp');
  const win = compileEnvironment('C:\\Temp\\ficticio\\runtime', { platform: 'win32', windowsRoot: 'C:\\Windows', tools: { latexmk: 'C:\\Program Files\\TeX\\bin\\latexmk.exe' } });
  assert.equal(win.PATH, 'C:\\Program Files\\TeX\\bin;C:\\Windows\\System32;C:\\Windows');
  assert.equal(win.USERPROFILE, 'C:\\Temp\\ficticio\\runtime\\home');
  assert.equal(win.APPDATA, path.win32.join(win.USERPROFILE, 'AppData', 'Roaming'));
  assert.equal(win.LOCALAPPDATA, path.win32.join(win.USERPROFILE, 'AppData', 'Local'));
  for (const env of [posix, win]) for (const key of ['AUTH_TOKEN', 'PERL5OPT', 'LD_PRELOAD', 'TEXMFCNF', 'BIBINPUTS', 'LATEXMKRCSYS']) assert.equal(Object.hasOwn(env, key), false, key);
  assert.throws(() => compileEnvironment('/tmp/ficticio', { tools: { latexmk: 'latexmk' } }), /absolutas/);
  for (const name of ['%USERPROFILE%', '!VARIABLE!', '"comilla']) {
    assert.throws(() => compileEnvironment('C:\\Temp\\runtime', { platform: 'win32', tools: { biber: `C:\\TeX\\${name}\\biber.exe` } }), /expansiones de cmd/);
  }
});

test('cancelación POSIX mata el grupo y libera el proceso', async (t) => {
  const kills = [];
  const calls = fakeSpawn(t, () => {});
  mock.method(process, 'kill', (pid, signal) => {
    kills.push([pid, signal]);
    if (signal === 'SIGTERM') setImmediate(() => calls[0].child.emit('close', null, signal));
  });
  const signal = new AbortController();
  const pending = run('/usr/bin/ficticio', [], { cwd: os.tmpdir(), timeoutMs: 10_000, env: {}, signal: signal.signal, platform: 'linux' });
  signal.abort();
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
  assert.deepEqual(kills, [[-987654, 'SIGTERM'], [-987654, 'SIGKILL']]);
});

test('timeout Windows usa taskkill absoluto con /T /F sin shell', async (t) => {
  const calls = fakeSpawn(t, ({ cmd }) => {
    if (cmd.endsWith('taskkill.exe')) calls[0].child.emit('close', null, 'SIGTERM');
  });
  const result = await run('C:\\TeX\\latexmk.exe', [], { cwd: os.tmpdir(), timeoutMs: 10, env: { SystemRoot: 'C:\\Windows' }, platform: 'win32' });
  assert.equal(result.timedOut, true);
  assert.equal(calls[0].options.detached, false);
  assert.equal(calls[1].cmd, 'C:\\Windows\\System32\\taskkill.exe');
  assert.deepEqual(calls[1].args, ['/pid', '987654', '/T', '/F']);
  assert.equal(calls[1].options.shell, undefined);
});

test('señal ya cancelada no inicia herramientas', async (t) => {
  const calls = fakeSpawn(t, () => {});
  const result = await run('ficticio', [], { cwd: os.tmpdir(), env: {}, timeoutMs: 1000, signal: AbortSignal.abort() });
  assert.equal(result.cancelled, true);
  assert.equal(calls.length, 0);
});

test('timeout termina una herramienta real de prueba en esta plataforma', async () => {
  const env = compileEnvironment(path.join(os.tmpdir(), 'motor-ficticio-runtime'), { tools: { latexmk: process.execPath } });
  const result = await run(process.execPath, ['-e', 'console.log("Proceso ficticio"); setInterval(() => {}, 1000)'], { cwd: os.tmpdir(), timeoutMs: 1500, env });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Proceso ficticio/);
});

test('compilación compartida cita binarios con espacios y conserva restricciones', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-engine-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sources = path.join(dir, 'sources');
  await fs.mkdir(sources);
  await fs.writeFile(path.join(sources, 'main.tex'), 'Ficticio');
  mock.method(process, 'kill', () => {});
  const calls = fakeSpawn(t, async ({ options, child }) => {
    await fs.writeFile(path.join(options.cwd, 'main.pdf'), '%PDF-1.7\nFicticio');
    await fs.writeFile(path.join(options.cwd, 'main.log'), 'This is pdfTeX\n');
    child.emit('close', 0, null);
  });
  const tools = { latexmk: '/opt/TeX ficticio/bin/latexmk', biber: '/opt/TeX ficticio/bin/biber', pdflatex: '/opt/TeX ficticio/bin/pdflatex' };
  const result = await compile({ main: 'main.tex', workDir: sources, outDir: path.join(dir, 'out'), buildId: 'ficticio', tools });
  assert.equal(result.ok, true);
  assert.equal(calls[0].cmd, tools.latexmk);
  const quoted = (name) => process.platform === 'win32' ? `\\"/opt/TeX ficticio/bin/${name}\\"` : `'/opt/TeX ficticio/bin/${name}'`;
  assert.ok(calls[0].args.includes(`$biber = "${quoted('biber')} --noconf %O %B";`));
  assert.ok(calls[0].args.includes(`$pdflatex = "${quoted('pdflatex')} %O %S";`));
  assert.ok(calls[0].args.includes('-norc'));
  assert.ok(calls[0].args.includes('-no-shell-escape'));
  assert.equal(calls[0].options.env.HOME, path.join(dir, 'runtime', 'home'));
});

test('Perl y shell conservan rutas literales con sustituciones y apóstrofos', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-shell-literal-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sources = path.join(dir, 'sources');
  const bin = path.join(dir, "$(touch marcador-dollar) `touch marcador-backtick` 'apóstrofo");
  await fs.mkdir(sources); await fs.mkdir(bin);
  await fs.writeFile(path.join(sources, 'main.tex'), 'Ficticio');
  const tool = path.join(bin, 'biber');
  await fs.writeFile(tool, '#!/bin/sh\nprintf "Auxiliar ficticio\\n"\n', { mode: 0o755 });
  mock.method(process, 'kill', () => {});
  const calls = fakeSpawn(t, ({ child }) => child.emit('close', 1, null));
  await compile({ main: 'main.tex', workDir: sources, outDir: path.join(dir, 'out'), buildId: 'ficticio', tools: { biber: tool } });
  const expression = calls[0].args.find((arg) => arg.startsWith('$biber ='));
  const result = childProcess.execFileSync('/usr/bin/perl', ['-e', expression + 'system($biber); exit($? >> 8);'], { cwd: dir, encoding: 'utf8', env: compileEnvironment(path.join(dir, 'runtime')) });
  assert.match(result, /Auxiliar ficticio/);
  for (const name of ['marcador-dollar', 'marcador-backtick']) await assert.rejects(fs.stat(path.join(dir, name)), { code: 'ENOENT' });
});

test('SVG compartido valida antes de ejecutar y limpia su temporal', async (t) => {
  mock.method(process, 'kill', () => {});
  const calls = fakeSpawn(t, async ({ args, child }) => {
    await fs.writeFile(args.find((arg) => arg.startsWith('--output=')).slice(9), '%PDF-1.7\nFicticio');
    child.emit('close', 0, null);
  });
  const bad = await svgToPdf('<svg><image href="file:///ficticio"/></svg>');
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
  const result = await svgToPdf(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>Ficticio</text></svg>'), { tool: '/opt/rsvg/bin/rsvg-convert' });
  assert.match(result.pdf.toString(), /^%PDF/);
  assert.equal(calls[0].cmd, '/opt/rsvg/bin/rsvg-convert');
  await assert.rejects(fs.stat(calls[0].options.cwd), { code: 'ENOENT' });
  assert.equal(calls[0].options.env.AUTH_TOKEN, undefined);
});

test('SVG compartido rechaza una salida que no sea PDF', async (t) => {
  mock.method(process, 'kill', () => {});
  fakeSpawn(t, async ({ args, child }) => {
    await fs.writeFile(args.find((arg) => arg.startsWith('--output=')).slice(9), 'Salida ficticia inválida');
    child.emit('close', 0, null);
  });
  const result = await svgToPdf('<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.equal(result.status, 500);
  assert.match(result.error, /PDF válido/);
});
