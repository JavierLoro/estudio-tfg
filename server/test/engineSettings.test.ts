import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { setup, type TestEnv } from './helpers.ts';

let t: TestEnv | null = null;
afterEach(async () => { await t?.close(); t = null; });

const put = (compileEngine: unknown, remoteAddress = '127.0.0.1') => t!.app.inject({
  method: 'PUT', url: '/api/settings', payload: { compileEngine }, remoteAddress,
});

describe('ajustes del motor de compilación', () => {
  it('valida COMPILE_ENGINE y mantiene Docker por defecto', () => {
    expect(loadConfig({}).compileEngine).toBe('docker');
    for (const value of ['auto', 'docker', 'local']) {
      const cfg = loadConfig({ COMPILE_ENGINE: value });
      expect(cfg.compileEngine).toBe(value);
      expect(cfg.envSources.compileEngine).toBe('env');
    }
    expect(() => loadConfig({ COMPILE_ENGINE: 'tectonic' })).toThrow('COMPILE_ENGINE debe ser auto, docker o local');
  });

  it('aplica y persiste los motores en caliente; restablecer vuelve al entorno', async () => {
    t = await setup({ COMPILE_ENGINE: 'auto' });
    const seen: any[] = [];
    t.ctx.bus.on('settings', (view) => seen.push(view));
    for (const value of ['local', 'docker', 'auto']) {
      const response = await put(value);
      expect(response.statusCode).toBe(200);
      expect(response.json().values.compileEngine).toBe(value);
      expect(response.json().sources.compileEngine).toBe('settings');
      expect(t.cfg.compileEngine).toBe(value);
      expect(JSON.parse(await fs.readFile(t.cfg.settingsFile, 'utf8'))).toEqual({ compileEngine: value });
    }
    expect(seen.map((view) => view.values.compileEngine)).toEqual(['local', 'docker', 'auto']);
    const reset = await t.app.inject({ method: 'POST', url: '/api/settings/reset', payload: { keys: ['compileEngine'] } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().values.compileEngine).toBe('auto');
    expect(reset.json().sources.compileEngine).toBe('env');
    expect(JSON.parse(await fs.readFile(t.cfg.settingsFile, 'utf8'))).toEqual({});
  });

  it.each(['local', 'inexistente'])('carga el motor guardado %s y señala valores inválidos', async (value) => {
    t = await setup({ COMPILE_ENGINE: 'auto' }, { before: async (dir) => {
      await fs.mkdir(path.join(dir, 'data'), { recursive: true });
      await fs.writeFile(path.join(dir, 'data/settings.json'), JSON.stringify({ compileEngine: value }));
    } });
    const view = (await t.app.inject({ url: '/api/settings' })).json();
    expect(view.values.compileEngine).toBe(value === 'local' ? 'local' : 'auto');
    expect(view.sources.compileEngine).toBe(value === 'local' ? 'settings' : 'env');
    expect(view.checks.some((check: any) => check.key === 'compileEngine' && check.level === 'error')).toBe(value !== 'local');
  });

  it('rechaza valores inválidos sin aplicar ni escribir nada', async () => {
    t = await setup();
    for (const value of ['', null, 42, 'tectonic', '../local']) {
      const response = await put(value);
      expect(response.statusCode).toBe(400);
      expect(response.json().field).toBe('compileEngine');
    }
    expect(t.cfg.compileEngine).toBe('docker');
    await expect(fs.stat(t.cfg.settingsFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requiere administración también para cambiar el motor', async () => {
    t = await setup();
    const response = await put('local', '10.0.0.2');
    expect(response.statusCode).toBe(403);
    expect(t.cfg.compileEngine).toBe('docker');
    await expect(fs.stat(t.cfg.settingsFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
