import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isMain, signalTree } from './dev.mjs';
import { copyTemplate } from './memoria-template.mjs';
import { validatePackage, atomicJson, platformId } from '../desktop/engine-package.mjs';
import { RELEASES_URL } from '../desktop/distribution.mjs';
import { desktopAllowedRoots } from '../desktop/folders.mjs';

export function developmentEnv(repo, inherited = process.env) {
  const root = path.join(repo, 'workspace/desktop-dev');
  const env = { ...inherited, ET_DESKTOP_DEV: '1', DATA_DIR: path.join(root, 'data'),
    NOTES_DIR: path.join(root, 'Notas'), MEMORIA_DIR: path.join(root, 'Memoria'), MEMORIA_MAIN: 'tfg.tex',
    BUILD_DIR: path.join(root, 'data/builds'), ALLOWED_ROOTS: desktopAllowedRoots(inherited.ALLOWED_ROOTS), WEB_DIST: path.join(root, 'web'),
    TEMPLATES_DIR: path.join(repo, 'templates'), COMPILE_ENGINE: 'local', WORKER_URL: 'http://127.0.0.1:1',
    TEX_BIN_DIR: '', TEX_PERL_DIR: '', RESOURCES_SUBDIR: 'Recursos' };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export async function prepareDevelopment(repo, env, fetchPackage = fetch, signal) {
  await fs.mkdir(env.DATA_DIR, { recursive: true });
  for (const [dir, initialize] of [[env.NOTES_DIR, async () => {
    await fs.writeFile(path.join(env.NOTES_DIR, 'Nota de pruebas.md'), '# Nota de pruebas\n\nContenido ficticio para probar la app de desarrollo.\n');
  }], [env.MEMORIA_DIR, () => copyTemplate(env.MEMORIA_DIR, { perfil: 'generico', templatesDir: path.join(repo, 'templates') })]]) {
    try { await fs.mkdir(dir); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    await initialize();
  }
  const file = path.join(env.DATA_DIR, 'engine-manifest.json');
  try { return validatePackage(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const download = async url => {
    const response = await fetchPackage(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`No se pudo obtener el manifiesto TeX: HTTP ${response.status}`);
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw new Error('El manifiesto TeX supera el tamaño permitido');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  const release = JSON.parse(await download(`${RELEASES_URL}/latest/download/manifest.json`));
  const asset = release.assets?.find(asset => asset.name === `engine-${platformId()}.json`);
  if (!asset || !asset.url?.startsWith(`${RELEASES_URL}/download/distribucion-`) || !/^[a-f0-9]{64}$/.test(asset.sha256))
    throw new Error('La última estable no contiene un manifiesto TeX válido para este equipo');
  const bytes = await download(asset.url);
  if (bytes.length !== asset.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error('El manifiesto TeX descargado no coincide con su hash y tamaño');
  const manifest = validatePackage(JSON.parse(bytes));
  await atomicJson(file, manifest);
  return manifest;
}

export function changedPart(repo, file) {
  const relative = path.relative(repo, file).split(path.sep).join('/');
  if (relative.startsWith('web/')) return 'web';
  if (relative.startsWith('server/')) return 'server';
  return 'desktop';
}

export async function startDevelopment(repo) {
  const serverRequire = createRequire(path.join(repo, 'server/package.json'));
  const desktopRequire = createRequire(path.join(repo, 'desktop/package.json'));
  const webCli = path.join(repo, 'web/node_modules/vite/bin/vite.js');
  const typesCli = path.join(repo, 'web/node_modules/typescript/bin/tsc');
  let electronBinary, watch;
  try {
    await fs.access(webCli); await fs.access(typesCli);
    ({ watch } = await import(pathToFileURL(serverRequire.resolve('chokidar')).href));
    electronBinary = desktopRequire('electron'); await fs.access(electronBinary);
  } catch {
    throw new Error('Faltan dependencias. Ejecuta npm run install:all y npm install --prefix desktop. Si falta el binario, ejecuta node desktop/node_modules/electron/install.js');
  }
  const env = developmentEnv(repo);
  const controller = new AbortController();
  const pending = new Set(['web', 'server']);
  let watcher, timer, builder, electron, ready = false, busy = false, stopping = false, restarting = false, restartPending = false, revision = 0;
  const output = child => {
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream, crlfDelay: Infinity })
      .on('line', line => console.log(`[desktop:dev] ${line}`));
  };
  const run = async (args, cwd) => {
    builder = spawn(process.execPath, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    output(builder);
    try { await new Promise((resolve, reject) => {
      builder.once('error', reject);
      builder.once('close', code => code === 0 ? resolve() : reject(new Error(`La reconstrucción terminó con código ${code}`)));
    }); } finally { builder = null; }
  };
  const closeElectron = async () => {
    const child = electron;
    if (!child || child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise((resolve, reject) => {
      const exited = () => { cleanup(); resolve(true); };
      const message = value => { if (value === 'desktop-dev:cancelled') { cleanup(); resolve(false); } };
      const cleanup = () => { child.off('exit', exited); child.off('message', message); };
      child.once('exit', exited); child.on('message', message);
      try {
        if (ready && child.connected) child.send('desktop-dev:close');
        else signalTree(child, 'SIGTERM');
      } catch (error) { cleanup(); reject(error); }
    });
  };
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true; clearTimeout(timer);
    try {
      if (!await closeElectron()) {
        stopping = false; console.log('[desktop:dev] Cierre cancelado; el entorno sigue abierto.'); return;
      }
      controller.abort(); await watcher?.close();
      if (builder) {
        const child = builder;
        const closed = new Promise(resolve => child.once('close', resolve));
        signalTree(child, 'SIGTERM');
        let deadline;
        await Promise.race([closed, new Promise(resolve => { deadline = setTimeout(resolve, 2000); })]);
        clearTimeout(deadline);
        if (process.platform !== 'win32') signalTree(child, 'SIGKILL');
      }
      process.exitCode = code;
      process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    } catch (error) { console.error(`[desktop:dev] ${error.message}`); process.exitCode = 1; }
  };
  const interrupt = () => { void stop(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const launch = () => {
    ready = false;
    const child = spawn(electronBinary, ['--use-mock-keychain', path.join(repo, 'desktop')], {
      cwd: repo, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], shell: false,
    });
    electron = child; output(child);
    child.on('message', message => { if (message === 'desktop-dev:ready' && child === electron) ready = true; });
    child.on('error', error => { console.error(`[desktop:dev] ${error.message}`); void stop(1); });
    child.once('exit', code => {
      if (child === electron && !restarting && !stopping) void stop(code || 0);
    });
  };
  const rebuild = async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      while (pending.size && !stopping) {
        const parts = new Set(pending), started = revision; pending.clear();
        try {
          if (parts.has('web')) {
            await run([typesCli, '--noEmit'], path.join(repo, 'web'));
            // shortcut: conserva chunks para recargas canceladas, limpiar web/ con la app cerrada si se acumulan builds.
            await run([webCli, 'build', '--outDir', env.WEB_DIST, '--emptyOutDir=false'], path.join(repo, 'web'));
          }
          if (stopping) break;
          if (parts.has('server')) await run([path.join(repo, 'server/bundle.mjs')], repo);
          if (stopping) break;
          restartPending ||= parts.has('server') || parts.has('desktop');
          if (!electron || electron.exitCode !== null || electron.signalCode !== null) launch();
          else if (restartPending) {
            restarting = true;
            try {
              if (await closeElectron() && !stopping) launch();
              else { console.log('[desktop:dev] Reinicio cancelado. Guarda los cambios y vuelve a guardar código para reintentarlo.'); continue; }
            } finally { restarting = false; }
          } else if (electron.connected) electron.send('desktop-dev:reload');
          restartPending = false;
          console.log('[desktop:dev] App actualizada. Observando cambios…');
        } catch (error) {
          if (stopping) break;
          for (const part of parts) pending.add(part);
          console.error(`[desktop:dev] ${error.message}. Se reintentará al guardar código.`);
          if (started === revision) break;
        }
      }
    } finally { busy = false; }
  };
  try {
    console.log(`[desktop:dev] Perfil de pruebas: ${path.dirname(env.DATA_DIR)}`);
    const manifest = await prepareDevelopment(repo, env, fetch, controller.signal);
    if (stopping) return;
    console.log(`[desktop:dev] TeX fijado: ${manifest.id}. El asistente lo prepara una vez y después lo reutiliza.`);
    watcher = watch(['web/src', 'web/public', 'web/index.html', 'web/vite.config.ts', 'web/package.json',
      'server/src', 'server/bundle.mjs', 'server/package.json', 'desktop', 'worker', 'templates',
      'scripts/memoria-template.mjs', 'scripts/system-files.mjs'].map(file => path.join(repo, file)), {
      ignoreInitial: true, ignored: file => /(^|[/\\])(node_modules|dist)([/\\]|$)|\.test\.mjs$/.test(file),
    });
    watcher.on('all', (_event, file) => {
      pending.add(changedPart(repo, file)); revision++;
      clearTimeout(timer); timer = setTimeout(() => void rebuild(), 250);
    });
    watcher.on('error', error => { console.error(`[desktop:dev] ${error.message}`); void stop(1); });
    await new Promise(resolve => watcher.once('ready', resolve));
    await rebuild();
  } catch (error) { const interrupted = stopping; await stop(1); if (!interrupted) throw error; }
}

if (isMain(import.meta.url)) startDevelopment(path.resolve(import.meta.dirname, '..'))
  .catch(error => { console.error(`[desktop:dev] ${error.message}`); process.exitCode = 1; });
