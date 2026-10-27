import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import type { Ctx } from './context.ts';
import { atomicWrite, backup, rev, walkFiles } from './fsutil.ts';
import { resolveSafe } from './paths.ts';
import { createEngine } from './engine/index.ts';
import { computeSourceRev, createSourceTar, isValidBuildId, MAX_TAR_BYTES } from './compile.ts';
import { HttpError } from './errors.ts';
import { privateJson, readPrivate, UUID } from './assistantChanges.ts';
import { instanceId } from './settings.ts';
import { nuevaMemoria } from './nueva-memoria.ts';
import type { NuevaMemoriaConfig } from '../../shared/nueva-memoria.ts';
export interface StyleProposal { id: string; rev: string; ok: boolean; diagnostics: { severity: string; message: string }[]; actual: string | null; propuesta: string | null }
type Sources = Map<string, string | Buffer>;
const root = (cfg: Config) => path.join(cfg.dataDir, 'style-proposals', instanceId(cfg));
export function proposalFolder(cfg: Config, id: string) {
  if (!UUID.test(id)) throw new HttpError(400, 'Comparación no válida');
  return path.join(root(cfg), id);
}
async function writeSources(dir: string, files: Sources) {
  for (const [rel, content] of files) { const abs = path.join(dir, rel); await fs.mkdir(path.dirname(abs), { recursive: true }); await fs.writeFile(abs, content); }
}
export function muestraEstilo(config: NuevaMemoriaConfig, templatesDir?: string): Sources {
  const sample = structuredClone(config);
  const datos = { titulo:'Título del documento de ejemplo', autor:'Autor/a de ejemplo', tutor:'Tutor/a de ejemplo', cotutor:'Cotutor/a de ejemplo', departamento:'Departamento de ejemplo', intensificacion:'Especialidad de ejemplo', fechaMes:'octubre', fechaAnio:'2026' };
  for (const [key,value] of Object.entries(datos)) if (!sample.datos[key]) sample.datos[key] = value;
  const files = nuevaMemoria(sample, templatesDir);
  const body = String.raw`
Texto de ejemplo para comprobar la composición del documento. La misma muestra aparece en las dos versiones. Este párrafo incluye \textbf{negrita}, \emph{cursiva} y una referencia bibliográfica~\cite{muestra}.

Un segundo párrafo permite revisar la sangría, la separación y el espacio entre líneas, junto a la jerarquía de títulos.
\section{Sección de ejemplo}
\subsection{Subsección de ejemplo}
\begin{itemize}\item Primer elemento.\item Segundo elemento.\end{itemize}
\begin{enumerate}\item Primer paso.\item Segundo paso.\end{enumerate}
\begin{figure}[ht]\centering\rule{30mm}{10mm}\caption{Figura de ejemplo}\end{figure}
\begin{table}[ht]\centering\caption{Tabla de ejemplo}\begin{tabular}{lr}\toprule Elemento & Valor\\\midrule Muestra & 12\\\bottomrule\end{tabular}\end{table}
\begin{lstlisting}[caption={Código de ejemplo}]
resultado = 1 + 2
\end{lstlisting}
\[ f(x) = \int_0^x t^2\,dt = \frac{x^3}{3} \]
`;
  for (const [rel, src] of files) if (/^1-capitulos\//.test(rel)) files.set(rel, src.toString() + body);
  files.set('bibliografia.bib', '@book{muestra, author={Ejemplo, Ana}, title={Documento de muestra}, year={2026}, publisher={Editorial ficticia}}\n');
  return files;
}
/** Dos compilaciones aisladas: no usan Compiler ni publican last.json/último PDF válido. */
export async function compararEstilo(cfg: Config, actual: Sources, propuesta: Sources, main = 'tfg.tex', signal?: AbortSignal): Promise<StyleProposal> {
  const id = randomUUID(), folder = proposalFolder(cfg, id);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const job = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'et-estilo-')));
  const result: StyleProposal = { id, rev: '', ok: true, diagnostics: [], actual: null, propuesta: null };
  try {
    for (const side of ['actual', 'propuesta'] as const) {
      signal?.throwIfAborted();
      const dir = path.join(job, side); await writeSources(dir, side === 'actual' ? actual : propuesta);
      const snap = { ...cfg, memoriaDir: dir, memoriaMain: main };
      const source = await createSourceTar(snap);
      if (source.bytes > MAX_TAR_BYTES) { source.stream.destroy(); throw new HttpError(413, 'La muestra supera el límite de compilación'); }
      const engine = await createEngine(snap);
      let compiled;
      try { compiled = await engine.compile(source.stream, main, signal, {preview:true}); } finally { source.stream.destroy(); }
      result.ok &&= compiled.ok;
      result.diagnostics.push(...compiled.diagnostics.map(d => ({ severity: d.severity, message: `${side === 'actual' ? 'Actual' : 'Propuesta'}: ${d.message}` })));
      if (compiled.ok && isValidBuildId(compiled.buildId) && compiled.pdf === `${compiled.buildId}/main.pdf`) {
        const bytes = await fs.readFile(path.join(cfg.buildDir, 'previews', compiled.pdf));
        await fs.writeFile(path.join(folder, side + '.pdf'), bytes, { mode: 0o600 });
        result[side] = `/api/memoria/estilo/propuestas/${id}/${side}.pdf`;
      } else result.ok = false;
    }
    result.rev = rev(JSON.stringify(result));
    await privateJson(path.join(folder, 'preview.json'), result);
    return result;
  } finally { await fs.rm(job, { recursive: true, force: true }); }
}
export async function fuentesActuales(cfg: Config): Promise<Sources> {
  const sources: Sources = new Map();
  let bytes = 0;
  for (const f of await walkFiles(cfg, 'memoria')) { const buf = await fs.readFile(f.abs); bytes += buf.length; if (bytes > MAX_TAR_BYTES) throw new HttpError(413, 'La memoria supera el límite de compilación'); sources.set(f.rel, buf); }
  return sources;
}
interface Cambio { path: string; antes: string | null; despues: string }
interface Transaccion { project: string; sourceRev: string; cambios: Cambio[]; applied: boolean; undone: boolean }
export async function guardarTransaccion(cfg: Config, id: string, sourceRev: string, changes: Sources) {
  const cambios: Cambio[] = [];
  for (const [rel, next] of changes) {
    if (!['estilo/institucion.tex', 'estilo/portadas.tex'].includes(rel)) throw new HttpError(400, 'Archivo de estilo no admitido');
    const r = await resolveSafe(cfg, 'memoria', rel);
    cambios.push({ path: rel, antes: r.exists ? (await fs.readFile(r.abs)).toString('base64') : null, despues: Buffer.from(next).toString('base64') });
  }
  await privateJson(path.join(proposalFolder(cfg, id), 'transaction.json'), { project: instanceId(cfg), sourceRev, cambios, applied: false, undone: false });
}
/** El registro se guarda antes del primer cambio y permite recuperar una escritura interrumpida. */
export async function aplicarTransaccion(ctx: Ctx, id: string, baseRev: unknown, undo = false) {
  const cfg = { ...ctx.cfg }, file = path.join(proposalFolder(cfg, id), 'transaction.json');
  const withLocks = <T>(fn: () => Promise<T>) => ctx.locks.run('memoria:estilo/institucion.tex', () => ctx.locks.run('memoria:estilo/portadas.tex', fn));
  return withLocks(async () => {
    const transaction: Transaccion = await readPrivate(file);
    const preview: StyleProposal = await readPrivate(path.join(proposalFolder(cfg, id), 'preview.json'));
    if (baseRev !== rev(JSON.stringify(transaction)) || transaction.project !== instanceId(ctx.cfg)) throw new HttpError(409, 'La propuesta ha cambiado');
    if (transaction.undone || (undo && !transaction.applied) || (!undo && (!preview.ok || transaction.applied))) throw new HttpError(409, 'La propuesta no se puede aplicar');
    if (!undo && await computeSourceRev(cfg) !== transaction.sourceRev) throw new HttpError(409, 'La memoria ha cambiado; vuelve a comparar los PDF');
    for (const c of transaction.cambios) {
      const r = await resolveSafe(cfg, 'memoria', c.path), actual = r.exists ? (await fs.readFile(r.abs)).toString('base64') : null;
      if (undo ? actual !== c.despues && actual !== c.antes : actual !== c.antes) throw new HttpError(409, 'El estilo cambió; conserva los cambios actuales antes de deshacer');
    }
    // El estado «applied» previo a escribir permite deshacer también tras un cierre inesperado.
    if (!undo) { transaction.applied = true; await privateJson(file, transaction); }
    for (const c of transaction.cambios) {
      const r = await resolveSafe(cfg, 'memoria', c.path);
      if (r.exists) await backup(cfg, 'memoria', c.path, await fs.readFile(r.abs));
      const value = undo ? c.antes : c.despues;
      if (value === null) await fs.rm(r.abs, { force: true }); else await atomicWrite(r.abs, Buffer.from(value, 'base64'));
      ctx.bus.change({ root: 'memoria', path: c.path, kind: 'change' });
    }
    if (undo) { transaction.undone = true; await privateJson(file, transaction); }
    return { id, baseRev: rev(JSON.stringify(transaction)), applied: transaction.applied, undone: transaction.undone };
  });
}
