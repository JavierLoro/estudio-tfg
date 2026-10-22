import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { realpathLoose, type Config } from '../config.ts';
import { HttpError } from '../errors.ts';
import { isInside } from '../paths.ts';
import { compile, compileEnvironment, newBuildId, pruneBuilds, run, svgToPdf, type Tools } from '../../../worker/engine.mjs';
import { extractTar } from '../../../worker/untar.mjs';
import { checkSvg } from '../../../worker/svg.mjs';
import type { Engine, EngineHealth } from './index.ts';

const COMMANDS = { latexmk: 'latexmk', biber: 'biber', pdflatex: 'pdflatex', rsvg: 'rsvg-convert' } as const;
type ToolName = keyof typeof COMMANDS;
export interface LocalHealth extends EngineHealth {
  tools: Record<ToolName, { path: string | null; version: string | null }>;
  warnings: string[];
}
const REFERENCE = { latexmk: '4.88', biber: '2.22', pdflatex: '1.40.29' } as const;
const cache = new Map<string, { until: number; health: Promise<LocalHealth> }>();
let svgQueue: Promise<unknown> = Promise.resolve();

async function findTool(name: string, cfg: Config): Promise<string | null> {
  const roots = [cfg.memoriaDir, cfg.notesDir, realpathLoose(cfg.memoriaDir), realpathLoose(cfg.notesDir)];
  const privateDir = name === 'perl' ? cfg.texPerlDir ?? cfg.texBinDir : cfg.texBinDir;
  const dirs = privateDir ? [privateDir] : (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue;
    try {
      const candidate = path.join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
      const abs = await fs.realpath(candidate);
      if (roots.some((root) => isInside(root, abs) || isInside(root, candidate)) || !(await fs.stat(abs)).isFile()) continue;
      compileEnvironment(os.tmpdir(), { tools: { latexmk: candidate } });
      await fs.access(abs, fs.constants.X_OK);
      // TeX elige su formato por el nombre del ejecutable: conservar pdflatex aunque sea un enlace a pdftex.
      return candidate;
    } catch { /* siguiente carpeta */ }
  }
  return null;
}

async function probe(cfg: Config): Promise<LocalHealth> {
  const tools = Object.fromEntries(await Promise.all(Object.entries(COMMANDS).map(async ([key, name]) =>
    [key, { path: await findTool(name, cfg), version: null }],
  ))) as LocalHealth['tools'];
  const paths = Object.fromEntries(Object.entries(tools).filter(([, tool]) => tool.path).map(([key, tool]) => [key, tool.path!])) as Tools;
  const perl = await findTool('perl', cfg);
  if (perl) paths.perl = perl;
  const runtime = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-detect-')));
  try {
    const env = compileEnvironment(runtime, { tools: paths });
    await Promise.all(Object.values(env).filter((value) => value.startsWith(runtime + path.sep)).map((dir) => fs.mkdir(dir, { recursive: true })));
    await Promise.all(Object.entries(tools).map(async ([key, tool]) => {
      if (!tool.path) return;
      const args = key === 'latexmk' ? ['-norc', '-v'] : key === 'biber' ? ['--noconf', '--version'] : ['--version'];
      // Biber empaquetado extrae PAR al primer uso; los runners Windows/Mac pueden necesitar más tiempo.
      const timeoutMs = cfg.texBinDir ? (key === 'biber' ? 120_000 : 30_000) : 10_000;
      const result = await run(tool.path, args, { cwd: runtime, env, timeoutMs });
      if (result.code === 0 && !result.timedOut && !result.cancelled) {
        const lines = result.output.trim().split(/\r?\n/);
        tool.version = (key === 'biber' ? lines.find((line) => /^biber version:\s*\S+/i.test(line)) : lines[0])?.slice(0, 300) || null;
      } else console.warn(`No se pudo detectar ${COMMANDS[key as ToolName]} (${result.timedOut ? 'tiempo agotado' : `salida ${result.code}`}): ${result.output.slice(-2000)}`);
    }));
  } finally { await fs.rm(runtime, { recursive: true, force: true }); }
  const missing = (['latexmk', 'biber', 'pdflatex'] as const).filter((key) => !tools[key].version);
  const warnings = Object.entries(REFERENCE).flatMap(([key, expected]) => {
    const version = tools[key as ToolName].version;
    return version && !new RegExp(`(^|[^\\d.])${expected.replaceAll('.', '\\.')}($|[^\\d.])`).test(version)
      ? [`${COMMANDS[key as ToolName]} difiere de la referencia Docker (${expected}): ${version}`] : [];
  });
  if (tools.pdflatex.version && !tools.pdflatex.version.includes('TeX Live 2026'))
    warnings.push('La distribución detectada difiere de TeX Live 2026; se permite compilar y se registran sus versiones.');
  return { ok: !missing.length, version: tools.pdflatex.version, tools, warnings,
    capabilities: { compile: !missing.length, svg2pdf: true },
    ...(missing.length ? { message: cfg.texBinDir
      ? `El motor TeX privado no responde (${missing.map((key) => COMMANDS[key]).join(', ')}). Reintenta la detección en Ajustes.`
      : `No están disponibles ${missing.map((key) => COMMANDS[key]).join(', ')} en PATH; instala una distribución TeX o utiliza Docker.` } : {}) };
}

