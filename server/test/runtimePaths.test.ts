import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { REPO_ROOT, checkoutRoot, loadConfig, repoGuardError, userDataDir } from '../src/config.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv | undefined;
afterEach(async () => { await t?.close(); t = undefined; });

it('elige datos por sistema sin escribir y respeta APPDATA/XDG absolutos', () => {
  expect(userDataDir('darwin', {}, '/home/ficticio')).toBe('/home/ficticio/Library/Application Support/Estudio TFG');
  expect(userDataDir('win32', {}, 'C:\\Users\\Ficticio')).toBe('C:\\Users\\Ficticio\\AppData\\Roaming\\Estudio TFG');
  expect(userDataDir('win32', { APPDATA: 'D:\\Datos' }, 'C:\\Users\\Ficticio')).toBe('D:\\Datos\\Estudio TFG');
  expect(userDataDir('linux', { XDG_DATA_HOME: '/datos/ficticios' }, '/home/ficticio')).toBe('/datos/ficticios/estudio-tfg');
  expect(userDataDir('linux', { XDG_DATA_HOME: 'relativa' }, '/home/ficticio')).toBe('/home/ficticio/.local/share/estudio-tfg');
});

it('conserva el almacenamiento previo sin DATA_DIR y separa BUILD_DIR cuando se proporciona', () => {
  const original = loadConfig({}, REPO_ROOT);
  expect(original.dataDir).toBe(path.join(REPO_ROOT, 'data'));
  expect(original.buildDir).toBe(path.join(REPO_ROOT, 'data/builds'));
  expect(loadConfig({ BUILD_DIR: './data-alternativos/builds' }).historyDir).toBe(path.join(REPO_ROOT, 'data-alternativos/history'));
  const cfg = loadConfig({ DATA_DIR: './datos-app', BUILD_DIR: './builds-separadas', WEB_DIST: './web-separada', TEMPLATES_DIR: './plantillas-separadas' });
  expect(cfg.historyDir).toBe(path.join(REPO_ROOT, 'datos-app/history'));
  expect(cfg.settingsFile).toBe(path.join(REPO_ROOT, 'datos-app/settings.json'));
  expect(cfg.buildDir).toBe(path.join(REPO_ROOT, 'builds-separadas'));
  expect(cfg.webDist).toBe(path.join(REPO_ROOT, 'web-separada'));
  expect(cfg.templatesDir).toBe(path.join(REPO_ROOT, 'plantillas-separadas'));
});

it('aplica la guardia solo a checkouts y conserva comprobaciones léxicas/canónicas cuando está activa', async () => {
  t = await setup();
  expect(checkoutRoot(t.dir)).toBeNull();
  expect(checkoutRoot(REPO_ROOT)).toBe(REPO_ROOT);
  expect(repoGuardError('memoria', path.join(REPO_ROOT, 'templates'), null)).toBeNull();
  expect(repoGuardError('memoria', path.join(REPO_ROOT, 'templates'), REPO_ROOT)).toContain('dentro del repositorio');
  await fs.writeFile(path.join(t.dir, '.git'), 'gitdir: enlace-ficticio\n');
  expect(checkoutRoot(t.dir)).toBe(t.dir);
});

it('sirve web externa y usa plantillas externas para crear y comprobar una memoria, con datos separados', async () => {
  t = await setup({ DATA_DIR: './app-data', BUILD_DIR: './builds-separadas', WEB_DIST: './interfaz', TEMPLATES_DIR: './plantillas' }, {
    before: async dir => {
      await fs.cp(path.join(REPO_ROOT, 'templates'), path.join(dir, 'plantillas'), { recursive: true });
      await fs.writeFile(path.join(dir, 'plantillas/perfiles/generico/perfil.json'), JSON.stringify({ nombre: 'Perfil ficticio externo' }));
      await fs.mkdir(path.join(dir, 'interfaz'));
      await fs.writeFile(path.join(dir, 'interfaz/index.html'), '<!doctype html><p>Interfaz ficticia externa</p>');
    },
  });
  expect((await t.app.inject('/api/templates/perfiles')).json().perfiles).toContainEqual({ id: 'generico', nombre: 'Perfil ficticio externo', descripcion: '' });
  const target = path.join(t.dir, 'memoria-nueva');
  const created = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir: target, perfil: 'generico' } });
  expect(created.statusCode, created.body).toBe(200);
  expect(await fs.readFile(path.join(target, 'tfg.tex'), 'utf8')).toContain('memoria');
  expect((await t.app.inject('/api/memoria/plantilla')).json().estado).toBe('actual');
  expect(JSON.parse(await fs.readFile(path.join(t.dir, 'app-data/settings.json'), 'utf8')).memoriaDir).toBe(target);
  const { app } = await buildApp(t.cfg, { serveWeb: true });
  try { expect((await app.inject('/')).body).toContain('Interfaz ficticia externa'); }
  finally { await app.close(); }
});
