import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '../../web/node_modules/@codemirror/state/dist/index.js';
import { history, undo } from '../../web/node_modules/@codemirror/commands/dist/index.js';
import { eolOf } from '../../web/src/lib/eol.ts';
import { applyChanges, parseDatos } from '../src/datos.ts';
import { parseFrontmatter, setFrontmatterKeys } from '../src/frontmatter.ts';
import { buildOutline, outlineKey } from '../src/outline.ts';
import { citasFromBib, analyzeTex } from '../src/refs.ts';
import { rev } from '../src/fsutil.ts';
import { computePlan } from '../src/plantilla.ts';
import { templateFiles, templateHash, sha256, mergeManifest, buildManifest } from '../../scripts/memoria-template.mjs';
import { setup, type TestEnv } from './helpers.ts';

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
let env: TestEnv | null = null;
afterEach(async () => { await env?.close(); env = null; });

describe('documentos CRLF', () => {
  it('datos, referencias y frontmatter admiten CRLF y conservan sus finales al editar', () => {
    const datos = '\\titulo{Título ficticio}\n\\autor{Ana}\n';
    expect(parseDatos(crlf(datos), 'datos')).toEqual(parseDatos(datos, 'datos'));
    const out = applyChanges(crlf(datos), 'datos', { ciudad: 'Madrid' });
    expect(out).toContain('\\ciudad{Madrid}\r\n');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    const bib = '@book{ejemplo, title={Título}, author={Ana García}, year={2024}}\n';
    expect(citasFromBib(crlf(bib), 'b.bib')).toEqual(citasFromBib(bib, 'b.bib'));
    const tex = '\\chapter{Inicio}\nTexto \\cite{ejemplo}.\n';
    expect(analyzeTex(crlf(tex), 'prueba.tex')).toEqual(analyzeTex(tex, 'prueba.tex'));
    const note = crlf('---\ntitle: Prueba\ntags: [uno]\n---\n# Nota\n');
    expect(parseFrontmatter(note)).toEqual({ data: { title: 'Prueba', tags: ['uno'] }, body: '# Nota\r\n' });
    const updated = setFrontmatterKeys(note, { tags: ['dos'] });
    expect(updated).toContain('# Nota\r\n');
    expect(updated.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('el índice y el plan actual son idénticos al convertir la memoria de plantilla a CRLF', async () => {
    env = await setup();
    const before = await buildOutline(env.cfg, null);
    for (const [rel] of templateFiles()) {
      const file = path.join(env.cfg.memoriaDir, rel);
      const buf = await fs.readFile(file);
      if (templateHash(buf, rel) === sha256(buf) && !rel.endsWith('.pdf')) await fs.writeFile(file, crlf(buf.toString('utf8')));
    }
    expect(outlineKey((await buildOutline(env.cfg, null)).outline)).toBe(outlineKey(before.outline));
    expect(await computePlan(env.cfg)).toMatchObject({ estado: 'actual', cambios: [], revisar: [] });
  });

  it('guardar sin cambios conserva los bytes y baseRev sigue distinguiendo LF de CRLF', async () => {
    env = await setup();
    const content = crlf('\\chapter{Prueba}\nTexto ficticio.\n');
    const file = path.join(env.cfg.memoriaDir, 'prueba.tex');
    await fs.writeFile(file, content);
    const opened = (await env.app.inject({ url: '/api/file?root=memoria&path=prueba.tex' })).json();
    expect(opened.content).toBe(content);
    const saved = await env.app.inject({ method: 'PUT', url: '/api/file', payload: { root: 'memoria', path: 'prueba.tex', content: opened.content, baseRev: opened.rev } });
    expect(saved.statusCode).toBe(200);
    expect(await fs.readFile(file)).toEqual(Buffer.from(content));
    expect(rev(content)).not.toBe(rev(content.replace(/\r\n/g, '\n')));
  });

  it('normaliza textos de manifiesto, conserva binarios y los hashes históricos', () => {
    const lf = Buffer.from('texto\n');
    const win = Buffer.from('texto\r\n');
    expect(templateHash(win, 'datos.tex')).toBe(sha256(lf));
    expect(templateHash(win, 'logo.pdf')).toBe(sha256(win));
    expect(templateHash(Buffer.from([255, 13, 10]), 'datos.tex')).toBe(sha256(Buffer.from([255, 10])));
    expect(templateHash(Buffer.from([255]), 'datos.tex')).not.toBe(templateHash(Buffer.from([254]), 'datos.tex'));
    const fresh = buildManifest();
    const merged = mergeManifest(fresh, { ...fresh, archivos: { 'datos.tex': 'hash-anterior' } });
    expect(merged.archivos['datos.tex']).toContain('hash-anterior');
  });

  it.each(['\n', '\r\n'])('CodeMirror conserva %j y deshacer recupera el contenido limpio', (nl) => {
    const content = ['uno', 'dos', ''].join(nl);
    let state = EditorState.create({ doc: content, extensions: [EditorState.lineSeparator.of(eolOf(content)), history()] });
    expect(state.sliceDoc()).toBe(content);
    state = state.update({ changes: { from: state.doc.length, insert: `tres${nl}` } }).state;
    expect(state.sliceDoc()).toBe(content + `tres${nl}`);
    expect(undo({ state, dispatch: (tr) => { state = tr.state; } })).toBe(true);
    expect(state.sliceDoc()).toBe(content);
  });
});
