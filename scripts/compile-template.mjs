#!/usr/bin/env node
// Compila copias ficticias de todos los perfiles; nunca lee .env ni la memoria del usuario.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { isMain } from './dev.mjs';
import { copyTemplate, listPerfiles } from './memoria-template.mjs';
import { tsImport } from '../server/node_modules/tsx/dist/esm/api/index.mjs';

// Reutilizar el empaquetado seguro de la API con su ejecutor TypeScript ya instalado.
const { loadConfig } = await tsImport('../server/src/config.ts', import.meta.url);
const { createSourceTar, isValidBuildId } = await tsImport('../server/src/compile.ts', import.meta.url);
const { applyChanges } = await tsImport('../server/src/datos.ts', import.meta.url);
const { FUENTES_TEXTO } = await tsImport('../shared/tipografia.ts', import.meta.url);
const { nuevaMemoria } = await tsImport('../server/src/nueva-memoria.ts', import.meta.url);

export async function checkTemplateResult(body, outputDir) {
  if (body?.ok !== true || !Array.isArray(body.diagnostics)) throw new Error('La compilación no terminó correctamente');
  if (body.diagnostics.length) throw new Error(`La plantilla produjo ${body.diagnostics.length} diagnósticos (se exigen 0)`);
  if (typeof body.buildId !== 'string' || !isValidBuildId(body.buildId) || body.pdf !== `${body.buildId}/main.pdf`) throw new Error('El worker no indicó un PDF válido');
  const pdf = await fs.readFile(path.join(outputDir, body.pdf));
  if (pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('No se generó un PDF válido en la carpeta compartida');
  const log = await fs.readFile(path.join(outputDir, body.buildId, 'main.log'), 'utf8');
  if (/LaTeX Font Warning:|Missing character:/.test(log)) throw new Error('La plantilla produjo avisos de fuentes o caracteres ausentes (se exigen 0)');
}

async function waitForWorker(url) {
  const deadline = Date.now() + 30_000;
  do {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* El contenedor aún puede estar arrancando. */ }
    await delay(500);
  } while (Date.now() < deadline);
  throw new Error('Worker de compilación no disponible tras 30 segundos');
}

