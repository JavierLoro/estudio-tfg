// node --test worker/parse-log.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLog, parseBlg, normalizeFile, dropRerunNoise, finalize } from './parse-log.mjs';
import { validateMain } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readLog = (name) => fs.readFileSync(path.join(here, 'test-logs', name + '.txt'), 'utf8');
const errors = (ds) => ds.filter((d) => d.severity === 'error');
const warnings = (ds) => ds.filter((d) => d.severity === 'warning');

// ---------- snippets sintéticos ----------

test('file-line-error: ./archivo.tex:12: mensaje', () => {
  const log = `(./main.tex
(./intro.tex
./intro.tex:12: Undefined control sequence.
l.12 Texto con \\foo
                    aquí.
)
)`;
  assert.deepEqual(parseLog(log), [
    { severity: 'error', file: 'intro.tex', line: 12, message: 'Undefined control sequence.' },
  ]);
});

test('normaliza rutas del temporal, ./ y /src', () => {
  assert.equal(normalizeFile('/tmp/build-abc/./cap/intro.tex', '/tmp/build-abc'), 'cap/intro.tex');
  assert.equal(normalizeFile('./cap/intro.tex'), 'cap/intro.tex');
  assert.equal(normalizeFile('/src/main.tex'), 'main.tex');
  assert.equal(normalizeFile('"./con espacio.tex"'), 'con espacio.tex');
  const log = '/tmp/build-x/cap/a.tex:3: LaTeX Error: Something\'s wrong--perhaps a missing \\item.';
  assert.equal(parseLog(log, { rootDir: '/tmp/build-x' })[0].file, 'cap/a.tex');
});

test('"! LaTeX Error" clásico toma archivo de la pila y línea de l.N', () => {
  const log = `(./main.tex (./cap1.tex
! LaTeX Error: Environment foo undefined.

See the LaTeX manual or LaTeX Companion for explanation.
Type  H <return>  for immediate help.
 ...

l.7 \\begin{foo}

Your command was ignored.
))`;
  assert.deepEqual(parseLog(log), [
    { severity: 'error', file: 'cap1.tex', line: 7, message: 'LaTeX Error: Environment foo undefined.' },
  ]);
});

test('LaTeX Warning con "on input line N" usa el archivo actual', () => {
  const log = `(./main.tex (./cap1.tex
LaTeX Warning: Reference \`fig:x' on page 3 undefined on input line 45.

) (./cap2.tex
LaTeX Warning: Citation \`knuth84' on page 4 undefined on input line 9.

))
LaTeX Warning: There were undefined references.
`;
  assert.deepEqual(parseLog(log), [
    { severity: 'warning', file: 'cap1.tex', line: 45, message: "Reference `fig:x' on page 3 undefined." },
    { severity: 'warning', file: 'cap2.tex', line: 9, message: "Citation `knuth84' on page 4 undefined." },
    { severity: 'warning', file: 'main.tex', line: null, message: 'There were undefined references.' },
  ]);
});

test('Package Warning multilínea con continuación "(paquete)"', () => {
  const log = `(./main.tex
Package natbib Warning: Citation \`foo' on page 1 undefined on input line 12.

Package hyperref Warning: Token not allowed in a PDF string (Unicode):
(hyperref)                removing \`math shift' on input line 30.

)`;
  assert.deepEqual(parseLog(log), [
    { severity: 'warning', file: 'main.tex', line: 12, message: "natbib: Citation `foo' on page 1 undefined." },
    {
      severity: 'warning',
      file: 'main.tex',
      line: 30,
      message: "hyperref: Token not allowed in a PDF string (Unicode): removing `math shift'.",
    },
  ]);
});

test('Overfull/Underfull y Font Warnings se ignoran sin romper la pila', () => {
  const log = `(./main.tex (./cap1.tex
Overfull \\hbox (12.3pt too wide) in paragraph at lines 3--5
[]\\T1/cmr/m/n/10 texto con paréntesis (abierto sin cerrar
 []

Underfull \\vbox (badness 10000) has occurred while \\output is active []

LaTeX Font Warning: Font shape \`T1/cmr/m/it' undefined
(Font)              using \`T1/cmr/m/n' instead on input line 8.

./cap1.tex:9: Missing $ inserted.
<inserted text>
                $
l.9 a_b

))`;
  assert.deepEqual(parseLog(log), [
    { severity: 'error', file: 'cap1.tex', line: 9, message: 'Missing $ inserted.' },
  ]);
});

test('deduplica y elimina "Emergency stop" si hay otro error', () => {
  const log = `(./main.tex
./main.tex:3: LaTeX Error: File \`nada.sty' not found.
l.3 \\usepackage{nada}

./main.tex:3: LaTeX Error: File \`nada.sty' not found.
l.3 \\usepackage{nada}

./main.tex:3: Emergency stop.
<read *>

*** (job aborted, file error in nonstop mode)
)`;
  assert.deepEqual(parseLog(log), [
    { severity: 'error', file: 'main.tex', line: 3, message: "LaTeX Error: File `nada.sty' not found." },
  ]);
});

test('falta \\end{document}', () => {
  const ds = parseLog('(./main.tex\n*** (job aborted, no legal \\end found)\n)');
  assert.equal(ds.length, 1);
  assert.equal(ds[0].severity, 'error');
  assert.equal(ds[0].file, 'main.tex');
});

