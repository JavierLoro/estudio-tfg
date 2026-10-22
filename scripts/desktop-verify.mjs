import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { _electron } from '../test/e2e/node_modules/playwright/index.mjs';
import { expect } from '../test/e2e/node_modules/@playwright/test/index.mjs';
import { DIAGRAM_TEMPLATES } from '../web/src/lib/diagramTemplates.ts';
import { command } from './desktop-tex.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const [packageRoot, assets] = process.argv.slice(2);
if (!packageRoot || !assets) throw new Error('Uso: node scripts/desktop-verify.mjs <raíz-paquete> <assets-TeX>');
const descriptor = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const { variant, manifest, output } = descriptor;
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-distribution-')));
const dataDir = path.join(root, 'Datos privados');
let executable = process.platform === 'darwin'
  ? path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Estudio TFG.app/Contents/MacOS/Estudio TFG')
  : process.platform === 'win32' ? path.join(output, 'win-unpacked/Estudio TFG.exe') : path.join(output, 'linux-unpacked/estudio-tfg');
const archive = path.join(assets, new URL(manifest.url).pathname.split('/').at(-1));
let downloads = 0;
const source = http.createServer((_req, res) => { downloads++; res.setHeader('Content-Length', manifest.bytes); createReadStream(archive).pipe(res); });
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const downloadUrl = `http://127.0.0.1:${source.address().port}/engine.tar.gz`;
let electron;
let mount = null;
let artifact = 'App empaquetada (directorio)';
let logs = '';
const results = [];
const launchArgs = ['--use-mock-keychain', ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])];
const launchEnv = { ...process.env, DATA_DIR: dataDir, NOTES_DIR: path.join(root, 'Notas'), MEMORIA_DIR: path.join(root, 'Memoria'),
  ALLOWED_ROOTS: root, PATH: '', TEX_BIN_DIR: '', COMPILE_ENGINE: 'local', WORKER_URL: 'http://127.0.0.1:1' };
