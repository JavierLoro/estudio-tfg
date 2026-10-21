import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { _electron, test, expect } from '@playwright/test';
import { copyTemplate } from '../../scripts/memoria-template.mjs';
import { developmentEnv } from '../../scripts/desktop-dev.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../desktop/package.json', import.meta.url));
test.skip(!process.env.E2E_DESKTOP, 'Activa E2E_DESKTOP=1 y prepara Electron, bundle y web');
test.setTimeout(180_000);

test('desarrollo recarga con el renderer protegido y permite cancelar un reinicio con borradores @desktop', async ({}, info) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-desktop-dev-')));
  const env = { ...developmentEnv(root), TEMPLATES_DIR: path.join(repo, 'templates'), WEB_DIST: path.join(repo, 'web/dist') };
  await fs.mkdir(env.DATA_DIR, { recursive: true });
  await fs.mkdir(env.NOTES_DIR);
  await fs.writeFile(path.join(env.NOTES_DIR, 'Nota.md'), '# Nota ficticia\n');
  copyTemplate(env.MEMORIA_DIR, { perfil: 'generico' });
  const source = path.join(env.MEMORIA_DIR, '1-capitulos/01-introduccion.tex');
  const original = await fs.readFile(source, 'utf8');
  const draft = original + '\nBorrador ficticio de desarrollo conservado.\n';
  let electron;
  try {
    electron = await _electron.launch({ executablePath: require('electron'), args: ['--use-mock-keychain', path.join(repo, 'desktop')], env });
    const page = await electron.firstWindow();
    await page.waitForURL('http://estudio-tfg.localhost/');
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    expect(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toContain('(desarrollo)');
    const icons = await electron.evaluate(({ nativeImage }, files) => files.map(file => {
      const image = nativeImage.createFromPath(file);
      const { width, height } = image.getSize();
      const pixels = image.toBitmap();
      return { width, height, cornerAlpha: pixels[3], topAlpha: pixels[(Math.floor(height * 0.2) * width + Math.floor(width * 0.5)) * 4 + 3] };
    }), ['macos.png', 'windows.png'].map(file => path.join(repo, 'desktop/icons', file)));
    for (const icon of icons) { expect(icon.width).toBeGreaterThanOrEqual(512); expect(icon.height).toBe(icon.width); expect(icon.cornerAlpha).toBe(0); }
    expect(icons[0].topAlpha).toBeGreaterThanOrEqual(250);
    expect(icons[1].topAlpha).toBe(0);
    await page.evaluate(() => localStorage.setItem('et:dev-fixture', 'Perfil ficticio persistente'));
    const navigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
    await electron.evaluate(() => process.emit('message', 'desktop-dev:reload'));
    await navigation;
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    expect(await page.evaluate(() => ({ node: typeof window.require, marker: localStorage.getItem('et:dev-fixture') })))
      .toEqual({ node: 'undefined', marker: 'Perfil ficticio persistente' });
    // Tras recargar, el clic espera al control y devuelve el foco al renderer.
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    const open = page.getByRole('dialog', { name: 'Abrir o buscar' });
    await open.getByLabel('Buscar', { exact: true }).fill('01-introduccion.tex');
    await open.getByRole('option').filter({ hasText: '1-capitulos/01-introduccion.tex' }).first().click();
    const editor = page.locator('.cm-content:visible').last();
    await editor.fill(draft);
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('Borrador ficticio de desarrollo conservado.')))).toBe(true);
    await electron.evaluate(({ dialog }) => {
      globalThis.__devMessages = [];
      process.send = message => { globalThis.__devMessages.push(message); return true; };
      dialog.showMessageBoxSync = () => 0;
      process.emit('message', 'desktop-dev:close');
    });
    await expect.poll(() => electron.evaluate(() => globalThis.__devMessages.includes('desktop-dev:cancelled'))).toBe(true);
    await expect(editor).toContainText('Borrador ficticio de desarrollo conservado.');
    expect(await fs.readFile(source, 'utf8')).toBe(original);
    await info.attach('desarrollo-ficticio.png', { body: await page.screenshot(), contentType: 'image/png' });
    const closed = electron.waitForEvent('close');
    await electron.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; process.emit('message', 'desktop-dev:close'); });
    await closed; electron = undefined;
  } finally {
    if (electron) {
      await electron.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
      await electron.close();
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Electron conserva edición y borradores, protege el renderer y restaura la única instancia @desktop', async ({}, info) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-desktop-')));
  const env = { ...process.env, DATA_DIR: path.join(root, 'data'), NOTES_DIR: path.join(root, 'notes'), MEMORIA_DIR: path.join(root, 'memoria'),
    ALLOWED_ROOTS: root, WORKER_URL: 'http://127.0.0.1:1', COMPILE_ENGINE: 'local', TEX_BIN_DIR: process.env.E2E_TEX_BIN ?? '' };
  await fs.mkdir(env.NOTES_DIR);
  await fs.writeFile(path.join(env.NOTES_DIR, 'Nota.md'), '# Nota ficticia de escritorio\n');
  copyTemplate(env.MEMORIA_DIR, { perfil: 'generico' });
  const source = path.join(env.MEMORIA_DIR, '1-capitulos/01-introduccion.tex');
  const original = await fs.readFile(source, 'utf8');
  const saved = original + '\nTexto ficticio guardado desde Electron.\n';
  const draft = saved + '\nBorrador ficticio conservado tras reiniciar.\n';
  const executablePath = require('electron');
  const launch = () => _electron.launch({ executablePath, args: ['--use-mock-keychain', path.join(repo, 'desktop')], env });
  let electron;
  let logs = '';
  try {
    electron = await launch();
    electron.process().stdout.on('data', chunk => { logs += chunk; });
    electron.process().stderr.on('data', chunk => { logs += chunk; });
    const page = await electron.firstWindow();
    await page.waitForURL('http://estudio-tfg.localhost/');
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    const state = await page.evaluate(async () => ({ secure: isSecureContext, node: typeof window.require, process: typeof window.process,
      cookie: document.cookie, status: (await fetch('/api/status')).status }));
    expect(state).toEqual({ secure: true, node: 'undefined', process: 'undefined', cookie: '', status: 200 });
    expect(await page.evaluate(() => new Promise(resolve => {
      const events = new EventSource('/api/events');
      const timer = setTimeout(() => { events.close(); resolve(false); }, 5000);
      events.onopen = () => { clearTimeout(timer); events.close(); resolve(true); };
    }))).toBe(true);
    const cookie = await electron.evaluate(async ({ session }) => {
      const [cookie] = await session.fromPartition('persist:estudio-tfg').cookies.get({ name: 'et_token' });
      return { httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, length: cookie.value.length };
    });
    expect(cookie).toEqual({ httpOnly: true, sameSite: 'strict', length: 64 });
    const settings = await page.evaluate(async () => (await fetch('/api/settings')).json());
    expect(settings.values.compileEngine).toBe('local');
    await page.keyboard.press('ControlOrMeta+k');
    const open = page.getByRole('dialog', { name: 'Abrir o buscar' });
    await open.getByLabel('Buscar', { exact: true }).fill('01-introduccion.tex');
    await open.getByRole('option').filter({ hasText: '1-capitulos/01-introduccion.tex' }).first().click();
    const editor = page.locator('.cm-content:visible').last();
    await editor.fill(saved);
    await editor.press('ControlOrMeta+s');
    await expect.poll(() => fs.readFile(source, 'utf8')).toBe(saved);
    if (process.env.E2E_TEX_BIN) {
      await page.getByRole('button', { name: /Compilar/ }).first().click();
      await expect.poll(async () => {
        const response = await page.evaluate(async () => (await fetch('/api/compile/last')).json());
        return response.ok;
      }, { timeout: 120_000 }).toBe(true);
      const result = await page.evaluate(async () => (await fetch('/api/compile/last')).json());
      expect(result.diagnostics).toEqual([]);
      await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 30_000 });
      const popupPromise = electron.waitForEvent('window');
      await page.locator('a[title="Abrir el PDF en una pestaña"]').click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      await expect(popup.getByText('Documento PDF', { exact: true })).toBeVisible();
      await expect(popup.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 30_000 });
      await info.attach('pdf-en-ventana-ficticio.png', { body: await popup.screenshot(), contentType: 'image/png' });
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !!window.getParentWindow())?.close());
    }
    const backend = /"host":"(127\.0\.0\.1:\d+)"/.exec(logs)?.[1];
    expect(backend).toBeTruthy();
    expect((await fetch(`http://${backend}/api/status`)).status).toBe(401);
    await electron.evaluate(({ app }) => { globalThis.__secondInstanceSeen = false; app.once('second-instance', () => { globalThis.__secondInstanceSeen = true; }); });
    await electron.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const focus = window.focus.bind(window);
      globalThis.__focusRequested = false;
      window.focus = () => { globalThis.__focusRequested = true; focus(); };
    });
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    const second = spawn(executablePath, ['--use-mock-keychain', path.join(repo, 'desktop')], { env, stdio: 'ignore' });
    const [code] = await once(second, 'exit');
    expect(code).toBe(0);
    await expect.poll(() => electron.evaluate(() => globalThis.__secondInstanceSeen)).toBe(true);
    const focusState = () => electron.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { minimized: window.isMinimized(), focused: window.isFocused(), visible: window.isVisible(), focusable: window.isFocusable() };
    });
    await expect.poll(() => electron.evaluate(() => globalThis.__focusRequested)).toBe(true);
    await expect.poll(async () => { const state = await focusState(); return !state.minimized && state.visible && state.focusable; }).toBe(true);
    let nativeFocus = await focusState();
    for (let attempt = 0; !nativeFocus.focused && attempt < 20; attempt++) { await page.waitForTimeout(100); nativeFocus = await focusState(); }
    const focusFile = info.outputPath('estado-foco-nativo.json');
    await fs.writeFile(focusFile, JSON.stringify(nativeFocus));
    await info.attach('estado-foco-nativo.json', { path: focusFile, contentType: 'application/json' });
    if (process.env.E2E_SYSTEM_FOCUS) expect(nativeFocus.focused).toBe(true);
    const preferences = await electron.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox, webSecurity: p.webSecurity };
    });
    expect(preferences).toEqual({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true });
    expect(await page.evaluate(async () => { try { await fetch('https://ejemplo.invalid/'); return false; } catch { return true; } })).toBe(true);
    await editor.fill(draft);
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('et:desktop-fixture', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('items');
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      const transaction = db.transaction('items', 'readwrite');
      transaction.objectStore('items').put(new Blob(['Adjunto ficticio persistente']), 'adjunto');
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      db.close();
    });
    await page.waitForTimeout(400);
    await expect.poll(() => page.evaluate(text => Object.values(localStorage).some(value => value.includes(text)), 'Borrador ficticio conservado tras reiniciar.')).toBe(true);
    await info.attach('electron-ficticio.png', { body: await page.screenshot(), contentType: 'image/png' });
    await electron.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    const closed = electron.waitForEvent('close');
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    electron = undefined;
    await expect.poll(async () => { try { await fetch(`http://${backend}/api/status`); return false; } catch { return true; } }).toBe(true);
    expect(await fs.readFile(source, 'utf8')).toBe(saved);
    electron = await launch();
    const restored = await electron.firstWindow();
    await restored.waitForURL('http://estudio-tfg.localhost/');
    const attachment = await restored.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open('et:desktop-fixture', 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      try {
        const blob = await new Promise((resolve, reject) => { const req = db.transaction('items').objectStore('items').get('adjunto'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        return blob.text();
      } finally { db.close(); }
    });
    expect(attachment).toBe('Adjunto ficticio persistente');
    await expect.poll(() => restored.evaluate(text => Object.values(localStorage).some(value => value.includes(text)), 'Borrador ficticio conservado tras reiniciar.'), { timeout: 30_000 }).toBe(true);
    await expect(restored.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    await restored.keyboard.press('ControlOrMeta+k');
    const reopen = restored.getByRole('dialog', { name: 'Abrir o buscar' });
    await reopen.getByLabel('Buscar', { exact: true }).fill('01-introduccion.tex');
    await reopen.getByRole('option').filter({ hasText: '1-capitulos/01-introduccion.tex' }).first().click();
    await restored.getByRole('button', { name: 'Restaurar borrador', exact: true }).click();
    const restoredEditor = restored.locator('.cm-content:visible').last();
    await restoredEditor.focus();
    await restoredEditor.press('ControlOrMeta+End');
    await expect(restored.getByText('Borrador ficticio conservado tras reiniciar.', { exact: false })).toBeVisible({ timeout: 30_000 });
    expect(await fs.readFile(source, 'utf8')).toBe(saved);
  } finally {
    if (electron) {
      await electron.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
      await electron.close();
    }
    await info.attach('electron-ficticio.log', { body: logs, contentType: 'text/plain' });
    await fs.rm(root, { recursive: true, force: true });
  }
});
