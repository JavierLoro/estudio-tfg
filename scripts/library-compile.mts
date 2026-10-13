import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { copyTemplate, listPerfiles } from './memoria-template.mjs';
import { buildApp } from '../server/src/app.ts';
import { loadConfig } from '../server/src/config.ts';
import { libraryId } from '../server/src/libraryIdentity.ts';
import { instanceId } from '../server/src/settings.ts';

const args = process.argv.slice(2),
  arg = (name: string) => args[args.indexOf(name) + 1];
const engine = args.includes('--engine') ? arg('--engine') : 'docker';
if (!['docker', 'local'].includes(engine)) throw new Error('--engine debe ser docker o local');
const worker = args.includes('--worker-url') ? arg('--worker-url') : 'http://127.0.0.1:1',
  output = path.resolve(arg('--output-dir') ?? '');
if ((engine === 'docker' && !args.includes('--worker-url')) || !worker || !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(worker) || !args.includes('--output-dir'))
  throw new Error('Indica --output-dir temporal; para Docker, --worker-url loopback compartido con su /out');
const realOutput = await fs.realpath(output),
  allowed = [await fs.realpath(os.tmpdir()), ...(process.env.RUNNER_TEMP ? [await fs.realpath(process.env.RUNNER_TEMP)] : [])];
if (!allowed.some((root) => realOutput === root || realOutput.startsWith(root + path.sep)))
  throw new Error('La verificación solo escribe fixtures y resultados en carpetas temporales');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-library-compile-'));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGPwd3tKU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAE0y6EwonOyyAAAAAElFTkSuQmCC',
  'base64',
);
const source =
  '% Original ficticio conservado\n@string{rev={Revista ficticia}}\n@article{Articulo2026,title={Referencia {API} ficticia},author={Ficticio, Ana},year=2026,journal=rev,custom={Conservar}}\n@book{Libro2026,title={Libro ficticio},author={Otro, Autor},year=2026,publisher={Editorial ficticia}}';
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
try {
  for (const profile of listPerfiles()) {
    const root = path.join(scratch, profile.id),
      notes = path.join(root, 'notes'),
      memoria = path.join(root, 'memoria');
    await fs.mkdir(notes, { recursive: true });
    copyTemplate(memoria, { perfil: profile.id });
    const cfg = loadConfig(
      {
        NOTES_DIR: notes,
        MEMORIA_DIR: memoria,
        BUILD_DIR: realOutput,
        WORKER_URL: worker,
        COMPILE_ENGINE: engine,
        ALLOWED_ROOTS: root,
        AUTH_TOKEN: '',
        RESOURCES_SUBDIR: 'Recursos',
        MEMORIA_MAIN: 'tfg.tex',
      },
      root,
    );
    cfg.settingsFile = path.join(root, 'settings.json');
    cfg.historyDir = path.join(root, 'history');
    ({ app } = await buildApp(cfg, { serveWeb: false }));
    const manual = await fs.readFile(path.join(memoria, 'bibliografia.bib'));
    const p = (
      await app.inject({ method: 'POST', url: '/api/library/import/preview', payload: { format: 'bibtex', text: source } })
    ).json();
    const imported = (
      await app.inject({
        method: 'POST',
        url: '/api/library/import',
        payload: {
          operationId: crypto.randomUUID(),
          libraryId: libraryId(cfg),
          source: p.source,
          items: p.items.map((i: any) => ({ ...i, action: 'create' })),
        },
      })
    ).json();
    assert(Array.isArray(imported.results), JSON.stringify(imported));
    assert(imported.results.every((r: any) => r.state === 'done'), JSON.stringify(imported));
    const article = (await app.inject(`/api/resources/file?path=${encodeURIComponent(imported.results[0].path)}`)).json();
    const binding = { libraryId: libraryId(cfg), instanceId: instanceId(cfg) };
    async function integrate(file: any, extra: any) {
      const response = await app!.inject({
        method: 'POST',
        url: '/api/library/integration/preview',
        payload: { ...binding, operationId: crypto.randomUUID(), resourceId: file.item.id, baseRev: file.rev, ...extra },
      });
      assert.equal(response.statusCode, 200, response.body);
      const plan = response.json();
      const applied = await app!.inject({
        method: 'POST',
        url: '/api/library/integration/apply',
        payload: {
          ...binding,
          operationId: plan.operationId,
          revisions: plan.files.map((f: any) => ({ path: f.path, baseRev: f.baseRev })),
        },
      });
      assert.equal(applied.statusCode, 200, applied.body);
      return plan.result;
    }
    const reference = await integrate(article, { kind: 'reference' });
    const data = new FormData();
    data.set('libraryVersion', '1');
    data.set('title', 'Imagen ficticia');
    data.append('files', new Blob([png]), 'figura.png');
    const req = new Request('http://localhost', { method: 'POST', body: data });
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/capture',
        headers: { 'content-type': req.headers.get('content-type')! },
        payload: Buffer.from(await req.arrayBuffer()),
      })
    ).json();
    const image = (await app.inject(`/api/resources/file?path=${encodeURIComponent(created.path)}`)).json();
    const figure = await integrate(image, {
      kind: 'figure',
      attachmentPath: image.attachments[0].path,
      caption: 'Figura ficticia de Biblioteca',
      credit: 'Autor ficticio',
      label: 'fig:biblioteca-prueba',
      width: 30,
    });
    await fs.appendFile(
      path.join(memoria, '1-capitulos/01-introduccion.tex'),
      `\nReferencia importada ${reference.snippet}.\n${figure.snippet}\n`,
    );
    async function compile(label: string) {
      const result = await app!.inject({ method: 'POST', url: '/api/compile' }),
        value = result.json();
      await fs.writeFile(path.join(realOutput, `resultado-biblioteca-${profile.id}-${label}.json`), JSON.stringify(value, null, 2));
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(value.ok, true, result.body);
      assert.deepEqual(value.diagnostics, [], result.body);
      console.log(`✓ ${profile.id} (${label}): cita y figura compiladas, 0 avisos LaTeX/biber`);
    }
    await compile('original');
    assert.deepEqual(await fs.readFile(path.join(memoria, 'bibliografia.bib')), manual);
    await app.close();
    app = undefined;
    const moved = path.join(root, 'memoria-trasladada');
    await fs.cp(memoria, moved, { recursive: true });
    await fs.rm(notes, { recursive: true, force: true });
    cfg.memoriaDir = moved;
    ({ app } = await buildApp(cfg, { serveWeb: false }));
    await compile('trasladada-sin-biblioteca');
    assert.deepEqual(await fs.readFile(path.join(moved, 'bibliografia.bib')), manual);
    await app.close();
    app = undefined;
  }
} finally {
  await app?.close();
  await fs.rm(scratch, { recursive: true, force: true });
}