export async function compileTemplates({ workerUrl, outputDir }) {
  await fs.mkdir(outputDir, { recursive: true });
  await waitForWorker(workerUrl);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-template-'));
  const failures = [];
  try {
    const variantes = [
      ...listPerfiles().flatMap(({ id }) => [{ id, ingles: false }, { id, ingles: true }]),
      ...FUENTES_TEXTO.map(([fuente]) => ({ id: 'generico', ingles: false, fuente })),
      ...['romanos', 'continua'].flatMap((numeracion) => ['si', 'no'].map((reflejo) => ({ id: 'generico', ingles: false, numeracion, reflejo }))),
      ...['capitulos', 'secciones', 'subsecciones', 'sin-indices', 'vacios'].map((indices) => ({ id: 'generico', ingles: false, indices })),
    ];
    for (const { id, ingles, fuente, numeracion, reflejo, indices } of variantes) {
      const nombre = indices ? `${id}-indices-${indices}` : numeracion ? `${id}-paginas-${numeracion}-reflejo-${reflejo}`
        : fuente ? `${id}-fuente-${fuente}` : ingles ? `${id}-ingles` : id;
      const memoria = path.join(scratch, nombre);
      await fs.mkdir(memoria);
      copyTemplate(memoria, { perfil: id });
      if (indices === 'vacios') {
        const archivos = nuevaMemoria({ datos: { modo: 'final' }, institucion: {}, apartados: { indices: true }, capitulos: ['Prueba de índices vacíos'] });
        for (const [rel, data] of archivos) {
          await fs.mkdir(path.dirname(path.join(memoria, rel)), { recursive: true });
          await fs.writeFile(path.join(memoria, rel), data);
        }
      } else if (indices) {
        const inst = path.join(memoria, 'estilo/institucion.tex');
        await fs.writeFile(inst, applyChanges(await fs.readFile(inst, 'utf8'), 'institucion', {
          numerarHasta: indices === 'capitulos' ? 'capitulos' : indices === 'subsecciones' ? 'secciones' : 'subsecciones',
          indiceHasta: indices === 'sin-indices' ? 'subsecciones' : indices,
          indiceGeneral: indices === 'sin-indices' ? 'no' : 'si', indiceFiguras: indices === 'secciones' ? 'si' : 'no',
          indiceTablas: indices === 'capitulos' ? 'si' : 'no', indiceCodigo: indices === 'subsecciones' ? 'si' : 'no',
        }));
        await fs.appendFile(path.join(memoria, '1-capitulos/01-introduccion.tex'), String.raw`
\section{Sección de prueba del índice}
Texto ficticio para verificar la profundidad elegida.
\subsection{Subsección de prueba del índice}
Texto ficticio para verificar los títulos sin número.
`);
      }
      if (numeracion) {
        const inst = path.join(memoria, 'estilo/institucion.tex');
        await fs.writeFile(inst, applyChanges(await fs.readFile(inst, 'utf8'), 'institucion', {
          numeracionPaginas: numeracion, estiloPagina: 'personalizado', caras: 'dos', reflejarCabeceras: reflejo,
          cabeceraInicioCapitulo: reflejo, cabeceraIzquierda: 'texto', cabeceraIzquierdaTexto: 'Cabecera propia & prueba',
          cabeceraCentro: 'capitulo', cabeceraDerecha: 'seccion',
          pieIzquierda: 'texto', pieIzquierdaTexto: 'Pie propio', pieCentro: 'vacio', pieDerecha: 'pagina',
        }));
        await fs.appendFile(path.join(memoria, '1-capitulos/01-introduccion.tex'), String.raw`
\newpage
\section{Prueba en página par}
Página ficticia para comprobar la cabecera y el pie reflejados.
\newpage
Página ficticia para comprobar las posiciones en la siguiente página impar.
`);
      }
      if (fuente) {
        const inst = path.join(memoria, 'estilo/institucion.tex');
        const titulos = { times: 'palatino', latinmodern: 'times', palatino: 'latinmodern', heros: 'heros' };
        await fs.writeFile(inst, applyChanges(await fs.readFile(inst, 'utf8'), 'institucion', {
          fuenteTexto: fuente, fuenteTitulos: titulos[fuente], fuenteSeccion: 'sans',
          tamanoCapitulo: '24', tamanoSeccion: '17.5', tamanoSubseccion: '12',
          negritaSubseccion: 'no', mayusculasCapitulo: 'no', mayusculasSeccion: 'no', mayusculasSubseccion: 'si',
        }));
      }
      if (ingles) {
        const datos = path.join(memoria, 'datos.tex');
        await fs.writeFile(datos, (await fs.readFile(datos, 'utf8')).replace(/^\\idioma\{espanol\}/m, '\\idioma{ingles}'));
      }
      const cfg = loadConfig({ MEMORIA_DIR: memoria, NOTES_DIR: scratch, BUILD_DIR: outputDir, ALLOWED_ROOTS: scratch }, scratch);
      let body;
      try {
        const { stream } = await createSourceTar(cfg);
        const res = await fetch(`${workerUrl}/compile`, {
          method: 'POST', headers: { 'content-type': 'application/x-tar', 'x-main': encodeURIComponent(cfg.memoriaMain) },
          body: Readable.toWeb(stream), duplex: 'half', signal: AbortSignal.timeout(180_000),
        });
        body = await res.json();
        await fs.writeFile(path.join(outputDir, `resultado-${nombre}.json`), JSON.stringify(body, null, 2) + '\n');
        if (!res.ok) throw new Error(`Error del worker (HTTP ${res.status})`);
        await checkTemplateResult(body, outputDir);
        console.log(`✓ ${nombre}: PDF generado, 0 avisos (LaTeX y biber)`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push(`${nombre}: ${message}`);
        console.error(`✗ ${nombre}: ${message}`);
        if (body?.diagnostics) console.error(JSON.stringify(body.diagnostics, null, 2));
      }
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  if (failures.length) throw new Error(failures.join('\n'));
}

if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      'worker-url': { type: 'string', default: 'http://127.0.0.1:8090' },
      'output-dir': { type: 'string' },
    } });
    if (!values['output-dir']) throw new Error('Indica --output-dir con la carpeta que el worker monta en /out');
    await compileTemplates({ workerUrl: values['worker-url'].replace(/\/+$/, ''), outputDir: path.resolve(values['output-dir']) });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
