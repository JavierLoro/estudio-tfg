import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { REPO_ROOT, loadConfig, type Config } from '../src/config.ts';
import { GIT_IDENTITY, copyTemplate, manifestProblems, sha256 } from '../../scripts/memoria-template.mjs';

// Plantilla v0.3 tal como quedó en el repo (templates/esi-tfg/ en 2529624).
const V03_COMMIT = '2529624';
const V03_PREFIX = 'templates/esi-tfg/';

function v03Files(): Map<string, Buffer> {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
  const out = new Map<string, Buffer>();
  for (const r of git('ls-tree', '-r', '--name-only', V03_COMMIT, V03_PREFIX).toString().split('\n').filter(Boolean)) {
    out.set(r.slice(V03_PREFIX.length), git('show', `${V03_COMMIT}:${r}`));
  }
  return out;
}

let dir = '';
let cfg: Config;
let app: Awaited<ReturnType<typeof buildApp>>['app'];
const mem = (rel = '') => path.join(dir, 'memoria', rel);

async function boot(fill: (memDir: string) => Promise<void> | void) {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-plantilla-')));
  await fs.mkdir(path.join(dir, 'notes'), { recursive: true });
  await fs.mkdir(mem(), { recursive: true });
  await fill(mem());
  cfg = loadConfig(
    {
      NOTES_DIR: './notes',
      MEMORIA_DIR: './memoria',
      RESOURCES_SUBDIR: 'Recursos',
      MEMORIA_MAIN: 'tfg.tex',
      BUILD_DIR: './data/builds',
      WORKER_URL: 'http://127.0.0.1:1',
      AUTH_TOKEN: '',
      ALLOWED_ROOTS: dir,
    },
    dir,
  );
  ({ app } = await buildApp(cfg, { serveWeb: false }));
  await app.ready();
}

async function writeV03(memDir: string) {
  for (const [rel, buf] of v03Files()) {
    await fs.mkdir(path.dirname(path.join(memDir, rel)), { recursive: true });
    await fs.writeFile(path.join(memDir, rel), buf);
  }
}

const git = (...a: string[]) => execFileSync('git', a, { cwd: mem(), encoding: 'utf8' });
function gitInit() {
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git(...GIT_IDENTITY, 'commit', '-qm', 'Memoria v0.3');
}

const read = (rel: string) => fs.readFile(mem(rel), 'utf8');
const exists = (rel: string) => fs.stat(mem(rel)).then(() => true, () => false);
const preview = async (perfil?: string) =>
  (await app.inject({ url: `/api/memoria/plantilla${perfil ? `?perfil=${perfil}` : ''}` })).json();
const actualizar = (body: unknown) => app.inject({ method: 'POST', url: '/api/memoria/plantilla/actualizar', payload: body as object });
const deshacer = (id: string) => app.inject({ method: 'POST', url: '/api/memoria/plantilla/deshacer', payload: { id } });

/** Snapshot de toda la memoria (sin .git). */
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string, rel: string) => {
    for (const ent of await fs.readdir(d, { withFileTypes: true })) {
      if (ent.name === '.git') continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(path.join(d, ent.name), r);
      else out[r] = sha256(await fs.readFile(path.join(d, ent.name)));
    }
  };
  await walk(mem(), '');
  return out;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (app) await app.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = '';
});

describe('manifiestos', () => {
  it('el manifiesto de la plantilla actual está al día (npm run template:manifest)', () => {
    expect(manifestProblems()).toEqual([]);
  });
});

