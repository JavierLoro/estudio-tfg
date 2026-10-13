// Fuentes ficticias: verifica el adaptador nativo sin leer .env ni contenido personal.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildApp } from '../server/src/app.ts';
import { loadConfig } from '../server/src/config.ts';
import { computeSourceRev } from '../server/src/compile.ts';

const at = process.argv.indexOf('--output-dir');
assert(at >= 0 && process.argv[at + 1], 'Indica --output-dir temporal');
const output = await fs.realpath(process.argv[at + 1]);
const allowed = [await fs.realpath(os.tmpdir()), ...(process.env.RUNNER_TEMP ? [await fs.realpath(process.env.RUNNER_TEMP)] : [])];
assert(allowed.some((root) => output === root || output.startsWith(root + path.sep)), 'Solo se escribe en una salida temporal propia');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-native-security-'));
const memoria = path.join(root, 'memoria'), notes = path.join(root, 'notes');
await fs.mkdir(memoria); await fs.mkdir(notes);
const cfg = loadConfig({ MEMORIA_DIR: memoria, NOTES_DIR: notes, BUILD_DIR: output,
  ALLOWED_ROOTS: root, COMPILE_ENGINE: 'local', WORKER_URL: 'http://127.0.0.1:1', MEMORIA_MAIN: 'main.tex', AUTH_TOKEN: '' }, root);
cfg.historyDir = path.join(root, 'history'); cfg.settingsFile = path.join(root, 'settings.json');
const { app, ctx } = await buildApp(cfg, { serveWeb: false });
const document = '\\documentclass{article}\n\\begin{document}Documento ficticio.\\end{document}\n';
const originalTimeout = process.env.COMPILE_TIMEOUT_MS;
try {
  const detected = (await app.inject('/api/engines')).json();
  assert(detected.local.ok, JSON.stringify(detected.local));
  await fs.writeFile(path.join(output, 'herramientas-locales.json'), JSON.stringify(detected.local, null, 2));
  async function compile(files: Record<string, string> = {}, ok = true) {
    for (const name of await fs.readdir(memoria)) await fs.rm(path.join(memoria, name), { recursive: true, force: true });
    for (const [name, text] of Object.entries({ 'main.tex': document, ...files })) await fs.writeFile(path.join(memoria, name), text);
    const before = await computeSourceRev(cfg);
    const result = (await app.inject({ method: 'POST', url: '/api/compile' })).json();
    assert.equal(result.ok, ok, JSON.stringify(result));
    assert.equal(await computeSourceRev(cfg), before, 'El motor no debe cambiar originales');
    if (ok) assert.deepEqual(result.diagnostics, [], JSON.stringify(result));
    return result;
  }
  const absent = async (file: string) => assert.rejects(fs.stat(path.join(output, file)), { code: 'ENOENT' });
  for (const rc of ['latexmkrc', '.latexmkrc']) {
    const result = await compile({ [rc]: `open(my $f, ">", "${output}/rc-ejecutado") or die $!; print $f "Ficticio"; close($f);\n` });
    await absent('rc-ejecutado');
    const syn = await ctx.compiler.synctex(result.buildId);
    assert(syn && [...syn.files.values()].includes('main.tex'), 'SyncTeX debe conservar el principal relativo');
    assert(![...syn.files.values()].some((file) => file.includes('estudio-tfg-local-')), 'No deben quedar rutas temporales en SyncTeX');
    console.log(`✓ local: ${rc} ignorado, originales intactos y SyncTeX relativo`);
  }
  await compile({ 'main.tex': document.replace('Documento ficticio.', `\\immediate\\write18{touch ${output}/shell-ejecutado}Documento ficticio.`) });
  await absent('shell-ejecutado');
  console.log('✓ local: shell-escape desactivado');
  await compile({ 'texmf.cnf': 'openout_any = a\nshell_escape = t\n',
    'main.tex': document.replace('Documento ficticio.', `\\newwrite\\salida\\immediate\\openout\\salida=${output}/escritura-prohibida\\immediate\\write\\salida{Ficticio}\\immediate\\closeout\\salida`) }, false);
  await absent('escritura-prohibida');
  console.log('✓ local: texmf.cnf del proyecto no habilita escritura externa');
  await compile({ 'main.tex': '\\documentclass{article}\n\\usepackage[backend=biber]{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}\\cite{ficticio}\\printbibliography\\end{document}\n',
    'refs.bib': '@book{ficticio,author={Autor, Ficticio},title={Libro ficticio},year={2026},publisher={Editorial ficticia}}\n',
    'biber.conf': 'Configuración deliberadamente inválida: no cargar.\n' });
  console.log('✓ local: biber.conf ignorado, bibliografía compilada sin avisos');
  process.env.COMPILE_TIMEOUT_MS = '1500';
  const timedOut = await compile({ 'main.tex': document.replace('Documento ficticio.', '\\def\\bucle{\\bucle}\\bucle') }, false);
  assert(timedOut.diagnostics.some((d: any) => d.message.includes('Compilación cancelada: superó')));
  if (originalTimeout === undefined) delete process.env.COMPILE_TIMEOUT_MS; else process.env.COMPILE_TIMEOUT_MS = originalTimeout;
  await compile();
  console.log('✓ local: timeout, cancelación y recuperación del siguiente trabajo');
  // La conversión compartida también se comprueba desde el adaptador seleccionado.
  const { createEngine } = await import('../server/src/engine/index.ts');
  const engine = await createEngine(cfg);
  const pdf = await engine.svg2pdf('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text x="5" y="20">Ficticio</text></svg>');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await assert.rejects(engine.svg2pdf('<svg><image href="file:///ficticio"/></svg>'));
  console.log('✓ local: SVG validado y convertido con rsvg-convert');
} finally {
  if (originalTimeout === undefined) delete process.env.COMPILE_TIMEOUT_MS; else process.env.COMPILE_TIMEOUT_MS = originalTimeout;
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
}
