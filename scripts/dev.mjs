import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** Comparar ambas rutas canónicas: Windows puede usar aliases cortos y otra capitalización. */
export function isMain(moduleUrl, entry = process.argv[1], paths = path, realpath = fs.realpathSync.native) {
  if (!entry) return false;
  try {
    const modulePath = fileURLToPath(moduleUrl, { windows: paths.sep === '\\' });
    return paths.relative(realpath(entry), realpath(modulePath)) === '';
  } catch { return false; }
}

/** Cierra el árbol de tsx/Vite; en POSIX incluye el grupo aunque el padre termine. */
export function signalTree(child, signal, platform = process.platform, { kill = process.kill, run = spawnSync } = {}) {
  if (!child.pid) return;
  if (platform === 'win32') {
    const result = run('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true, timeout: 5000, shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && child.exitCode === null && child.signalCode === null) {
      // Ctrl+C puede cerrar el hijo antes de que llegue su evento exit.
      try {
        kill(child.pid, 0);
      } catch (err) {
        if (err.code === 'ESRCH') return;
        throw err;
      }
      throw new Error(`taskkill terminó con código ${result.status}`);
    }
  } else {
    try {
      kill(-child.pid, signal);
    } catch (err) {
      if (err.code !== 'ESRCH') throw err;
    }
  }
}

function prefix(stream, name, output) {
  createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) => {
    output.write(`[${name}] ${line}\n`);
  });
}

function main() {
  const root = path.resolve(import.meta.dirname, '..');
  const tools = [
    { name: 'api', dir: 'server', cli: 'tsx/dist/cli.mjs', args: ['watch', 'src/index.ts'] },
    { name: 'web', dir: 'web', cli: 'vite/bin/vite.js', args: process.argv.slice(2) },
  ];
  for (const tool of tools) {
    tool.cwd = path.join(root, tool.dir);
    tool.bin = path.join(tool.cwd, 'node_modules', tool.cli);
    if (!fs.existsSync(tool.bin)) {
      console.error(`[${tool.name}] Faltan dependencias en ${tool.dir}/node_modules. Ejecuta npm run install:all.`);
      process.exitCode = 1;
      return;
    }
  }

  const children = [];
  const closed = [];
  let stopping = false;

  async function stop(code) {
    if (stopping) return;
    stopping = true;
    function signalAll(signal) {
      for (const child of children) {
        try {
          signalTree(child, signal);
        } catch (err) {
          console.error(`[dev] No se pudo cerrar el proceso ${child.pid}: ${err.message}`);
          code = 1;
        }
      }
    }
    signalAll('SIGTERM');
    let timer;
    await Promise.race([
      Promise.all(closed),
      new Promise((resolve) => { timer = setTimeout(resolve, 2000); }),
    ]);
    clearTimeout(timer);
    // Un nieto puede seguir vivo aunque su padre haya cerrado las tuberías.
    if (process.platform !== 'win32') signalAll('SIGKILL');
    process.exit(code);
  }

  process.on('SIGINT', () => { void stop(0); });
  process.on('SIGTERM', () => { void stop(0); });

  for (const tool of tools) {
    const child = spawn(process.execPath, [tool.bin, ...tool.args], {
      cwd: tool.cwd,
      env: { ...process.env, FORCE_COLOR: '1' },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    children.push(child);
    closed.push(new Promise((resolve) => { child.once('close', resolve); }));
    prefix(child.stdout, tool.name, process.stdout);
    prefix(child.stderr, tool.name, process.stderr);
    child.once('error', (err) => {
      console.error(`[${tool.name}] No se pudo arrancar: ${err.message}`);
      void stop(1);
    });
    child.once('exit', (code, signal) => {
      if (!stopping) {
        console.error(`[${tool.name}] El proceso terminó (${signal ?? code}); cerrando el entorno.`);
        void stop(code || 1);
      }
    });
  }
}

if (isMain(import.meta.url)) main();
