import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkTemplateResult, compileTemplates } from './compile-template.mjs';

const good = { ok: true, buildId: 'prueba', pdf: 'prueba/main.pdf', diagnostics: [] };

async function output(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-ci-test-'));
  await fs.mkdir(path.join(dir, 'prueba'));
  await fs.writeFile(path.join(dir, good.pdf), '%PDF-1.7\nFicticio');
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

test('CI exige éxito, PDF real y cero diagnósticos de LaTeX y biber', async (t) => {
  const dir = await output(t);
  await checkTemplateResult(good, dir);
  for (const severity of ['warning', 'error']) {
    await assert.rejects(checkTemplateResult({ ...good, diagnostics: [{ severity, message: 'Aviso ficticio' }] }, dir), /se exigen 0/);
  }
  for (const body of [{ ...good, ok: false }, { ...good, ok: 'true' }, { ...good, diagnostics: undefined }]) {
    await assert.rejects(checkTemplateResult(body, dir), /no terminó/);
  }
  await fs.writeFile(path.join(dir, good.pdf), 'No es un PDF');
  await assert.rejects(checkTemplateResult(good, dir), /PDF válido/);
});

test('CI rechaza rutas de artefactos fuera de la carpeta de compilación', async (t) => {
  const dir = await output(t);
  for (const buildId of ['../fuera', '/tmp/fuera', 'a..b', 42]) {
    await assert.rejects(checkTemplateResult({ ...good, buildId, pdf: `${buildId}/main.pdf` }, dir), /PDF válido/);
  }
  await assert.rejects(checkTemplateResult({ ...good, pdf: '../main.pdf' }, dir), /PDF válido/);
  await fs.rm(path.join(dir, good.pdf));
  await assert.rejects(checkTemplateResult(good, dir), { code: 'ENOENT' });
});

for (const warnings of [false, true]) {
  test(`CI envía ambos perfiles al worker y conserva sus resultados (avisos=${warnings})`, async (t) => {
    const dir = await output(t);
    let requests = 0;
    const server = http.createServer(async (req, res) => {
      if (req.url === '/health') { res.end('{}'); return; }
      assert.equal(req.url, '/compile');
      assert.equal(req.headers['content-type'], 'application/x-tar');
      assert.equal(req.headers['x-main'], 'tfg.tex');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const tar = Buffer.concat(chunks);
      assert.ok(tar.includes(Buffer.from('tfg.tex')));
      assert.ok(tar.includes(Buffer.from('estilo/memoria.cls')));
      requests++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...good, diagnostics: warnings ? [{ severity: 'warning', message: 'Aviso ficticio' }] : [] }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
    const options = { outputDir: dir, workerUrl: `http://127.0.0.1:${server.address().port}` };
    if (warnings) await assert.rejects(compileTemplates(options), /se exigen 0/);
    else await compileTemplates(options);
    assert.equal(requests, 2);
    for (const perfil of ['esi-uclm', 'generico']) {
      const result = JSON.parse(await fs.readFile(path.join(dir, `resultado-${perfil}.json`), 'utf8'));
      assert.equal(result.ok, true);
      assert.equal(result.diagnostics.length, warnings ? 1 : 0);
    }
  });
}
