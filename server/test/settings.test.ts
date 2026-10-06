import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config.ts';
import { flatPaths, setup, type TestEnv } from './helpers.ts';

let t: TestEnv | null = null;
const extra: string[] = [];
afterEach(async () => {
  await t?.close();
  t = null;
  for (const d of extra.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const REMOTE = { remoteAddress: '10.0.0.5' };

async function newDir(env: TestEnv, name: string, files: Record<string, string> = {}): Promise<string> {
  const d = path.join(env.dir, name);
  await fs.mkdir(d, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(d, rel)), { recursive: true });
    await fs.writeFile(path.join(d, rel), content);
  }
  return d;
}

const put = (env: TestEnv, payload: unknown, extraOpts: Record<string, unknown> = {}) =>
  env.app.inject({ method: 'PUT', url: '/api/settings', payload: payload as any, ...extraOpts });

describe('GET /api/settings', () => {
  it('values, sources (env/default), allowedRoots and checks', async () => {
    t = await setup({ MEMORIA_MAIN: '' });
    const r = await t.app.inject({ url: '/api/settings' });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.values).toEqual({
      notesDir: t.cfg.notesDir,
      resourcesSubdir: 'Recursos',
      memoriaDir: t.cfg.memoriaDir,
      memoriaMain: 'tfg.tex',
    });
    expect(s.sources).toEqual({ notesDir: 'env', resourcesSubdir: 'env', memoriaDir: 'env', memoriaMain: 'default' });
    expect(s.allowedRoots).toEqual([t.dir]);
    expect(s.checks).toContainEqual({ key: 'memoriaMain', level: 'ok', message: 'Archivo principal: tfg.tex' });
    expect(s.checks.find((c: any) => c.key === 'notesDir' && c.level === 'warning').message).toMatch(/Obsidian/);
    expect(s.checks.every((c: any) => c.level !== 'error')).toBe(true);
  });

  it('checks: missing main, memoria inside notes', async () => {
    t = await setup();
    const inner = await newDir(t, 'fixtures/notes/memo', { 'otro.tex': 'x' });
    expect((await put(t, { memoriaDir: inner })).statusCode).toBe(200);
    const s = (await t.app.inject({ url: '/api/settings' })).json();
    expect(s.checks).toContainEqual(expect.objectContaining({ key: 'memoriaMain', level: 'error' }));
    expect(s.checks).toContainEqual(expect.objectContaining({ key: 'memoriaDir', level: 'warning', message: expect.stringMatching(/dentro de la carpeta de notas/) }));
  });
});

