// Verificación real opcional, contra un worker aislado y una carpeta de salida ficticia.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { tarFiles } from './test-tar.mjs';

const url = process.env.WORKER_SECURITY_URL;
const output = process.env.WORKER_SECURITY_OUT;
const document = '\\documentclass{article}\n\\begin{document}Documento ficticio.\\end{document}\n';

test('seguridad de la compilación en el contenedor', { skip: !url || !output }, async (t) => {
  async function compile(files) {
    const res = await fetch(`${url}/compile`, {
      method: 'POST', headers: { 'content-type': 'application/x-tar', 'x-main': 'main.tex' },
      body: tarFiles({ 'main.tex': document, ...files }), signal: AbortSignal.timeout(150_000),
    });
    assert.equal(res.status, 200);
    return res.json();
  }
  const absent = async (name) => assert.rejects(fs.stat(path.join(output, name)), { code: 'ENOENT' });

  for (const rc of ['latexmkrc', '.latexmkrc']) {
    await t.test(`${rc} no ejecuta Perl y SyncTeX se conserva`, async () => {
      const body = await compile({ [rc]: 'open(my $f, ">", "/out/rc-ejecutado") or die $!; print $f "Ficticio"; close($f);\n' });
      assert.equal(body.ok, true, JSON.stringify(body.diagnostics));
      assert.deepEqual(body.diagnostics, []);
      await absent('rc-ejecutado');
      const syn = zlib.gunzipSync(await fs.readFile(path.join(output, body.buildId, 'main.synctex.gz'))).toString();
      assert.match(syn, /Input:\d+:main\.tex/);
      assert.doesNotMatch(syn, /Input:\d+:\/tmp\/build-/);
    });
  }
  await t.test('shell-escape está desactivado', async () => {
    const body = await compile({ 'main.tex': document.replace('Documento ficticio.', '\\immediate\\write18{touch /out/shell-ejecutado}Documento ficticio.') });
    assert.equal(body.ok, true);
    await absent('shell-ejecutado');
  });
  await t.test('texmf.cnf del proyecto no permite escribir fuera del trabajo', async () => {
    const body = await compile({
      'texmf.cnf': 'openout_any = a\nshell_escape = t\n',
      'main.tex': document.replace('Documento ficticio.', '\\newwrite\\salida\\immediate\\openout\\salida=/out/escritura-prohibida\\immediate\\write\\salida{Ficticio}\\immediate\\closeout\\salida'),
    });
    assert.equal(body.ok, false);
    await absent('escritura-prohibida');
  });
  await t.test('biber no carga la configuración inválida del proyecto', async () => {
    const body = await compile({
      'main.tex': '\\documentclass{article}\n\\usepackage[backend=biber]{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}\\cite{ficticio}\\printbibliography\\end{document}\n',
      'refs.bib': '@book{ficticio,author={Autor, Ficticio},title={Libro ficticio},year={2026},publisher={Editorial ficticia}}\n',
      'biber.conf': 'Configuración deliberadamente inválida: no cargar.\n',
    });
    assert.equal(body.ok, true, JSON.stringify(body.diagnostics));
    assert.deepEqual(body.diagnostics, []);
    const log = await fs.readFile(path.join(output, body.buildId, 'latexmk.txt'), 'utf8');
    assert.match(log, /biber --noconf/);
  });
});
