#!/usr/bin/env node
// Compila copias ficticias de todos los perfiles; nunca lee .env ni la memoria del usuario.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { copyTemplate, listPerfiles } from './memoria-template.mjs';
import { tsImport } from '../server/node_modules/tsx/dist/esm/api/index.mjs';

// Reutilizar el empaquetado seguro de la API con su ejecutor TypeScript ya instalado.
const { loadConfig } = await tsImport('../server/src/config.ts', import.meta.url);
const { createSourceTar, isValidBuildId } = await tsImport('../server/src/compile.ts', import.meta.url);

export async function checkTemplateResult(body, outputDir) {
  if (body?.ok !== true || !Array.isArray(body.diagnostics)) throw new Error('La compilación no terminó correctamente');
  if (body.diagnostics.length) throw new Error(`La plantilla produjo ${body.diagnostics.length} diagnósticos (se exigen 0)`);
  if (typeof body.buildId !== 'string' || !isValidBuildId(body.buildId) || body.pdf !== `${body.buildId}/main.pdf`) throw new Error('El worker no indicó un PDF válido');
  const pdf = await fs.readFile(path.join(outputDir, body.pdf));
  if (pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('No se generó un PDF válido en la carpeta compartida');
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
    for (const { id } of listPerfiles()) {
      const memoria = path.join(scratch, id);
      await fs.mkdir(memoria);
      copyTemplate(memoria, { perfil: id });
      const cfg = loadConfig({ MEMORIA_DIR: memoria, NOTES_DIR: scratch, BUILD_DIR: outputDir, ALLOWED_ROOTS: scratch }, scratch);
      let body;
      try {
        const { stream } = await createSourceTar(cfg);
        const res = await fetch(`${workerUrl}/compile`, {
          method: 'POST', headers: { 'content-type': 'application/x-tar', 'x-main': encodeURIComponent(cfg.memoriaMain) },
          body: Readable.toWeb(stream), duplex: 'half', signal: AbortSignal.timeout(180_000),
        });
        body = await res.json();
        await fs.writeFile(path.join(outputDir, `resultado-${id}.json`), JSON.stringify(body, null, 2) + '\n');
        if (!res.ok) throw new Error(`Error del worker (HTTP ${res.status})`);
        await checkTemplateResult(body, outputDir);
        console.log(`✓ ${id}: PDF generado, 0 avisos (LaTeX y biber)`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push(`${id}: ${message}`);
        console.error(`✗ ${id}: ${message}`);
        if (body?.diagnostics) console.error(JSON.stringify(body.diagnostics, null, 2));
      }
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  if (failures.length) throw new Error(failures.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