describe('PUT /api/settings', () => {
  it('saves to data/settings.json, applies hot (tree changes) and emits SSE settings', async () => {
    t = await setup();
    const notes2 = await newDir(t, 'notas2', { 'Hola.md': '# hola' });
    const seen: any[] = [];
    t.ctx.bus.on('settings', (v) => seen.push(v));
    const before = (await t.app.inject({ url: '/api/status' })).json().instanceId;

    const r = await put(t, { notesDir: notes2.replace(os.homedir(), os.homedir()), resourcesSubdir: 'Inbox/Recursos/' });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.values.notesDir).toBe(notes2);
    expect(s.values.resourcesSubdir).toBe('Inbox/Recursos');
    expect(s.sources.notesDir).toBe('settings');
    expect(s.sources.memoriaDir).toBe('env');
    // resourcesSubdir created
    expect((await fs.stat(path.join(notes2, 'Inbox', 'Recursos'))).isDirectory()).toBe(true);
    // persisted next to builds/
    const stored = JSON.parse(await fs.readFile(path.join(t.dir, 'data', 'settings.json'), 'utf8'));
    expect(stored).toEqual({ notesDir: notes2, resourcesSubdir: 'Inbox/Recursos' });
    // hot-applied
    const tree = (await t.app.inject({ url: '/api/tree?root=notes' })).json();
    expect(flatPaths(tree.entries)).toEqual(['Inbox', 'Inbox/Recursos', 'Hola.md']);
    const status = (await t.app.inject({ url: '/api/status' })).json();
    expect(status.notesDir).toBe(notes2);
    expect(status.instanceId).not.toBe(before);
    expect(status.instanceId).toMatch(/^[0-9a-f]{12}$/);
    expect(seen).toHaveLength(1);
    expect(seen[0].values.notesDir).toBe(notes2);
  });

  it('expands ~ (inside the home)', async () => {
    const home = await fs.realpath(os.homedir());
    const d = await fs.realpath(await fs.mkdtemp(path.join(home, '.estudio-tfg-test-')));
    extra.push(d);
    t = await setup({ ALLOWED_ROOTS: '' }); // default = home
    const rel = '~/' + path.relative(home, d);
    const r = await put(t, { memoriaDir: rel });
    expect(r.statusCode).toBe(200);
    expect(r.json().values.memoriaDir).toBe(path.join(os.homedir(), path.relative(home, d)));
  });

  it('validation errors → 400 { error, field } and nothing is written', async () => {
    t = await setup();
    await newDir(t, 'archivo-padre');
    await fs.writeFile(path.join(t.dir, 'un-archivo'), 'x');
    const cases: [Record<string, unknown>, string][] = [
      [{ notesDir: 'relativa/notas' }, 'notesDir'],
      [{ notesDir: path.join(t.dir, 'no-existe') }, 'notesDir'],
      [{ memoriaDir: path.join(t.dir, 'un-archivo') }, 'memoriaDir'],
      [{ memoriaDir: '' }, 'memoriaDir'],
      [{ memoriaDir: 42 }, 'memoriaDir'],
      [{ notesDir: '/' }, 'notesDir'],
      [{ resourcesSubdir: '../fuera' }, 'resourcesSubdir'],
      [{ resourcesSubdir: '/abs' }, 'resourcesSubdir'],
      [{ memoriaMain: 'main.sty' }, 'memoriaMain'],
      [{ memoriaMain: '../main.tex' }, 'memoriaMain'],
      [{ memoriaMain: '-shell-escape.tex' }, 'memoriaMain'],
      // one bad field rejects the whole update
      [{ resourcesSubdir: 'Ok', notesDir: 'mal' }, 'notesDir'],
    ];
    for (const [body, field] of cases) {
      const r = await put(t, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json().field).toBe(field);
      expect(r.json().error).toBeTruthy();
    }
    await expect(fs.stat(t.cfg.settingsFile)).rejects.toThrow();
    expect(t.cfg.resourcesSubdir).toBe('Recursos');
  });

  it('ALLOWED_ROOTS: rejects folders outside, including via symlink (realpath)', async () => {
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-outside-')));
    extra.push(outside);
    t = await setup();
    await fs.symlink(outside, path.join(t.dir, 'enlace'));
    for (const v of [outside, path.join(t.dir, 'enlace'), path.join(t.dir, '..')]) {
      const r = await put(t, { notesDir: v });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: expect.stringMatching(/fuera de las carpetas permitidas/), field: 'notesDir' });
    }
    const init = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir: path.join(t.dir, 'enlace', 'nueva') } });
    expect(init.statusCode).toBe(400);
    expect(init.json().field).toBe('dir');
    await expect(fs.stat(path.join(outside, 'nueva'))).rejects.toThrow();
    // resourcesSubdir through a symlink escaping notesDir
    await fs.symlink(outside, path.join(t.cfg.notesDir, 'escape'));
    const rs = await put(t, { resourcesSubdir: 'escape/Recursos' });
    expect(rs.statusCode).toBe(400);
    expect(rs.json().field).toBe('resourcesSubdir');
  });

  it('repo guard: versioned repo folders are rejected (workspace/ allowed)', async () => {
    t = await setup({ ALLOWED_ROOTS: `${'/'}` });
    for (const v of [REPO_ROOT, path.join(REPO_ROOT, 'docs'), path.join(REPO_ROOT, 'templates', 'base')]) {
      const r = await put(t, { memoriaDir: v });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: expect.stringMatching(/dentro del repositorio/), field: 'memoriaDir' });
    }
    // symlink pointing into the repo is caught too
    await fs.symlink(path.join(REPO_ROOT, 'docs'), path.join(t.dir, 'docs-link'));
    const r = await put(t, { notesDir: path.join(t.dir, 'docs-link') });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/dentro del repositorio/);
  });

  it('serialises concurrent writes', async () => {
    t = await setup();
    const dirs = await Promise.all([1, 2, 3, 4, 5].map((i) => newDir(t!, `n${i}`)));
    const rs = await Promise.all(dirs.map((d, i) => put(t!, i % 2 ? { notesDir: d } : { memoriaDir: d })));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const stored = JSON.parse(await fs.readFile(t.cfg.settingsFile, 'utf8'));
    expect(stored).toEqual({ memoriaDir: dirs[4], notesDir: dirs[3] });
    expect(t.cfg.memoriaDir).toBe(dirs[4]);
  });
});

