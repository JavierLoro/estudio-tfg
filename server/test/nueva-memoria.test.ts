import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { nuevaMemoria } from '../src/nueva-memoria.ts';
import { parseDatos } from '../src/datos.ts';
import { setup, type TestEnv } from './helpers.ts';

const config = () => ({
  datos: { titulo: 'Título & prueba_1', autor: 'Autora ficticia', idioma: 'ingles' },
  institucion: { papel: 'carta', caras: 'dos', margenInterior: '32mm', margenExterior: '21mm', margenSuperior: '25mm', margenInferior: '25mm' },
  apartados: { portada: true, portadaInterior: false, resumen: true, abstract: true, bibliografia: true, anexo: true },
  capitulos: ['Introducción', 'Mi capítulo & sus pruebas'],
});
let t: TestEnv | null = null;
afterEach(async () => { await t?.close(); t = null; });

it('genera solo la estructura elegida, escapa los textos y conserva las dos ramas de idioma', () => {
  const files = nuevaMemoria(config());
  expect([...files.keys()]).not.toContain('1-capitulos/02-objetivos.tex');
  expect([...files.values()].join('\n')).not.toContain('Universidad de Castilla');
  expect(files.get('datos.tex')).toContain(String.raw`\titulo{Título \& prueba\_1}`);
  expect(files.get('1-capitulos/02-capitulo.tex')).toContain(String.raw`\chapter{Mi capítulo \& sus pruebas}`);
  expect(parseDatos(files.get('estilo/institucion.tex') as string, 'institucion')).toMatchObject({
    papel: 'carta', caras: 'dos', mostrarPortada: 'si', mostrarPortadaInterior: 'no', mostrarTribunal: 'no',
    numeracionPaginas: 'romanos', estiloPagina: 'actual', pieCentro: 'pagina',
  });
  const main = files.get('tfg.tex') as string;
  expect(main).toContain('\\iflanguage{english}{%\n  \\input{0-inicio/abstract}\n  \\input{0-inicio/resumen}');
  expect(main).toContain('\\appendix');
  expect(files.get('2-anexos/a-anexo.tex')).toContain('\\chapter{Appendix}');
  expect(files.get('bibliografia.bib')).not.toMatch(/@(book|article)/);
});

it('valida toda la configuración y los títulos antes de generar archivos', () => {
  for (const cfg of [
    { ...config(), capitulos: [] }, { ...config(), capitulos: ['Repetido', 'REPETIDO'] },
    { ...config(), capitulos: ['A\nB'] }, { ...config(), capitulos: Array(31).fill('Capítulo') },
    { ...config(), apartados: { portada: 'si' } }, { ...config(), apartados: { inventado: true } },
    { ...config(), institucion: { margenInterior: '1000mm' } },
    { ...config(), institucion: { margenInterior: '80mm', margenExterior: '80mm' } },
    { ...config(), datos: { idioma: 'frances' } }, { ...config(), datos: { titulo: 123 } },
    { ...config(), institucion: { logo: '../ajeno.pdf' } },
    { ...config(), institucion: { indiceGeneral: true } },
    { ...config(), institucion: { numerarHasta: 'cuatro' } },
  ]) expect(() => nuevaMemoria(cfg)).toThrow();
});

it('mantiene el bloque de índices y permite reactivarlos después de crear sin ninguno', () => {
  const cfg = config();
  const files = nuevaMemoria({ ...cfg, apartados: { ...cfg.apartados, indices: false } });
  expect(files.get('tfg.tex')).toContain('\\indices');
  expect(parseDatos(files.get('estilo/institucion.tex') as string, 'institucion')).toMatchObject({
    indiceGeneral: 'no', indiceFiguras: 'no', indiceTablas: 'no', indiceCodigo: 'no',
  });
  const selected = nuevaMemoria({ ...cfg, institucion: { ...cfg.institucion, indiceGeneral: 'no', indiceFiguras: 'si', numerarHasta: 'capitulos', indiceHasta: 'subsecciones' } });
  expect(parseDatos(selected.get('estilo/institucion.tex') as string, 'institucion')).toMatchObject({
    indiceGeneral: 'no', indiceFiguras: 'si', numerarHasta: 'capitulos', indiceHasta: 'subsecciones',
  });
});

it('crea y selecciona una memoria nueva con el principal correcto y un historial inicial limpio', async () => {
  t = await setup({ MEMORIA_MAIN: 'otro.tex' });
  const dir = path.join(t.dir, 'desde-cero');
  const result = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir, configuracion: config() } });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().values).toMatchObject({ memoriaDir: dir, memoriaMain: 'tfg.tex' });
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('');
  const outline = (await t.app.inject('/api/memoria/outline')).json();
  expect(outline.warnings).toEqual([]);
  expect(outline.items.filter((item: any) => item.kind === 'chapter').map((item: any) => item.title)).toEqual(config().capitulos);
  const main = await fs.readFile(path.join(dir, 'tfg.tex'), 'utf8');
  const again = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: { dir, configuracion: config() } });
  expect(again.statusCode).toBe(409);
  expect(await fs.readFile(path.join(dir, 'tfg.tex'), 'utf8')).toBe(main);
});

it('una configuración inválida o mezcla con perfil ESI no crea carpetas ni cambia los ajustes', async () => {
  t = await setup();
  const before = t.cfg.memoriaDir;
  const dir = path.join(t.dir, 'no-crear');
  for (const body of [
    { dir, configuracion: { ...config(), capitulos: [] } },
    { dir, perfil: 'esi-uclm', configuracion: config() },
  ]) {
    const result = await t.app.inject({ method: 'POST', url: '/api/settings/init-memoria', payload: body });
    expect(result.statusCode).toBe(400);
    await expect(fs.stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(t.cfg.memoriaDir).toBe(before);
  }
});