const launch = async (network) => {
  const instance = await _electron.launch({ executablePath: executable,
    args: launchArgs, env: launchEnv, timeout: 60_000 });
  instance.process().stdout.on('data', chunk => { logs += chunk; });
  instance.process().stderr.on('data', chunk => { logs += chunk; });
  // El borrador de release aún es privado. El proxy de prueba sirve su mismo asset real,
  // conservando URL/hash/tamaño fijados en la app; ninguna otra red está permitida.
  await instance.evaluate((_electron, { expected, local, network }) => {
    const original = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.hostname === '127.0.0.1') return original(input, options);
      if (network && url.href === expected) return original(local, options);
      throw new Error('Red externa bloqueada en la prueba offline');
    };
  }, { expected: manifest.url, local: downloadUrl, network });
  return instance;
};
const json = (page, endpoint, method = 'GET', body) => page.evaluate(async ({ endpoint, method, body }) => {
  const response = await fetch(endpoint, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${endpoint}: ${response.status} ${value.error}`);
  return value;
}, { endpoint, method, body });

try {
  const distributables = await fs.readdir(output);
  if (process.platform === 'darwin' && distributables.some(file => file.endsWith('.dmg'))) {
    mount = path.join(root, 'dmg'); await fs.mkdir(mount);
    await command('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, path.join(output, distributables.find(file => file.endsWith('.dmg')))], root);
    const copied = path.join(root, 'Aplicación/Estudio TFG.app');
    await fs.cp(path.join(mount, 'Estudio TFG.app'), copied, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    executable = path.join(copied, 'Contents/MacOS/Estudio TFG'); artifact = 'App copiada del DMG montado en solo lectura';
  } else if (process.platform === 'win32') {
    const installer = distributables.find(file => file.endsWith('.exe') && !file.includes('-portable'));
    if (!installer) throw new Error('Falta el instalador NSIS');
    const sevenZip = path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip/7z.exe');
    await fs.access(sevenZip).catch(() => { throw new Error('Verificar el instalador Windows requiere 7-Zip en el constructor'); });
    const extracted = path.join(root, 'installer');
    await command(sevenZip, ['x', path.join(output, installer), `-o${extracted}`, '-y'], root);
    const findPayload = async dir => {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isFile() && /^app.*\.7z$/.test(item.name)) return file;
        if (item.isDirectory()) { const found = await findPayload(file); if (found) return found; }
      }
    };
    const payload = await findPayload(extracted);
    if (!payload) throw new Error('No se encontró el paquete de la app dentro del instalador');
    const application = path.join(root, 'app');
    await command(sevenZip, ['x', payload, `-o${application}`, '-y'], root);
    executable = path.join(application, 'Estudio TFG.exe'); artifact = 'Payload del instalador NSIS extraído';
  } else if (process.platform === 'linux') {
    const image = distributables.find(file => file.endsWith('.AppImage'));
    if (!image) throw new Error('Falta AppImage');
    await command(path.resolve(output, image), ['--appimage-extract'], root);
    executable = path.join(root, 'squashfs-root/estudio-tfg'); artifact = 'AppImage extraída';
  }
  electron = await launch(variant === 'online');
  const page = await electron.firstWindow();
  page.on('pageerror', error => { logs += `Renderer: ${error.stack}\n`; });
  await page.waitForURL('http://estudio-tfg.localhost/');
  const wizard = page.getByRole('dialog', { name: 'Preparar Estudio TFG' });
  await wizard.waitFor({ state: 'visible' });
  await wizard.getByRole('button', { name: 'Crear carpeta de notas', exact: true }).click();
  let picker = page.getByRole('dialog', { name: 'Carpeta de notas', exact: true });
  await picker.getByLabel('Nueva carpeta', { exact: true }).fill('Notas');
  await picker.getByRole('button', { name: 'Crear notas aquí', exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  await wizard.getByRole('button', { name: 'Crear memoria', exact: true }).click();
  picker = page.getByRole('dialog', { name: 'Carpeta de la memoria', exact: true });
  await picker.getByLabel('Nueva carpeta', { exact: true }).fill('Memoria');
  await picker.getByRole('button', { name: 'Crear memoria aquí', exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await wizard.getByRole('button', { name: 'Preparar TeX', exact: true }).click();
  for (let attempts = 0; attempts < 600; attempts++) {
    const setup = await json(page, '/api/desktop/setup');
    if (setup.engine.current) break;
    if (setup.engine.phase === 'error') throw new Error(setup.engine.message);
    if (attempts === 599) throw new Error('La preparación no terminó en 5 minutos');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await wizard.getByRole('button', { name: 'Compilar primera memoria', exact: true }).click();
  await expect.poll(async () => {
    const error = wizard.locator('.text-danger');
    if (await error.count()) throw new Error(await error.first().innerText());
    return wizard.getByText('PDF generado. Ya puedes empezar a escribir.', { exact: true }).isVisible();
  }, { timeout: 270_000 }).toBe(true);
  const first = await json(page, '/api/compile/last');
  assert.equal(first.ok, true); assert.deepEqual(first.diagnostics, []);
  results.push({ variant, perfil: 'generico', reinicio: false, diagnostics: first.diagnostics });
  await wizard.getByRole('button', { name: 'Terminar', exact: true }).click();
  await wizard.waitFor({ state: 'hidden' });
  await page.locator('.pdfViewer .page').first().waitFor({ timeout: 30_000 });
  const health = await json(page, '/api/engines');
  assert.equal(health.local.ok, true);
  for (const name of ['latexmk', 'biber', 'pdflatex']) assert(health.local.tools[name].path.startsWith(dataDir + path.sep));
  const licensesPromise = electron.waitForEvent('window');
  const about = await electron.evaluate(async ({ Menu, dialog }) => {
    const show = dialog.showMessageBox;
    let captured;
    dialog.showMessageBox = async (_window, options) => { captured = options; return { response: 1 }; };
    try { await Menu.getApplicationMenu().getMenuItemById('about').click(); return captured; }
    finally { dialog.showMessageBox = show; }
  });
  assert(about.detail.includes('AGPL-3.0') && about.detail.includes('https://github.com/JavierLoro/estudio-tfg/tree/'));
  const licenses = await licensesPromise;
  assert(licenses, 'El menú Acerca de abre el inventario');
  await licenses.getByRole('heading', { name: 'Licencias y componentes', exact: true }).waitFor();
  assert(await licenses.getByText('Plantilla ARCO — GNU GPL-2.0', { exact: true }).count());
  await licenses.screenshot({ path: path.join(packageRoot, 'licencias.png') });
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !!window.getParentWindow())?.close());
  const synctex = await json(page, '/api/synctex/forward?file=1-capitulos%2F01-introduccion.tex&line=5');
  assert(synctex.boxes?.length || synctex.page, 'SyncTeX debe resolver una línea');
  const inverse = await json(page, `/api/synctex/inverse?page=${synctex.page}&x=${synctex.x}&y=${synctex.y}`);
  assert.equal(inverse.file, '1-capitulos/01-introduccion.tex'); assert(inverse.line > 0);
  const sourceFile = path.join(root, 'Memoria/1-capitulos/01-introduccion.tex');
  const original = await fs.readFile(sourceFile, 'utf8');
  const saved = original + '\nTexto ficticio guardado en la app instalada.\n';
  const draft = saved + '\nBorrador ficticio recuperado tras reiniciar.\n';
  const openIntroduction = async current => {
    await current.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Buscar', exact: true }).click();
    const quick = current.getByRole('dialog', { name: 'Abrir o buscar' });
    await quick.getByLabel('Buscar', { exact: true }).fill('01-introduccion.tex');
    await quick.getByRole('option').filter({ hasText: '1-capitulos/01-introduccion.tex' }).first().click();
    return current.locator('.cm-content:visible').last();
  };
  const editor = await openIntroduction(page);
  await editor.fill(saved); await editor.press('ControlOrMeta+s');
  await expect.poll(() => fs.readFile(sourceFile, 'utf8')).toBe(saved);
  await electron.evaluate(({ app, BrowserWindow }) => {
    globalThis.__distributionSecond = false;
    app.once('second-instance', () => { globalThis.__distributionSecond = true; });
    BrowserWindow.getAllWindows()[0].minimize();
  });
  const second = spawn(executable, launchArgs, { env: launchEnv, stdio: 'ignore' });
  const [exitCode] = await once(second, 'exit'); assert.equal(exitCode, 0);
  await expect.poll(() => electron.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return globalThis.__distributionSecond && !window.isMinimized() && window.isVisible();
  })).toBe(true);
  const focus = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused());
  await page.screenshot({ path: path.join(packageRoot, 'primer-pdf.png') });
  const diagramsOutput = path.join(root, 'figuras-exportadas'); await fs.mkdir(diagramsOutput);
  const diagramsDir = path.join(root, 'Memoria/diagramas'); await fs.mkdir(diagramsDir, { recursive: true });
  for (const template of DIAGRAM_TEMPLATES) {
    await fs.writeFile(path.join(diagramsDir, `${template.id}.mmd`), template.source);
    await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Buscar', exact: true }).click();
    const open = page.getByRole('dialog', { name: 'Abrir o buscar' });
    await open.getByLabel('Buscar', { exact: true }).fill(`${template.id}.mmd`);
    await open.getByRole('option').filter({ hasText: `diagramas/${template.id}.mmd` }).first().click();
    await page.getByTitle(`Guardar y exportar a figuras/diagramas/${template.id}.pdf (y .svg)`, { exact: true }).click();
    await expect.poll(async () => (await json(page, `/api/diagramas/estado?path=diagramas%2F${template.id}.mmd`)).estado, { timeout: 30_000 }).toBe('exportado');
    const pdf = await fs.readFile(path.join(root, `Memoria/figuras/diagramas/${template.id}.pdf`));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert(pdf.toString('latin1').includes('/BaseFont /SourceSans3'));
    await fs.writeFile(path.join(diagramsOutput, `${template.id}-js.pdf`), pdf);
  }
  const dirtyEditor = await openIntroduction(page);
  await dirtyEditor.fill(draft);
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('Borrador ficticio recuperado tras reiniciar.')))).toBe(true);
  await electron.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  await electron.evaluate(({ app }) => app.quit()); await electron.close(); electron = undefined;
  assert.equal(downloads, variant === 'online' ? 1 : 0);
  electron = await launch(false);
  const restarted = await electron.firstWindow(); await restarted.waitForURL('http://estudio-tfg.localhost/');
  assert.equal((await json(restarted, '/api/desktop/setup')).needsSetup, false);
  await openIntroduction(restarted);
  await restarted.getByRole('button', { name: 'Restaurar borrador', exact: true }).click();
  await expect.poll(() => restarted.locator('.cm-content:visible').last().textContent()).toContain('Borrador ficticio recuperado tras reiniciar.');
  assert.equal(await fs.readFile(sourceFile, 'utf8'), saved);
  // Se comprueba recuperación sin aplicar ese borrador al archivo de disco.
  await restarted.locator('.cm-content:visible').last().fill(saved);
  const result = await json(restarted, '/api/compile', 'POST');
  assert.equal(result.ok, true); assert.deepEqual(result.diagnostics, []);
  results.push({ variant, perfil: 'generico', reinicio: true, diagnostics: result.diagnostics });
  await json(restarted, '/api/settings/init-memoria', 'POST', { dir: path.join(root, 'Memoria ESI'), perfil: 'esi-uclm' });
  const esi = await json(restarted, '/api/compile', 'POST');
  assert.equal(esi.ok, true); assert.deepEqual(esi.diagnostics, []);
  results.push({ variant, perfil: 'esi-uclm', reinicio: true, diagnostics: esi.diagnostics });
  await electron.evaluate(({ app }) => app.quit()); await electron.close(); electron = undefined;
  // Citas/figuras y copias trasladadas usan el motor extraído del paquete final.
  const current = JSON.parse(await fs.readFile(path.join(dataDir, 'engines/current.json'), 'utf8'));
  const engineRoot = path.join(dataDir, 'engines', `${current.id}-${current.platform}-${current.sha256.slice(0, 12)}`);
  const libraryOutput = path.join(root, 'biblioteca'); await fs.mkdir(libraryOutput);
  await command(process.execPath, [path.join(repo, 'server/node_modules/tsx/dist/cli.mjs'), path.join(repo, 'scripts/library-compile.mts'),
    '--engine', 'local', '--output-dir', libraryOutput, '--diagrams-dir', diagramsOutput,
    '--tex-bin', path.join(engineRoot, current.binDir), '--tex-perl', path.join(engineRoot, current.perlDir)], repo,
  { ...process.env, PATH: [path.join(engineRoot, current.binDir), path.join(engineRoot, current.perlDir)].join(path.delimiter) });
  await fs.mkdir(path.join(packageRoot, 'biblioteca'), { recursive: true });
  for (const file of await fs.readdir(libraryOutput)) if (file.endsWith('.json')) await fs.copyFile(path.join(libraryOutput, file), path.join(packageRoot, 'biblioteca', file));
  await fs.writeFile(path.join(packageRoot, 'verificacion.json'), JSON.stringify({ platform: descriptor.platform, variant, artifact, sha256: manifest.sha256,
    bytes: manifest.bytes, installedBytes: manifest.unpackedBytes, downloads, focus, editing: true, draftRecovered: true, results,
    biblioteca: 'original y trasladada, ambos perfiles, cero diagnósticos' }, null, 2));
  console.log(`✓ ${descriptor.platform}/${variant}: primer arranque, ambos perfiles, reinicio sin red y biblioteca portables`);
} catch (error) {
  const page = electron?.windows()[0];
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(packageRoot, 'error.png') }).catch(() => {});
    const text = await page.locator('body').innerText().catch(() => 'Sin captura');
    await fs.writeFile(path.join(packageRoot, 'error.txt'), text);
    console.error(text);
    const engines = await json(page, '/api/engines').catch(error => ({ error: error.message }));
    await fs.writeFile(path.join(packageRoot, 'engines-error.json'), JSON.stringify(engines, null, 2));
    console.error(JSON.stringify(engines));
    const last = await json(page, '/api/compile/last').catch(() => null);
    if (last) {
      console.error(JSON.stringify(last));
      const log = await page.evaluate(async id => (await fetch(`/api/compile/log/${id}`)).text(), last.buildId);
      await fs.writeFile(path.join(packageRoot, 'compile-error.log'), log); console.error(log.slice(-8000));
      const transcript = await fs.readFile(path.join(dataDir, 'builds', last.buildId, 'latexmk.txt'), 'utf8').catch(() => 'Sin transcripción de latexmk');
      await fs.writeFile(path.join(packageRoot, 'latexmk-error.log'), transcript); console.error(transcript.slice(-8000));
    }
  }
  throw error;
} finally {
  if (electron) { await electron.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await electron.close(); }
  await new Promise(resolve => source.close(resolve));
  if (mount) await command('hdiutil', ['detach', mount], root);
  await fs.writeFile(path.join(packageRoot, 'app.log'), logs);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