describe('precedence and reset', () => {
  it('settings.json > .env > default; reset goes back', async () => {
    let notes2 = '';
    t = await setup(
      {},
      {
        before: async (dir) => {
          notes2 = path.join(dir, 'notas-guardadas');
          await fs.mkdir(notes2);
          await fs.mkdir(path.join(dir, 'data'), { recursive: true });
          await fs.writeFile(path.join(dir, 'data', 'settings.json'), JSON.stringify({ notesDir: notes2, memoriaMain: 'otro.tex', basura: 1 }));
        },
      },
    );
    const s = (await t.app.inject({ url: '/api/settings' })).json();
    expect(s.values.notesDir).toBe(notes2);
    expect(s.values.memoriaMain).toBe('otro.tex');
    expect(s.sources).toEqual({ notesDir: 'settings', resourcesSubdir: 'env', memoriaDir: 'env', memoriaMain: 'settings' });

    const bad = await t.app.inject({ method: 'POST', url: '/api/settings/reset', payload: { keys: ['nope'] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().field).toBe('keys');

    const seen: any[] = [];
    t.ctx.bus.on('settings', (v) => seen.push(v));
    const r = await t.app.inject({ method: 'POST', url: '/api/settings/reset', payload: { keys: ['notesDir'] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().values.notesDir).toBe(path.join(t.dir, 'fixtures', 'notes'));
    expect(r.json().sources.notesDir).toBe('env');
    expect(r.json().sources.memoriaMain).toBe('settings');
    expect(JSON.parse(await fs.readFile(t.cfg.settingsFile, 'utf8'))).toEqual({ memoriaMain: 'otro.tex' });
    expect(seen).toHaveLength(1);
    expect(t.cfg.notesDir).toBe(path.join(t.dir, 'fixtures', 'notes'));
  });

  it('invalid stored values fall back to .env and are reported (startup does not fail)', async () => {
    t = await setup(
      { ALLOWED_ROOTS: '/' },
      {
        before: async (dir) => {
          await fs.mkdir(path.join(dir, 'data'), { recursive: true });
          await fs.writeFile(
            path.join(dir, 'data', 'settings.json'),
            JSON.stringify({ notesDir: path.join(REPO_ROOT, 'docs'), memoriaDir: 'relativa', resourcesSubdir: '../x' }),
          );
        },
      },
    );
    const s = (await t.app.inject({ url: '/api/settings' })).json();
    expect(s.values.notesDir).toBe(path.join(t.dir, 'fixtures', 'notes'));
    expect(s.values.memoriaDir).toBe(path.join(t.dir, 'fixtures', 'memoria'));
    expect(s.values.resourcesSubdir).toBe('Recursos');
    expect(s.sources).toEqual({ notesDir: 'env', resourcesSubdir: 'env', memoriaDir: 'env', memoriaMain: 'env' });
    const errs = s.checks.filter((c: any) => c.level === 'error');
    expect(errs.map((c: any) => c.key).sort()).toEqual(['memoriaDir', 'notesDir', 'resourcesSubdir']);
    expect(errs.find((c: any) => c.key === 'notesDir').message).toMatch(/dentro del repositorio/);
  });

  it('corrupt settings.json → error check, env values', async () => {
    t = await setup(
      {},
      {
        before: async (dir) => {
          await fs.mkdir(path.join(dir, 'data'), { recursive: true });
          await fs.writeFile(path.join(dir, 'data', 'settings.json'), '{ no es json');
        },
      },
    );
    const s = (await t.app.inject({ url: '/api/settings' })).json();
    expect(s.checks).toContainEqual(expect.objectContaining({ key: 'settings', level: 'error' }));
    expect((await t.app.inject({ url: '/api/status' })).json().configured).toBe(true);
  });
});

describe('security: PUT/reset/init-memoria/fs-dirs', () => {
  it('403 from a non-loopback address without AUTH_TOKEN (X-Forwarded-For ignored)', async () => {
    t = await setup();
    const d = await newDir(t, 'n2');
    const xff = { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' };
    const calls = [
      { method: 'PUT' as const, url: '/api/settings', payload: { notesDir: d } },
      { method: 'POST' as const, url: '/api/settings/reset', payload: { keys: ['notesDir'] } },
      { method: 'POST' as const, url: '/api/settings/init-memoria', payload: { dir: path.join(t.dir, 'nueva') } },
      { method: 'GET' as const, url: '/api/fs/dirs' },
    ];
    for (const c of calls) {
      const r = await t.app.inject({ ...c, ...REMOTE, headers: xff });
      expect(r.statusCode, c.url).toBe(403);
      expect(r.json().error).toBeTruthy();
    }
    expect(t.cfg.notesDir).not.toBe(d);
    await expect(fs.stat(path.join(t.dir, 'nueva'))).rejects.toThrow();
    // reading is allowed
    expect((await t.app.inject({ url: '/api/settings', ...REMOTE })).statusCode).toBe(200);
    // loopback (v4, v6, v4-mapped) is allowed
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect((await t.app.inject({ url: '/api/fs/dirs', remoteAddress })).statusCode).toBe(200);
    }
  });

  it('with AUTH_TOKEN: valid token required, from anywhere', async () => {
    t = await setup({ AUTH_TOKEN: 's3cret' });
    const d = await newDir(t, 'n2');
    expect((await put(t, { notesDir: d })).statusCode).toBe(401);
    expect((await put(t, { notesDir: d }, { ...REMOTE, headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    const ok = await put(t, { notesDir: d }, { ...REMOTE, headers: { authorization: 'Bearer s3cret' } });
    expect(ok.statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/fs/dirs', ...REMOTE, headers: { cookie: 'et_token=s3cret' } })).statusCode).toBe(200);
  });
});

describe('POST /api/settings/init-memoria', () => {
  it('missing dir → created from the template with its own git repo, applied', async () => {
    t = await setup();
    const dir = path.join(t.dir, 'mis-cosas', 'memoria-nueva');
    const r = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir } });
    expect(r.statusCode).toBe(200);
    expect(r.json().values.memoriaDir).toBe(dir);
    expect(r.json().sources.memoriaDir).toBe('settings');
    expect((await fs.stat(path.join(dir, 'tfg.tex'))).isFile()).toBe(true);
    expect((await fs.stat(path.join(dir, '.git'))).isDirectory()).toBe(true);
    const log = execFileSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' });
    expect(log).toMatch(/plantilla/);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('');
    const tree = (await t.app.inject({ url: '/api/tree?root=memoria' })).json();
    expect(flatPaths(tree.entries)).toContain('tfg.tex');
    expect(JSON.parse(await fs.readFile(t.cfg.settingsFile, 'utf8')).memoriaDir).toBe(dir);
  });

  it('empty existing dir → ok; non-empty → 409 and nothing changes', async () => {
    t = await setup();
    const empty = await newDir(t, 'vacia');
    await fs.writeFile(path.join(empty, '.DS_Store'), '');
    expect((await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir: empty } })).statusCode).toBe(200);

    const full = await newDir(t, 'llena', { 'mio.tex': 'no tocar' });
    const before = t.cfg.memoriaDir;
    const r = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir: full } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/no está vacía/);
    expect(await fs.readdir(full)).toEqual(['mio.tex']);
    expect(t.cfg.memoriaDir).toBe(before);

    const bad = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir: 'relativa' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().field).toBe('dir');
  });

  it('perfil: esi-uclm by default, generico on request (base + perfil, without perfil.json)', async () => {
    t = await setup();
    const esi = path.join(t.dir, 'esi');
    expect((await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir: esi } })).statusCode).toBe(200);
    expect(await fs.readFile(path.join(esi, 'estilo', 'institucion.tex'), 'utf8')).toMatch(/\\universidad\{Universidad de Castilla-La Mancha\}/);
    expect((await fs.stat(path.join(esi, 'estilo', 'esi_logo.pdf'))).isFile()).toBe(true);
    expect((await fs.stat(path.join(esi, '1-capitulos', '04-metodologia.tex'))).isFile()).toBe(true);
    expect(await fs.readFile(path.join(esi, 'tfg.tex'), 'utf8')).toMatch(/\\documentclass\{estilo\/memoria\}/);

    const gen = path.join(t.dir, 'gen');
    const r = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir: gen, perfil: 'generico' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().values.memoriaDir).toBe(gen);
    const files = execFileSync('git', ['ls-files'], { cwd: gen, encoding: 'utf8' }).trim().split('\n');
    expect(files).toEqual(expect.arrayContaining([
      'tfg.tex', 'datos.tex', 'bibliografia.bib', '.gitignore', 'estilo/memoria.cls', 'estilo/institucion.tex',
      '1-capitulos/03-estado.tex', '1-capitulos/04-desarrollo.tex',
    ]));
    expect(files).not.toContain('perfil.json');
    expect(files).not.toContain('estilo/esi_logo.pdf');
    expect(files).not.toContain('1-capitulos/04-metodologia.tex');
    expect(await fs.readFile(path.join(gen, 'tfg.tex'), 'utf8')).toMatch(/04-desarrollo/);
    expect(await fs.readFile(path.join(gen, 'estilo', 'institucion.tex'), 'utf8')).toMatch(/\\logo\{\}/);
  });

  it('unknown perfil → 400 {field: perfil} and nothing is created', async () => {
    t = await setup();
    const before = t.cfg.memoriaDir;
    for (const perfil of ['no-existe', '../base', 42, 'perfiles']) {
      const dir = path.join(t.dir, 'nueva');
      const r = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir, perfil } });
      expect(r.statusCode, String(perfil)).toBe(400);
      expect(r.json()).toEqual({ error: expect.stringMatching(/Perfil de plantilla desconocido/), field: 'perfil' });
      await expect(fs.stat(dir)).rejects.toThrow();
    }
    expect(t.cfg.memoriaDir).toBe(before);
  });
});