test('dropRerunNoise oculta citas/referencias indefinidas solo si hay errores', () => {
  const ds = [
    { severity: 'error', file: 'a.tex', line: 1, message: 'Undefined control sequence.' },
    { severity: 'warning', file: 'a.tex', line: 2, message: "Citation `x' on page 1 undefined." },
    { severity: 'warning', file: 'a.tex', line: 2, message: "natbib: Citation `x' on page 1 undefined." },
    { severity: 'warning', file: 'main.tex', line: null, message: 'There were undefined references.' },
    { severity: 'warning', file: 'a.tex', line: 5, message: 'blindtext: spanish not defined, using English instead.' },
  ];
  assert.deepEqual(dropRerunNoise(ds).map((d) => d.line), [1, 5]);
  const noErr = ds.slice(1);
  assert.equal(dropRerunNoise(noErr).length, noErr.length);
});

test('finalize ordena errores primero', () => {
  const ds = finalize([
    { severity: 'warning', file: 'a', line: 1, message: 'w' },
    { severity: 'error', file: 'a', line: 2, message: 'e' },
  ]);
  assert.deepEqual(ds.map((d) => d.severity), ['error', 'warning']);
});

test('parseBlg: BibTeX y Biber', () => {
  const blg = `I was expecting a \`,' or a \`}'---line 9 of file main.bib
 :
Warning--empty year in design_patterns
Warning--I didn't find a database entry for "nada"
You've used 3 entries,
[2] Utils.pm:409> WARN - Duplicate entry 'x' in file 'refs.bib' at line 7
[3] Utils.pm:409> ERROR - BibTeX subsystem: refs.bib, line 20, syntax error`;
  assert.deepEqual(parseBlg(blg, { rootDir: '/tmp/b' }), [
    { severity: 'error', file: 'main.bib', line: 9, message: "BibTeX: I was expecting a `,' or a `}'" },
    { severity: 'error', file: 'main.tex', line: null, message: 'Biber: BibTeX subsystem: refs.bib, line 20, syntax error' },
    { severity: 'warning', file: 'main.tex', line: null, message: 'BibTeX: empty year in design_patterns' },
    { severity: 'warning', file: 'refs.bib', line: 7, message: "Biber: Duplicate entry 'x' in file 'refs.bib' at line 7" },
  ]);
});

// ---------- logs reales (plantilla esi-tfg, TeX Live 2026) ----------

test('real: plantilla sin errores → solo avisos, ninguno de cajas', () => {
  const ds = parseLog(readLog('template-ok.log'));
  assert.equal(errors(ds).length, 0);
  assert.ok(warnings(ds).length > 0);
  assert.ok(!ds.some((d) => /Overfull|Underfull/.test(d.message)));
  // los avisos de blindtext apuntan al archivo y línea reales
  assert.ok(ds.some((d) => d.file === 'intro.tex' && d.line === 47 && /blindtext/.test(d.message)));
});

test('real: \\comandoinexistente inyectado en intro.tex:12', () => {
  const ds = parseLog(readLog('template-undefined-cs.log'));
  assert.deepEqual(errors(ds), [
    { severity: 'error', file: 'intro.tex', line: 12, message: 'Undefined control sequence.' },
  ]);
  // avisos de citas en otros archivos tienen archivo/línea correctos
  assert.ok(ds.some((d) => d.file === 'antecedentes.tex' && d.line === 75 && /Citation `sousa'/.test(d.message)));
  // tras filtrar ruido, no quedan citas/referencias indefinidas
  assert.ok(!dropRerunNoise(ds).some((d) => /undefined\.$/.test(d.message) && /Citation|Reference/.test(d.message)));
});

test('real: mismo error con log cortado a 79 columnas (max_print_line por defecto)', () => {
  const ds = parseLog(readLog('template-undefined-cs-wrapped.log'));
  assert.deepEqual(errors(ds), [
    { severity: 'error', file: 'intro.tex', line: 12, message: 'Undefined control sequence.' },
  ]);
  const ref = ds.find((d) => /chap:antecedentes/.test(d.message));
  assert.equal(ref.file, 'intro.tex');
  assert.equal(ref.line, 34);
});

test('real: error de sintaxis en main.bib (log + blg)', () => {
  const ds = [...parseLog(readLog('template-bib-error.log')), ...parseBlg(readLog('template-bib-error.blg'))];
  assert.deepEqual(errors(ds), [
    { severity: 'error', file: 'main.bib', line: 9, message: "BibTeX: I was expecting a `,' or a `}'" },
  ]);
});

// ---------- validación de "main" ----------

test('validateMain rechaza traversal, absolutas y opciones', () => {
  for (const bad of ['../x.tex', '/etc/x.tex', 'a/../main.tex', '-shell-escape.tex', 'sub/-x.tex', 'main.sty', '', 'a\\b.tex', 'a//b.tex', 42, null]) {
    assert.equal(validateMain(bad), null, String(bad));
  }
  assert.equal(validateMain('main.tex'), 'main.tex');
  assert.equal(validateMain('./main.tex'), 'main.tex');
  assert.equal(validateMain('memoria/tfg.tex'), 'memoria/tfg.tex');
});