describe('GET /api/memoria/plantilla (vista previa)', () => {
  it('(a) memoria v0.3 sin tocar: lista todos los cambios y no escribe nada', async () => {
    await boot(writeV03);
    const before = await snapshot();
    const p = await preview();
    expect(p).toMatchObject({ estado: 'desactualizada', versionMemoria: 'v0.3', versionPlantilla: 'v0.5', perfil: 'esi-uclm', revisar: [] });
    const acc = Object.fromEntries(p.cambios.map((c: any) => [c.archivo, c.accion]));
    expect(acc).toEqual({
      'tfg.tex': 'editar',
      'estilo/memoria.cls': 'crear',
      'estilo/esi-tfg.cls': 'retirar',
      'estilo/institucion.tex': 'crear',
      'datos.tex': 'editar',
      '0-inicio/abstract.tex': 'sustituir',
      '0-inicio/acronimos.tex': 'sustituir',
      '0-inicio/resumen.tex': 'sustituir',
      'LEEME.md': 'sustituir',
      'bibliografia.bib': 'sustituir',
      '.gitignore': 'editar',
    });
    // Los capítulos y figuras no cambiaron en la plantilla: no se tocan.
    expect(acc['1-capitulos/01-introduccion.tex']).toBeUndefined();
    expect(await snapshot()).toEqual(before);
  });

  it('(a) aplicar: el resultado es la plantilla actual salvo las ediciones puntuales', async () => {
    await boot(writeV03);
    const p = await preview();
    const r = await actualizar({ perfil: p.perfil, cambios: p.cambios });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.commit).toBeNull();
    expect(body.aplicados).toHaveLength(p.cambios.length);
    expect(typeof body.deshacer).toBe('string');

    const tpl = path.join(REPO_ROOT, 'templates');
    const fromTpl = (rel: string) => fs.readFile(path.join(tpl, 'base', rel), 'utf8');
    expect(await exists('estilo/esi-tfg.cls')).toBe(false);
    expect(await read('estilo/memoria.cls')).toBe(await fromTpl('estilo/memoria.cls'));
    expect(await read('estilo/institucion.tex')).toBe(await fs.readFile(path.join(tpl, 'perfiles/esi-uclm/estilo/institucion.tex'), 'utf8'));
    expect(await read('0-inicio/abstract.tex')).toBe(await fromTpl('0-inicio/abstract.tex'));
    expect(await read('.gitignore')).toContain('*.bcf');

    const tfg = await read('tfg.tex');
    expect(tfg).toContain('\\documentclass{estilo/memoria}           % formato de la memoria (no tocar)');
    expect(tfg).toMatch(/^\\indices /m);
    expect(tfg).not.toContain('\\tableofcontents');
    // «Nada más»: el resto de líneas queda como estaba.
    expect(tfg).toContain('% créditos: autor, ciudad y copyright');

    const datos = await read('datos.tex');
    expect(datos).toContain('\\fecha{Junio}{2026}'); // valores intactos
    expect(datos).toContain('%% Añadido por Estudio TFG');
    expect(datos).toMatch(/^\\keywords\{keyword 1, keyword 2, keyword 3\} +% \(opcional\)/m);
    expect(datos).toMatch(/^\\modo\{borrador\} +%/m);
    expect(datos).toMatch(/^\\licencia\{reservados\}/m);
    expect(datos).toMatch(/^\\atribucion\{si\}/m);

    // Ya está al día.
    expect(await preview()).toMatchObject({ estado: 'actual', versionMemoria: 'v0.5', cambios: [] });
    // El historial guarda la copia anterior de cada archivo afectado.
    const hist = path.join(cfg.historyDir, 'memoria', 'estilo', 'esi-tfg.cls');
    expect((await fs.readdir(hist)).length).toBe(1);
  });

  it('(b) v0.3 con capítulos, abstract y datos editados: no los pisa y pide revisarlos', async () => {
    await boot(async (d) => {
      await writeV03(d);
      await fs.appendFile(path.join(d, '1-capitulos/01-introduccion.tex'), '\nMi introducción.\n');
      const abs = path.join(d, '0-inicio/abstract.tex');
      await fs.writeFile(abs, (await fs.readFile(abs, 'utf8')).replace('keyword 1, keyword 2, keyword 3', 'web, latex'));
      const datos = path.join(d, 'datos.tex');
      let s = await fs.readFile(datos, 'utf8');
      s = s.replace('Título de tu Trabajo Fin de Grado', 'Mi TFG').replace('palabra clave 1, palabra clave 2, palabra clave 3', 'web, latex');
      s = s.replace(/^\\ciudad\{.*\n/m, '');
      await fs.writeFile(datos, s);
    });
    const intro = await read('1-capitulos/01-introduccion.tex');
    const p = await preview();
    const archivos = p.cambios.map((c: any) => c.archivo);
    expect(archivos).not.toContain('0-inicio/abstract.tex');
    expect(archivos).not.toContain('1-capitulos/01-introduccion.tex');
    expect(p.revisar).toEqual([
      { archivo: '0-inicio/abstract.tex', motivo: expect.stringContaining('\\mostrarPalabrasClave') },
    ]);
    expect(p.cambios.find((c: any) => c.archivo === 'datos.tex').motivo).toContain('\\ciudad');

    const r = await actualizar({ perfil: p.perfil, cambios: p.cambios });
    expect(r.statusCode).toBe(200);
    expect(await read('1-capitulos/01-introduccion.tex')).toBe(intro);
    expect(await read('0-inicio/abstract.tex')).toContain('web, latex');
    const datos = await read('datos.tex');
    expect(datos).toContain('\\titulo{Mi TFG}');
    expect(datos).toMatch(/^\\keywords\{\}/m); // las palabras clave son suyas: no se inventan keywords
    expect(datos).toMatch(/^\\ciudad\{Ciudad Real\}/m);
  });

  it('perfil genérico en una memoria v0.3: institución genérica, sin logo, capítulos propios intactos', async () => {
    await boot(writeV03);
    const p = await preview('generico');
    expect(p.perfil).toBe('generico');
    const r = await actualizar({ perfil: 'generico', cambios: p.cambios });
    expect(r.statusCode).toBe(200);
    expect(await read('estilo/institucion.tex')).toContain('\\logo{}');
    expect(await exists('1-capitulos/03-estado.tex')).toBe(false);
    // Los capítulos de la ESI sin tocar no se cambian por los del perfil genérico.
    expect(p.cambios.map((c: any) => c.archivo).filter((a: string) => a.startsWith('1-capitulos/'))).toEqual([]);
    expect(p.revisar).toEqual([]);
    expect(await read('1-capitulos/01-introduccion.tex')).toBe(v03Files().get('1-capitulos/01-introduccion.tex')!.toString('utf8'));
    expect(await read('tfg.tex')).toContain('03-antecedentes');
    expect((await app.inject({ url: '/api/memoria/plantilla?perfil=nada' })).statusCode).toBe(200); // con institucion.tex se ignora
  });

  it('perfil desconocido → 400', async () => {
    await boot(writeV03);
    const r = await app.inject({ url: '/api/memoria/plantilla?perfil=nada' });
    expect(r.statusCode).toBe(400);
    expect(r.json().field).toBe('perfil');
  });

  it('(c) memoria creada con la plantilla actual: estado actual, sin cambios', async () => {
    await boot((d) => copyTemplate(d));
    expect(await preview()).toEqual({
      estado: 'actual',
      versionMemoria: 'v0.5',
      versionPlantilla: 'v0.5',
      perfil: 'esi-uclm',
      cambios: [],
      revisar: [],
    });
    const r = await actualizar({ perfil: 'esi-uclm', cambios: [] });
    expect(r.statusCode).toBe(409);
  });

  it('(c) perfil genérico deducido (sin logo de la ESI)', async () => {
    await boot((d) => copyTemplate(d, { perfil: 'generico' }));
    expect(await preview()).toMatchObject({ estado: 'actual', perfil: 'generico', cambios: [] });
  });

  it('(d) clase desconocida: no se ofrece actualizar', async () => {
    await boot(async (d) => {
      await writeV03(d);
      const cls = path.join(d, 'estilo/esi-tfg.cls');
      await fs.writeFile(cls, (await fs.readFile(cls, 'utf8')).replace(' v2.0 ', ' v1.7 '));
    });
    const p = await preview();
    expect(p).toMatchObject({ estado: 'desconocida', versionMemoria: null, cambios: [] });
    const r = await actualizar({ perfil: p.perfil, cambios: [] });
    expect(r.statusCode).toBe(409);
    expect(await exists('estilo/memoria.cls')).toBe(false);
  });

  it('(d) sin clase', async () => {
    await boot(async (d) => {
      await fs.writeFile(path.join(d, 'tfg.tex'), '\\documentclass{book}\n');
    });
    expect((await preview()).estado).toBe('desconocida');
  });
});

