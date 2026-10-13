import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron';
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { startServer, userDataDir } from '../server/dist/server.mjs';
import { APP_ORIGIN, isAppUrl, isExternalUrl } from './security.mjs';
import { setupRoutes } from './setup.mjs';

app.setName('Estudio TFG');
app.commandLine.appendSwitch('lang', 'es-ES');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : userDataDir();
mkdirSync(dataDir, { recursive: true });
mkdirSync(path.join(dataDir, 'browser'), { recursive: true });
app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(dataDir, 'browser'));
const ownsInstance = app.requestSingleInstanceLock();
let server, mainWindow, quitting = false;
const requests = new AbortController();

if (!ownsInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const focus = () => { mainWindow.show(); app.focus({ steal: true }); mainWindow.focus(); };
    if (mainWindow.isMinimized()) { mainWindow.once('restore', focus); mainWindow.restore(); }
    else focus();
  });
  app.on('before-quit', event => {
    if (quitting) return;
    if (mainWindow && !mainWindow.isDestroyed()) { event.preventDefault(); mainWindow.close(); return; }
    event.preventDefault(); quitting = true;
    requests.abort();
    void (async () => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
      await server?.app.close();
      app.quit();
    })().catch(error => { console.error('No se pudo cerrar el servidor:', error); app.exit(1); });
  });
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.setActivationPolicy('regular');
    const root = path.resolve(import.meta.dirname, '..');
    const packageFile = path.join(root, 'desktop', 'engine-manifest.json');
    const manifest = existsSync(packageFile) ? JSON.parse(readFileSync(packageFile, 'utf8')) : null;
    const archive = manifest && existsSync(path.join(root, 'desktop', 'engine.tar.gz')) ? path.join(root, 'desktop', 'engine.tar.gz') : null;
    const token = crypto.randomBytes(32).toString('hex');
    server = await startServer({ ...process.env, DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: '0', AUTH_TOKEN: token,
      TEMPLATES_DIR: process.env.TEMPLATES_DIR || path.join(root, 'templates'),
      WEB_DIST: process.env.WEB_DIST || path.join(root, 'web/dist'),
      NOTES_DIR: process.env.NOTES_DIR || path.join(app.getPath('documents'), 'Estudio TFG', 'Notas'),
      MEMORIA_DIR: process.env.MEMORIA_DIR || path.join(app.getPath('documents'), 'Estudio TFG', 'Memoria'),
      COMPILE_ENGINE: process.env.COMPILE_ENGINE || 'local',
    }, { desktopDataDir: dataDir, configure: (app, ctx) => setupRoutes(app, ctx, { dataDir, manifest, archive }) });
    const ses = session.fromPartition('persist:estudio-tfg');
    await ses.cookies.set({ url: APP_ORIGIN, name: 'et_token', value: token, httpOnly: true, sameSite: 'strict' });
    ses.setPermissionCheckHandler((_contents, permission, origin) => permission === 'clipboard-sanitized-write' && origin === APP_ORIGIN);
    ses.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'clipboard-sanitized-write' && isAppUrl(contents.getURL())));
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const protocol = new URL(details.url).protocol;
      callback({ cancel: !isAppUrl(details.url) && !['data:', 'blob:', 'chrome-extension:'].includes(protocol) });
    });
    // Un origen fijo conserva localStorage/IndexedDB aunque el servidor cambie de puerto.
    ses.protocol.handle('http', async req => {
      if (!isAppUrl(req.url) || (req.initiatorOrigin && req.initiatorOrigin !== APP_ORIGIN)) return new Response('No permitido', { status: 403 });
      const url = new URL(req.url);
      const headers = new Headers(req.headers);
      headers.delete('host');
      const cookies = await ses.cookies.get({ url: APP_ORIGIN, name: 'et_token' });
      if (cookies[0]) headers.set('cookie', `et_token=${cookies[0].value}`);
      const response = await fetch(server.url + url.pathname + url.search, { method: req.method, headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body, duplex: 'half', redirect: 'manual',
        signal: AbortSignal.any([req.signal, requests.signal]),
      });
      const responseHeaders = new Headers(response.headers);
      if (responseHeaders.has('content-encoding')) { responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length'); }
      for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade']) responseHeaders.delete(name);
      responseHeaders.set('content-security-policy', "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'");
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    });
    const openExternal = url => {
      if (isExternalUrl(url)) void shell.openExternal(url).catch(error => console.error('No se pudo abrir el enlace:', error));
    };
    const createWindow = (url, parent) => {
      const window = new BrowserWindow({ title: 'Estudio TFG', width: 1440, height: 1000, minWidth: 900, minHeight: 650,
        parent, show: false, webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false } });
      window.webContents.on('will-navigate', (event, target) => {
        if (!isAppUrl(target)) { event.preventDefault(); openExternal(target); }
      });
      window.webContents.on('will-frame-navigate', event => { if (!isAppUrl(event.url)) event.preventDefault(); });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.setWindowOpenHandler(({ url: target }) => {
        if (isAppUrl(target)) {
          const requested = new URL(target);
          const pdf = requested.pathname.startsWith('/api/pdf/') || (requested.pathname === '/api/raw' && /\.pdf$/i.test(requested.searchParams.get('path') ?? ''));
          createWindow(pdf ? `${APP_ORIGIN}/?pdf=${encodeURIComponent(requested.pathname + requested.search)}` : target, window);
        }
        else openExternal(target);
        return { action: 'deny' };
      });
      window.webContents.on('will-prevent-unload', event => {
        const choice = dialog.showMessageBoxSync(window, { type: 'question', title: 'Cerrar Estudio TFG',
          message: 'Hay cambios sin guardar.', detail: 'Los borradores se conservarán para el próximo arranque.',
          buttons: ['Seguir editando', 'Cerrar y conservar borradores'], defaultId: 0, cancelId: 0 });
        if (choice === 1) event.preventDefault();
      });
      window.once('ready-to-show', () => { window.show(); if (!parent) { app.focus({ steal: true }); window.focus(); } });
      void window.loadURL(url).catch(error => { console.error('No se pudo abrir la interfaz:', error); app.quit(); });
      return window;
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Estudio TFG', submenu: [{ label: 'Salir', role: 'quit' }] },
      { label: 'Editar', submenu: [{ label: 'Cortar', role: 'cut' }, { label: 'Copiar', role: 'copy' }, { label: 'Pegar', role: 'paste' }, { label: 'Seleccionar todo', role: 'selectAll' }] },
      { label: 'Ver', submenu: [{ label: 'Recargar', role: 'reload' }, { label: 'Pantalla completa', role: 'togglefullscreen' }] },
    ]));
    mainWindow = createWindow(APP_ORIGIN + '/');
    mainWindow.on('closed', () => app.quit());
    app.on('activate', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } });
  }).catch(error => {
    console.error('No se pudo arrancar Estudio TFG:', error);
    dialog.showErrorBox('No se pudo arrancar Estudio TFG', error.message);
    app.quit();
  });
}