describe('GET /api/templates/perfiles', () => {
  it('lists the profiles from templates/perfiles, default first', async () => {
    t = await setup();
    const r = await t.app.inject({ url: '/api/templates/perfiles', ...REMOTE });
    expect(r.statusCode).toBe(200);
    const { perfiles } = r.json();
    expect(perfiles.map((p: any) => p.id)).toEqual(['esi-uclm', 'generico']);
    for (const p of perfiles) {
      expect(p).toEqual({ id: expect.any(String), nombre: expect.any(String), descripcion: expect.any(String) });
      expect(p.nombre.length).toBeGreaterThan(0);
    }
  });
});

describe('GET /api/fs/dirs', () => {
  it('lists allowed roots, subfolders with flags, hides dotfiles, parent null at a root', async () => {
    t = await setup();
    await newDir(t, 'Vault/.obsidian');
    await newDir(t, 'Memoria', { 'main.tex': 'x' });
    await newDir(t, 'Repo/.git');
    await newDir(t, '.oculta');
    await fs.writeFile(path.join(t.dir, 'archivo.txt'), 'x');
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-outside-')));
    extra.push(outside);
    await fs.symlink(outside, path.join(t.dir, 'zz-fuera'));
    await fs.symlink(path.join(t.dir, 'Memoria'), path.join(t.dir, 'zz-dentro'));

    const roots = (await t.app.inject({ url: '/api/fs/dirs' })).json();
    expect(roots.parent).toBeNull();
    expect(roots.dirs.map((d: any) => d.path)).toEqual([t.dir]);

    const r = (await t.app.inject({ url: `/api/fs/dirs?path=${encodeURIComponent(t.dir)}` })).json();
    expect(r.path).toBe(t.dir);
    expect(r.parent).toBeNull();
    const names = r.dirs.map((d: any) => d.name);
    expect(names).toEqual(['data', 'fixtures', 'Memoria', 'Repo', 'Vault', 'zz-dentro']);
    const by = Object.fromEntries(r.dirs.map((d: any) => [d.name, d]));
    expect(by.Vault).toEqual({ name: 'Vault', path: path.join(t.dir, 'Vault'), isObsidianVault: true, hasMainTex: false, isGitRepo: false });
    expect(by.Memoria.hasMainTex).toBe(true);
    expect(by.Repo.isGitRepo).toBe(true);

    const sub = (await t.app.inject({ url: `/api/fs/dirs?path=${encodeURIComponent(path.join(t.dir, 'fixtures'))}` })).json();
    expect(sub.parent).toBe(t.dir);
    expect(sub.dirs.map((d: any) => d.name)).toEqual(['memoria', 'notes']);

    for (const p of [outside, path.join(t.dir, 'zz-fuera'), path.join(t.dir, '..')]) {
      const x = await t.app.inject({ url: `/api/fs/dirs?path=${encodeURIComponent(p)}` });
      expect(x.statusCode, p).toBe(400);
    }
    expect((await t.app.inject({ url: '/api/fs/dirs?path=relativa' })).statusCode).toBe(400);
    expect((await t.app.inject({ url: `/api/fs/dirs?path=${encodeURIComponent(path.join(t.dir, 'nada'))}` })).statusCode).toBe(404);
  });
});

