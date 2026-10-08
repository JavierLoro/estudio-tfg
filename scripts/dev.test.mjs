import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { isMain, signalTree } from './dev.mjs';

test('el punto de entrada Windows compara aliases y mayúsculas por sus rutas canónicas', () => {
  const short = 'C:\\Users\\RUNNER~1\\dev.mjs';
  const long = 'C:\\Users\\RunnerAdmin\\dev.mjs';
  const canonical = (p) => p === short ? long : p;
  assert.equal(isMain('file:///C:/Users/RUNNER~1/dev.mjs', long, path.win32, canonical), true);
  assert.equal(isMain('file:///C:/Users/RunnerAdmin/dev.mjs', long.toLowerCase(), path.win32, canonical), true);
  assert.equal(isMain('file:///C:/Users/RunnerAdmin/dev.mjs', 'C:\\Users\\RunnerAdmin\\otro.mjs', path.win32, canonical), false);
  assert.equal(isMain('file:///C:/Users/RunnerAdmin/dev.mjs', undefined, path.win32, () => { throw new Error('ENOENT'); }), false);
});

const idle = `console.log('listo', process.pid); setInterval(() => {}, 1000);`;

async function fixture(t, api = idle, web = idle) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio dev test '));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(new URL('./dev.mjs', import.meta.url), path.join(root, 'scripts/dev.mjs'));
  for (const [file, source] of [
    ['server/node_modules/tsx/dist/cli.mjs', api],
    ['web/node_modules/vite/bin/vite.js', web],
  ]) {
    if (source === null) continue;
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function start(t, root, args = []) {
  const child = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs'), ...args], {
    env: { ...process.env, PORT: '8790', VITE_API_TARGET: 'http://localhost:8790' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = { child, output: '' };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => { result.output += data.toString(); });
  }
  result.closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { result.done = true; resolve({ code, signal }); });
  });
  t.after(async () => {
    if (!result.done) {
      child.kill('SIGTERM');
      await result.closed;
    }
  });
  return result;
}

async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'No se alcanzó el estado esperado');
    await delay(20);
  }
}

async function noProcesses(pids) {
  await until(() => pids.every((pid) => {
    try { process.kill(pid, 0); return false; } catch (err) { return err.code === 'ESRCH'; }
  }));
}

for (const missing of ['server', 'web']) {
  test(`dependencias ausentes en ${missing}: mensaje en español y código 1`, async (t) => {
    const root = await fixture(t, missing === 'server' ? null : idle, missing === 'web' ? null : idle);
    const run = start(t, root);
    assert.equal((await run.closed).code, 1);
    assert.match(run.output, new RegExp(`Faltan dependencias en ${missing}/node_modules`));
    assert.match(run.output, /Ejecuta npm run install:all/);
    assert.doesNotMatch(run.output, /listo/);
  });
}

test('prefijos, entorno, argumentos con espacios y SIGINT sin nietos huérfanos', { skip: process.platform === 'win32' }, async (t) => {
  const api = `
    import { spawn } from 'node:child_process';
    const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('nieto', process.pid); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'pipe', 'ignore'] });
    grandchild.stdout.pipe(process.stdout);
    console.log('listo', process.pid, process.env.PORT, process.env.FORCE_COLOR);
    console.error('aviso');
    setInterval(() => {}, 1000);
  `;
  const web = `console.log('listo', process.pid, process.env.VITE_API_TARGET, JSON.stringify(process.argv.slice(2))); setInterval(() => {}, 1000);`;
  const run = start(t, await fixture(t, api, web), ['--port', '5180', '--host', 'nombre con espacios']);
  await until(() => /\[api\] nieto/.test(run.output) && /\[web\] listo/.test(run.output));
  assert.match(run.output, /\[api\] aviso/);
  // Node colorea números con FORCE_COLOR; elimínalo para comprobar valores y PID.
  const plain = run.output.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plain, /\[api\] listo \d+ 8790 1/);
  assert.match(plain, /http:\/\/localhost:8790 \["--port","5180","--host","nombre con espacios"\]/);
  const pids = [...plain.matchAll(/(?:listo|nieto) (\d+)/g)].map((m) => Number(m[1]));
  run.child.kill('SIGINT');
  assert.deepEqual(await run.closed, { code: 0, signal: null });
  await noProcesses(pids);
});

test('SIGTERM cierra ambos con código 0', { skip: process.platform === 'win32' }, async (t) => {
  const run = start(t, await fixture(t));
  await until(() => /\[api\] listo/.test(run.output) && /\[web\] listo/.test(run.output));
  run.child.kill('SIGTERM');
  assert.equal((await run.closed).code, 0);
});

for (const code of [0, 7]) {
  test(`si web termina con ${code}, cierra api y devuelve ${code || 1}`, async (t) => {
    const run = start(t, await fixture(t, idle, `setTimeout(() => process.exit(${code}), 200);`));
    assert.equal((await run.closed).code, code || 1);
    assert.match(run.output, /\[web\] El proceso terminó/);
    const plain = run.output.replace(/\x1b\[[0-9;]*m/g, '');
    await noProcesses([Number(plain.match(/\[api\] listo (\d+)/)[1])]);
  });
}

test('matar tsx cierra web con código 1', async (t) => {
  const run = start(t, await fixture(t));
  await until(() => /\[api\] listo/.test(run.output) && /\[web\] listo/.test(run.output));
  const plain = run.output.replace(/\x1b\[[0-9;]*m/g, '');
  const apiPid = Number(plain.match(/\[api\] listo (\d+)/)[1]);
  const webPid = Number(plain.match(/\[web\] listo (\d+)/)[1]);
  process.kill(apiPid, 'SIGKILL');
  assert.equal((await run.closed).code, 1);
  await noProcesses([apiPid, webPid]);
});

test('Windows usa taskkill por PID, con árbol y cierre forzado, sin shell', () => {
  const child = { pid: 1234, exitCode: null, signalCode: null };
  let invocation;
  signalTree(child, 'SIGTERM', 'win32', {
    kill: () => assert.fail('No debe usar una señal de grupo en Windows'),
    run: (...args) => { invocation = args; return { status: 0 }; },
  });
  assert.deepEqual(invocation, ['taskkill', ['/pid', '1234', '/T', '/F'], {
    stdio: 'ignore', windowsHide: true, timeout: 5000, shell: false,
  }]);
  assert.throws(() => signalTree(child, 'SIGTERM', 'win32', { run: () => ({ status: 1 }), kill: () => {} }), /taskkill/);
  assert.throws(() => signalTree(child, 'SIGTERM', 'win32', { run: () => ({ error: new Error('ENOENT') }) }), /ENOENT/);
  signalTree({ ...child, exitCode: 1 }, 'SIGTERM', 'win32', { run: () => ({ status: 128 }) });
  signalTree(child, 'SIGTERM', 'win32', {
    run: () => ({ status: 128 }),
    kill: (pid, signal) => {
      assert.equal(pid, 1234);
      assert.equal(signal, 0);
      throw Object.assign(new Error('Proceso cerrado'), { code: 'ESRCH' });
    },
  });
});
