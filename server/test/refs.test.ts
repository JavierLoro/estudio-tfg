import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { abbreviateAuthors, analyzeTex, bibReferences, citasFromBib, cleanTex } from '../src/refs.ts';
import { setup, type TestEnv } from './helpers.ts';

let env: TestEnv | null = null;
afterEach(async () => {
  await env?.close();
  env = null;
});

describe('parseo de .bib', () => {
  const BIB = String.raw`
% @book{comentada, title={No}}
@comment{ @book{dentro, title={No}} }
@string{ieee = "IEEE Press"}
@preamble{ "\newcommand{\x}{y}" }
@Book{Knuth1984,
  author = "Donald E. Knuth",
  title  = {The {\TeX}book},
  publisher = ieee # " " # {Books},
  year = 1984
}
@article{garcia:2024,
  author = {Garc{\'\i}a, Ana and P{\'e}rez, Luis},
  title = {Un t{\'i}tulo
           en varias l{\'\i}neas, con {llaves {anidadas}} y \& m\'as},
  date = {2023-05-01},
}
@misc{org,
  author = {{Organización Mundial de la Salud}},
  title = {Informe},
  year = {2020},
}
@inproceedings(parens,
  author = {A. Uno and B. Dos and C. Tres and D. Cuatro},
  booktitle = {Actas},
  year = {2019}
)
@article{rota,
  title = {Sin cerrar
@book{despues, title={Después}, year={2001}}
`;
  const citas = citasFromBib(BIB, 'x.bib');
  const by = (k: string) => citas.find((c) => c.key === k)!;

  it('omite @comment, @string, @preamble y líneas comentadas', () => {
    expect(citas.map((c) => c.key).sort()).toEqual(['Knuth1984', 'despues', 'garcia:2024', 'org', 'parens', 'rota']);
    expect(citas.find((c) => c.key === 'comentada' || c.key === 'dentro')).toBeUndefined();
  });
  it('comillas, llaves anidadas y año numérico', () => {
    expect(by('Knuth1984')).toMatchObject({ tipo: 'book', titulo: 'The TeXbook', autor: 'Knuth', anio: '1984', archivo: 'x.bib' });
  });
  it('campos multilínea, acentos y autores abreviados', () => {
    expect(by('garcia:2024')).toMatchObject({ titulo: 'Un título en varias líneas, con llaves anidadas y & más', autor: 'García y Pérez', anio: '2023' });
  });
  it('autor corporativo y «et al.»', () => {
    expect(by('org').autor).toBe('Organización Mundial de la Salud');
    expect(by('parens')).toMatchObject({ autor: 'Uno et al.', titulo: 'Actas', anio: '2019' });
  });
  it('una entrada rota no se traga la siguiente', () => {
    expect(by('despues').titulo).toBe('Después');
  });
  it('abbreviateAuthors', () => {
    expect(abbreviateAuthors('Ian Sommerville')).toBe('Sommerville');
    expect(abbreviateAuthors('Sommerville, Ian and Smith, J. and others')).toBe('Sommerville et al.');
    expect(abbreviateAuthors('')).toBe('');
  });
  it('cleanTex', () => {
    expect(cleanTex(String.raw`\textit{M\"uller} \& {\c c}a~va \%`)).toBe('Müller & ça va %');
  });
});