describe('git y deshacer', () => {
  it('un error de Git al deshacer se explica antes de restaurar archivos', async () => {
    await boot(async (d) => { await writeV03(d); gitInit(); });
    const p = await preview();
    const r = (await actualizar({ perfil: p.perfil, cambios: p.cambios })).json();
    expect(r.commit).toBeTruthy();
    const applied = await snapshot();
    await fs.appendFile(mem('.git/config'), '\n[configuración rota\n');
    const u = await deshacer(r.deshacer);
    expect(u.statusCode).toBe(502);
    expect(u.json().error).toMatch(/No se pudo deshacer el commit.*bad config line/);
    expect(await snapshot()).toEqual(applied);
  });

  it('un repositorio inaccesible devuelve el stderr de Git como aviso', async () => {
    await boot(async (d) => { await writeV03(d); gitInit(); });
    await fs.appendFile(mem('.git/config'), '\n[configuración rota\n');
    const p = await preview();
    const r = await actualizar({ perfil: p.perfil, cambios: p.cambios });
    expect(r.statusCode).toBe(200);
    expect(r.json().commit).toBeNull();
    expect(r.json().revisar).toContainEqual({ archivo: '.git', motivo: expect.stringMatching(/no se pudo hacer el commit:.*bad config line/) });
    expect(await exists('estilo/memoria.cls')).toBe(true);
    expect(r.json().deshacer).toBeTruthy();
  });

  it('un commit rechazado muestra las líneas de stderr y permite deshacer', async () => {
    await boot(async (d) => { await writeV03(d); gitInit(); });
    const before = await snapshot();
    await fs.writeFile(mem('.git/hooks/pre-commit'), '#!/bin/sh\necho "Fallo ficticio del hook" >&2\necho "Detalle del rechazo" >&2\nexit 1\n', { mode: 0o755 });
    const p = await preview();
    const r = (await actualizar({ perfil: p.perfil, cambios: p.cambios })).json();
    expect(r.commit).toBeNull();
    expect(r.revisar).toContainEqual({ archivo: '.git', motivo: 'no se pudo hacer el commit: Fallo ficticio del hook · Detalle del rechazo' });
    expect((await deshacer(r.deshacer)).statusCode).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  it('(e) commit solo de los archivos afectados; los demás cambios del usuario siguen sin commit', async () => {
    await boot(async (d) => {
      await writeV03(d);
    });
    gitInit();
    await fs.appendFile(mem('1-capitulos/03-antecedentes.tex'), '\nTexto sin commit.\n');
    await fs.writeFile(mem('notas.txt'), 'nuevo sin seguimiento\n');
    await fs.appendFile(mem('1-capitulos/02-objetivos.tex'), '\nPreparado en el índice.\n');
    git('add', '1-capitulos/02-objetivos.tex');

    const p = await preview();
    const r = await actualizar({ perfil: p.perfil, cambios: p.cambios });
    expect(r.statusCode).toBe(200);
    const { commit } = r.json();
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(git('rev-parse', 'HEAD').trim()).toBe(commit);
    expect(git('log', '-1', '--format=%s')).toBe('Actualizar plantilla a v0.5\n');
    const enCommit = git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort();
    expect(enCommit).toEqual(p.cambios.map((c: any) => c.archivo).sort());

    const status = git('status', '--porcelain');
    expect(status).toContain(' M 1-capitulos/03-antecedentes.tex');
    expect(status).toContain('M  1-capitulos/02-objetivos.tex');
    expect(status).toContain('?? notas.txt');
    expect(status.split('\n').filter(Boolean)).toHaveLength(3);
  });

  it('(f) deshacer restaura todos los archivos y revierte el commit', async () => {
    await boot(writeV03);
    gitInit();
    await fs.appendFile(mem('1-capitulos/03-antecedentes.tex'), '\nTexto sin commit.\n');
    const before = await snapshot();
    const head0 = git('rev-parse', 'HEAD').trim();

    const p = await preview();
    const r = (await actualizar({ perfil: p.perfil, cambios: p.cambios })).json();
    expect(await snapshot()).not.toEqual(before);

    const u = await deshacer(r.deshacer);
    expect(u.statusCode).toBe(200);
    const body = u.json();
    expect(body.restaurados.sort()).toEqual(p.cambios.map((c: any) => c.archivo).sort());
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await snapshot()).toEqual(before);
    expect(git('log', '--format=%s').split('\n').slice(0, 2)).toEqual(['Deshacer la actualización de la plantilla a v0.5', 'Actualizar plantilla a v0.5']);
    expect(git('diff', '--stat', head0, 'HEAD')).toBe('');
    expect(git('status', '--porcelain')).toBe(' M 1-capitulos/03-antecedentes.tex\n');
    expect((await preview()).estado).toBe('desactualizada');

    // Solo una vez.
    expect((await deshacer(r.deshacer)).statusCode).toBe(409);
  });

  it('deshacer sin git; 409 si un archivo cambió después de actualizar o no es la última', async () => {
    await boot(writeV03);
    vi.stubEnv('PATH', '');
    const before = await snapshot();
    const p = await preview();
    const r1 = (await actualizar({ perfil: p.perfil, cambios: p.cambios })).json();
    expect(r1.commit).toBeNull();
    await fs.appendFile(mem('datos.tex'), '% editado\n');
    expect((await deshacer(r1.deshacer)).statusCode).toBe(409);
    await fs.writeFile(mem('datos.tex'), (await read('datos.tex')).replace('% editado\n', ''));
    expect((await deshacer('2000-01-01T00-00-00-000Z-00000000')).statusCode).toBe(409);
    const u = await deshacer(r1.deshacer);
    expect(u.statusCode).toBe(200);
    expect(u.json().commit).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it('(g) 409 si la memoria cambió desde la vista previa', async () => {
    await boot(writeV03);
    const p = await preview();
    // Un archivo afectado cambia de contenido (misma acción, otra revisión).
    await fs.appendFile(mem('datos.tex'), '% nota\n');
    const r = await actualizar({ perfil: p.perfil, cambios: p.cambios });
    expect(r.statusCode).toBe(409);
    expect(r.json().actual.estado).toBe('desactualizada');
    expect(await exists('estilo/memoria.cls')).toBe(false);

    // El usuario edita un archivo que se iba a sustituir: cambia la lista.
    const p2 = await preview();
    await fs.appendFile(mem('0-inicio/resumen.tex'), '\nMi resumen.\n');
    const r2 = await actualizar({ perfil: p2.perfil, cambios: p2.cambios });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().actual.cambios.map((c: any) => c.archivo)).not.toContain('0-inicio/resumen.tex');

    // Otro perfil que el de la vista previa.
    const p3 = await preview();
    expect((await actualizar({ perfil: 'generico', cambios: p3.cambios })).statusCode).toBe(409);
    expect((await actualizar({ perfil: p3.perfil })).statusCode).toBe(400);
    expect((await actualizar({ perfil: p3.perfil, cambios: p3.cambios })).statusCode).toBe(200);
  });
});