describe('not configured at startup', () => {
  it('starts, reports configured=false and file endpoints answer 409 until configured', async () => {
    t = await setup({ NOTES_DIR: './no-existe/notas' }, { watch: true });
    const st = (await t.app.inject({ url: '/api/status' })).json();
    expect(st.configured).toBe(false);
    expect(st.instanceId).toMatch(/^[0-9a-f]{12}$/);
    const s = (await t.app.inject({ url: '/api/settings' })).json();
    expect(s.checks).toContainEqual(expect.objectContaining({ key: 'notesDir', level: 'error' }));

    for (const url of ['/api/tree?root=notes', '/api/file?root=notes&path=a.md', '/api/resources', '/api/search?q=a', '/api/notes/resolve?target=a']) {
      const r = await t.app.inject({ url });
      expect(r.statusCode, url).toBe(409);
      expect(r.json().error).toMatch(/^Configura las carpetas en Ajustes/);
    }
    // memoria still works
    expect((await t.app.inject({ url: '/api/tree?root=memoria' })).statusCode).toBe(200);

    const notes = await newDir(t, 'notas-nuevas', { 'a.md': 'hola' });
    expect((await put(t, { notesDir: notes })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/status' })).json().configured).toBe(true);
    expect((await t.app.inject({ url: '/api/file?root=notes&path=a.md' })).json().content).toBe('hola');
  });
});

describe('hot-apply restarts the watcher', () => {
  it('change events come from the new folder after PUT', { timeout: 40_000 }, async () => {
    t = await setup({}, { watch: true });
    const notes2 = await newDir(t, 'notas2');
    const changes: any[] = [];
    t.ctx.bus.on('change', (e) => changes.push(e));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (pred: () => boolean, ms: number) => {
      const deadline = Date.now() + ms;
      while (!pred() && Date.now() < deadline) await sleep(50);
      return pred();
    };
    expect((await put(t, { notesDir: notes2 })).statusCode).toBe(200);
    // 'ready' can fire before fs.watch/FSEvents actually delivers events (under load the first
    // writes get lost): probe with fresh files until the new watcher is demonstrably live.
    let live = false;
    for (let i = 0; i < 20 && !live; i++) {
      await fs.writeFile(path.join(notes2, `sonda-${i}.md`), 'x');
      live = await waitFor(() => changes.some((c) => c.root === 'notes' && c.path.startsWith('sonda-')), 1000);
    }
    expect(live).toBe(true);
    await fs.writeFile(path.join(notes2, 'nueva.md'), 'x');
    await fs.writeFile(path.join(t.dir, 'fixtures', 'notes', 'vieja.md'), 'x');
    await waitFor(() => changes.some((c) => c.path === 'nueva.md'), 10_000);
    // grace period so a (wrong) event from the old folder would have arrived
    await sleep(500);
    expect(changes).toContainEqual({ root: 'notes', path: 'nueva.md', kind: 'add' });
    expect(changes.some((c) => c.path === 'vieja.md')).toBe(false);
  });
});