export function detectLocal(cfg: Config, refresh = false): Promise<LocalHealth> {
  const key = [cfg.texBinDir ?? '', cfg.texPerlDir ?? '', process.env.PATH ?? '', cfg.memoriaDir, cfg.notesDir].join('\0');
  for (const [entryKey, entry] of cache) if (entry.until <= Date.now()) cache.delete(entryKey);
  const cached = cache.get(key);
  if (cached && (cached.until === Infinity || !refresh)) return cached.health;
  const entry = { until: Infinity, health: probe({ ...cfg }).then((health) => {
    entry.until = Date.now() + 30_000;
    return health;
  }, (error) => {
    cache.delete(key);
    throw error;
  }) };
  cache.set(key, entry);
  return entry.health;
}

export function localEngine(cfg: Config): Engine {
  return {
    type: 'local',
    health: () => detectLocal(cfg),
    async compile(sources, main, signal) {
      const health = await detectLocal(cfg);
      if (!health.ok) throw new HttpError(503, health.message!);
      const timeoutMs = Number(process.env.COMPILE_TIMEOUT_MS ?? 120_000);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180_000)
        throw new HttpError(500, 'COMPILE_TIMEOUT_MS debe ser un entero entre 1 y 180000');
      const job = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-local-')));
      const buildId = newBuildId();
      try {
        const workDir = path.join(job, 'sources');
        await fs.mkdir(workDir);
        await extractTar(sources, workDir);
        const tools = Object.fromEntries(Object.entries(health.tools).filter(([, tool]) => tool.path).map(([key, tool]) => [key, tool.path!])) as Tools;
        const perl = await findTool('perl', cfg);
        if (perl) tools.perl = perl;
        const result = await compile({ main, workDir, outDir: path.join(cfg.buildDir, buildId), buildId, tools, timeoutMs, signal,
          toolchain: Object.entries(health.tools).map(([key, tool]) => `${COMMANDS[key as ToolName]}: ${tool.version ?? 'no disponible'}`).join('\n') });
        return { ...result, diagnostics: result.diagnostics.map((d) => ({ ...d, message: d.message.replace('Error interno del worker:', 'Error del motor local:') })) };
      } catch (error: any) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(error?.status ?? 500, `No se pudieron preparar las fuentes de compilación: ${error?.message ?? error}`);
      } finally {
        sources.destroy();
        await fs.rm(job, { recursive: true, force: true });
        await pruneBuilds(cfg.buildDir).catch(() => {});
      }
    },
    svg2pdf(svg, browserPdf) {
      const next = svgQueue.then(async () => {
        const problem = checkSvg(svg);
        if (problem) throw new HttpError(400, problem);
        // Sin rsvg, el PDF del navegador no necesita volver a arrancar TeX/Perl.
        const health = await findTool('rsvg-convert', cfg) ? await detectLocal(cfg) : null;
        if (!health?.tools.rsvg.version) {
          if (!browserPdf) throw new HttpError(422, 'El diagrama necesita conversión a PDF en el navegador', { code: 'PDF_BROWSER_REQUIRED' });
          return browserPdf;
        }
        const result = await svgToPdf(svg, { tool: health.tools.rsvg.path! });
        if (!result.pdf) throw new HttpError(result.status, result.error);
        return result.pdf;
      });
      svgQueue = next.catch(() => undefined);
      return next;
    },
  };
}