describe('\\label y \\acro', () => {
  const TEX = String.raw`\chapter{Introducción}\label{cap:intro}
% \label{cap:comentada}
Texto con 50\% y \label{inline} dentro.

\section{Contexto}
\label{sec:contexto}

\begin{figure}[htbp]
  \centering
  \includegraphics{x}
  \label{fig:antes}
  \caption{Pie \emph{de} figura}
\end{figure}
\begin{table}
  \caption[corto]{Tabla de herramientas}
  \label{tab:h}
\end{table}
\begin{lstlisting}[language=Python, caption={Hola mundo}, label={lst:hola}]
\label{no:cuenta}
\end{lstlisting}
\begin{equation}\label{eq:uno} a=b \end{equation}
\begin{figure}
  \begin{subfigure}{.5\textwidth}\caption{Sub A}\label{fig:a}\end{subfigure}
  \caption{Conjunta}\label{fig:conjunta}
\end{figure}
\acro{API}{Interfaz de Programación}
\acro{UML}[uml]{Lenguaje Unificado {de} Modelado}
%\acro{NO}{comentado}
`;
  const a = analyzeTex(TEX, 'c.tex');
  const by = (l: string) => a.etiquetas.find((e) => e.label === l)!;
  it('tipos y textos', () => {
    expect(by('cap:intro')).toMatchObject({ tipo: 'capitulo', texto: 'Introducción', linea: 1 });
    expect(by('sec:contexto')).toMatchObject({ tipo: 'seccion', texto: 'Contexto' });
    expect(by('fig:antes')).toMatchObject({ tipo: 'figura', texto: 'Pie de figura' });
    expect(by('tab:h')).toMatchObject({ tipo: 'tabla', texto: 'Tabla de herramientas' });
    expect(by('lst:hola')).toMatchObject({ tipo: 'listado', texto: 'Hola mundo' });
    expect(by('eq:uno').tipo).toBe('ecuacion');
    expect(by('fig:a')).toMatchObject({ tipo: 'figura', texto: 'Sub A' });
    expect(by('fig:conjunta')).toMatchObject({ tipo: 'figura', texto: 'Conjunta' });
    expect(by('inline').tipo).toBe('otro');
  });
  it('ignora comentarios y literales', () => {
    expect(a.etiquetas.find((e) => e.label === 'cap:comentada' || e.label === 'no:cuenta')).toBeUndefined();
  });
  it('acrónimos', () => {
    expect(a.acronimos.map((x) => [x.sigla, x.significado])).toEqual([
      ['API', 'Interfaz de Programación'],
      ['UML', 'Lenguaje Unificado de Modelado'],
    ]);
  });
  it('anexos', () => {
    expect(analyzeTex('\\chapter{A}\\label{x}', 'a.tex', { appendix: true }).etiquetas[0].tipo).toBe('anexo');
    expect(analyzeTex('\\appendix\n\\chapter{A}\\label{x}', 'a.tex').etiquetas[0].tipo).toBe('anexo');
  });
  it('bibReferences', () => {
    expect(bibReferences('\\bibliography{a,b}\n% \\bibliography{c}\n\\addbibresource[location=remote]{d.bib}')).toEqual(['a.bib', 'b.bib', 'd.bib']);
  });
});

describe('GET /api/memoria/refs', () => {
  it('lee la plantilla y se invalida al cambiar la memoria', async () => {
    env = await setup();
    const r = await env.app.inject('/api/memoria/refs');
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.citas.map((c: any) => c.key)).toContain('sommerville2016');
    expect(body.citas.find((c: any) => c.key === 'sommerville2016')).toMatchObject({ autor: 'Sommerville', anio: '2016', archivo: 'bibliografia.bib' });
    expect(body.acronimos.map((a: any) => a.sigla)).toContain('UML');
    const labels = body.etiquetas.map((e: any) => e.label);
    expect(labels).toEqual(expect.arrayContaining(['cap:introduccion', 'fig:ciclo', 'tab:herramientas', 'lst:hola']));
    expect(body.etiquetas.find((e: any) => e.label === 'cap:anexo-a').tipo).toBe('anexo');

    const mem = env.cfg.memoriaDir;
    await fs.appendFile(path.join(mem, 'bibliografia.bib'), '\n@book{nueva2026, title={Nueva}, year={2026}}\n');
    expect((await env.app.inject('/api/memoria/refs')).json().citas.map((c: any) => c.key)).not.toContain('nueva2026');
    env.ctx.bus.change({ root: 'memoria', path: 'bibliografia.bib', kind: 'change' });
    expect((await env.app.inject('/api/memoria/refs')).json().citas.map((c: any) => c.key)).toContain('nueva2026');
  });

  it('usa solo los .bib referenciados, o todos si no hay', async () => {
    env = await setup();
    const mem = env.cfg.memoriaDir;
    await fs.writeFile(path.join(mem, 'otra.bib'), '@book{otra, title={Otra}}');
    let keys = (await env.app.inject('/api/memoria/refs')).json().citas.map((c: any) => c.key);
    expect(keys).not.toContain('otra');
    const tfg = path.join(mem, 'tfg.tex');
    await fs.writeFile(tfg, (await fs.readFile(tfg, 'utf8')).replace('\\bibliography{bibliografia}', '\\addbibresource{otra.bib}'));
    env.ctx.bus.change({ root: 'memoria', path: 'tfg.tex', kind: 'change' });
    keys = (await env.app.inject('/api/memoria/refs')).json().citas.map((c: any) => c.key);
    expect(keys).toEqual(['otra']);
    await fs.writeFile(tfg, (await fs.readFile(tfg, 'utf8')).replace('\\addbibresource{otra.bib}', ''));
    env.ctx.bus.change({ root: 'memoria', path: 'tfg.tex', kind: 'change' });
    keys = (await env.app.inject('/api/memoria/refs')).json().citas.map((c: any) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['otra', 'sommerville2016']));
  });
});
