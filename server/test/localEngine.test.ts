import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import childProcess, { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { Header } from 'tar';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { detectLocal, localEngine } from '../src/engine/local.ts';
import { createSourceTar } from '../src/compile.ts';
import { canSymlink, setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
let bin: string;
let mode: 'ok' | 'timeout' = 'ok';
let different = false;
let biberVersionDelay = 0;
type Call = { cmd: string; args: string[]; options: any; child: EventEmitter & { pid: number }; canonicalCwd?: string };
let calls: Call[];
const versions: Record<string, string> = { latexmk: 'Latexmk, Version 4.88', biber: 'biber version: 2.22', pdflatex: 'pdfTeX 1.40.29 (TeX Live 2026)', 'rsvg-convert': 'rsvg-convert 2.60' };

async function binaries(dir: string, names = Object.keys(versions)) {
  await fs.mkdir(dir, { recursive: true });
  for (const name of names) await fs.writeFile(path.join(dir, name + (process.platform === 'win32' ? '.exe' : '')), 'Binario ficticio, nunca ejecutar', { mode: 0o755 });
}

beforeEach(async () => {
  t = await setup();
  bin = path.join(t.dir, 'bin ficticio');
  await binaries(bin);
  vi.stubEnv('PATH', bin);
  vi.stubEnv('AUTH_TOKEN', 'secreto-ficticio-no-propagar');
  vi.stubEnv('PERL5OPT', 'configuracion-ficticia-no-propagar');
  mode = 'ok'; different = false; biberVersionDelay = 0; calls = [];
  vi.spyOn(childProcess, 'spawn').mockImplementation(((cmd: string, args: string[], options: any) => {
    const child = Object.assign(new EventEmitter(), { pid: 910000 + calls.length, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => child.emit('close', null, 'SIGTERM') });
    const call: Call = { cmd, args, options, child };
    calls.push(call);
    setImmediate(async () => {
      if (cmd.endsWith('taskkill.exe')) { calls.find((c) => c.child.pid === Number(args[1]))?.child.emit('close', null, 'SIGTERM'); child.emit('close', 0); return; }
      if (args.includes('--format=pdf')) {
        await fs.writeFile(args.find(arg => arg.startsWith('--output='))!.slice('--output='.length), '%PDF-1.7\nConvertido por rsvg ficticio\n%%EOF\n');
        child.emit('close', 0);
        return;
      }
      if (!args.includes('-pdf')) {
        const name = path.basename(cmd).replace(/\.exe$/, '');
        const finish = () => {
          child.stdout.write(different ? `${name} versión ficticia antigua 0.1\n` : versions[name] + '\n');
          child.emit('close', 0);
        };
        if (name === 'biber' && biberVersionDelay) {
          const timer = setTimeout(finish, biberVersionDelay);
          child.once('close', () => clearTimeout(timer));
        } else finish();
        return;
      }
      if (mode === 'timeout') return;
      const main = args.at(-1)!;
      const base = path.posix.basename(main).replace(/\.tex$/, '');
      await fs.writeFile(path.join(options.cwd, `${base}.pdf`), '%PDF-1.7\nFicticio');
      await fs.writeFile(path.join(options.cwd, `${base}.log`), 'This is pdfTeX\n');
      call.canonicalCwd = await fs.realpath(options.cwd);
      await fs.writeFile(path.join(options.cwd, `${base}.synctex.gz`), zlib.gzipSync(`Input:1:${call.canonicalCwd.replaceAll('\\', '/')}/${main}\n`));
      child.emit('close', 0);
    });
    return child as unknown as ChildProcess;
  }) as any);
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal === 'SIGTERM') setImmediate(() => calls.find((c) => c.child.pid === -Number(pid))?.child.emit('close', null, signal));
    return true;
  });
  syncBuiltinESMExports();
});
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); vi.unstubAllEnvs(); await t.close(); });

const compiles = () => calls.filter((call) => call.args.includes('-pdf'));
const source = async () => (await createSourceTar(t.cfg)).stream;
const compile = async (signal?: AbortSignal) => localEngine(t.cfg).compile(await source(), 'tfg.tex', signal);
const supportsFileLink = await canSymlink('file');
const supportsDirectoryLink = await canSymlink('dir');

it('detecta solo binarios en PATH absoluto y excluye memoria/notas incluso mediante alias', async () => {
  const untrusted = path.join(t.cfg.notesDir, 'bin');
  const memoriaBin = path.join(t.cfg.memoriaDir, 'bin');
  await binaries(untrusted); await binaries(memoriaBin);
  const entries = ['.', untrusted, memoriaBin, bin];
  if (await canSymlink('dir')) {
    const alias = path.join(t.dir, 'alias-notas');
    await fs.symlink(untrusted, alias, process.platform === 'win32' ? 'junction' : 'dir');
    entries.unshift(alias);
  }
  vi.stubEnv('PATH', entries.join(path.delimiter));
  const health = await detectLocal(t.cfg, true);
  expect(health.ok).toBe(true);
  expect(health.warnings).toEqual([]);
  for (const tool of Object.values(health.tools)) expect(tool.path).toBe(await fs.realpath(path.join(bin, path.basename(tool.path!))));
  expect(calls.every((call) => path.dirname(call.cmd) === bin)).toBe(true);
  for (const call of calls) await expect(fs.stat(call.options.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.skipIf(!supportsFileLink)('conserva el nombre pdflatex cuando es un enlace al binario pdftex', async () => {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const pdftex = path.join(bin, `pdftex${extension}`);
  const pdflatex = path.join(bin, `pdflatex${extension}`);
  await fs.rename(pdflatex, pdftex);
  await fs.symlink(pdftex, pdflatex, 'file');
  const health = await detectLocal(t.cfg, true);
  expect(health.ok).toBe(true);
  expect(health.tools.pdflatex.path).toBe(pdflatex);
  expect(calls.some((call) => call.cmd === pdflatex)).toBe(true);
  expect(calls.some((call) => call.cmd === pdftex)).toBe(false);
  expect((await compile()).ok).toBe(true);
  const args = compiles()[0].args.join(' ');
  expect(args).toContain(pdflatex.replaceAll('\\', '/'));
  expect(args).not.toContain(pdftex.replaceAll('\\', '/'));
});

it.skipIf(!supportsDirectoryLink)('excluye binarios internos cuando las raíces configuradas son enlaces y PATH usa rutas reales', async () => {
  const entries: string[] = [];
  for (const key of ['notesDir', 'memoriaDir'] as const) {
    const actualRoot = t.cfg[key];
    const internalBin = path.join(actualRoot, 'bin');
    await binaries(internalBin);
    entries.push(internalBin);
    const alias = path.join(t.dir, `alias-${key}`);
    await fs.symlink(actualRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    t.cfg[key] = alias;
  }
  vi.stubEnv('PATH', [...entries, bin].join(path.delimiter));
  const health = await detectLocal(t.cfg, true);
  expect(health.ok).toBe(true);
  for (const tool of Object.values(health.tools)) expect(path.dirname(tool.path!)).toBe(bin);
  expect(calls.every((call) => path.dirname(call.cmd) === bin)).toBe(true);
});

it('registra diferencias de versiones/distribución sin bloquear la compilación', async () => {
  different = true;
  const health = await detectLocal(t.cfg, true);
  expect(health.ok).toBe(true);
  expect(health.warnings).toHaveLength(4);
  expect(health.warnings.join(' ')).toContain('TeX Live 2026');
  expect((await compile()).ok).toBe(true);
});

it('selecciona TeX por ruta privada sin cambiar PATH ni mezclar herramientas externas', async () => {
  const privateBin = path.join(t.dir, 'tex privado');
  await binaries(privateBin);
  t.cfg.texBinDir = privateBin;
  const before = process.env.PATH;
  expect(await detectLocal(t.cfg, true)).toMatchObject({ ok: true });
  expect(calls.every(call => path.dirname(call.cmd) === privateBin)).toBe(true);
  expect(process.env.PATH).toBe(before);
  await fs.rm(path.join(privateBin, 'biber' + (process.platform === 'win32' ? '.exe' : '')));
  expect((await detectLocal(t.cfg, true)).ok).toBe(false);
  t.cfg.texBinDir = t.cfg.notesDir;
  await binaries(t.cfg.notesDir);
  const health = await detectLocal(t.cfg, true);
  expect(health.ok).toBe(false);
  expect(Object.values(health.tools).every(tool => tool.path === null)).toBe(true);
});

it('el arranque frío de biber no marca como ausente una herramienta válida', async () => {
  biberVersionDelay = 3000;
  const health = await detectLocal(t.cfg, true);
  expect(health.tools.biber.version).toBe('biber version: 2.22');
  expect(health.ok).toBe(true);
});

it('explica herramientas ausentes antes de ejecutar y rsvg es opcional para compilar', async () => {
  await fs.rm(path.join(bin, 'latexmk' + (process.platform === 'win32' ? '.exe' : '')));
  const health = await detectLocal(t.cfg, true);
  expect(health).toMatchObject({ ok: false, capabilities: { compile: false, svg2pdf: true } });
  expect(health.message).toContain('latexmk');
  const stream = await source();
  await expect(localEngine(t.cfg).compile(stream, 'tfg.tex')).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('latexmk') });
  stream.destroy();
  expect(compiles()).toHaveLength(0);
  await binaries(bin, ['latexmk']);
  await fs.rm(path.join(bin, 'rsvg-convert' + (process.platform === 'win32' ? '.exe' : '')));
  expect(await detectLocal(t.cfg, true)).toMatchObject({ ok: true, capabilities: { compile: true, svg2pdf: true } });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  await expect(localEngine(t.cfg).svg2pdf(svg)).rejects.toMatchObject({ statusCode: 422, body: { code: 'PDF_BROWSER_REQUIRED' } });
  const pdf = Buffer.from('%PDF-1.7\nFicticio\n%%EOF\n');
  expect(await localEngine(t.cfg).svg2pdf(svg, pdf)).toEqual(pdf);
  await expect(localEngine(t.cfg).svg2pdf(svg.replace('</svg>', '<image href="file:///ficticio"/></svg>'), pdf)).rejects.toMatchObject({ statusCode: 400 });
});

it('compila una copia temporal, conserva originales y aplica rc/biber/entorno controlados y SyncTeX relativo', async () => {
  const original = await fs.readFile(path.join(t.cfg.memoriaDir, 'tfg.tex'));
  for (const name of ['latexmkrc', '.latexmkrc', 'biber.conf', 'texmf.cnf']) await fs.writeFile(path.join(t.cfg.memoriaDir, name), 'Configuración ficticia que no debe ejecutarse');
  const result = await compile();
  expect(result.ok).toBe(true);
  const call = compiles()[0];
  expect(call.options.cwd).toBe(call.canonicalCwd);
  expect(call.cmd).toBe(await fs.realpath(path.join(bin, 'latexmk' + (process.platform === 'win32' ? '.exe' : ''))));
  expect(call.args).toContain('-norc'); expect(call.args).toContain('-no-shell-escape');
  expect(call.args.join(' ')).toContain('--noconf');
  expect(call.options.cwd).not.toBe(t.cfg.memoriaDir);
  expect(call.options.env.AUTH_TOKEN).toBeUndefined(); expect(call.options.env.PERL5OPT).toBeUndefined();
  expect(call.options.env.TEXMFCNF).toBeUndefined(); expect(call.options.env.BIBINPUTS).toBeUndefined();
  expect(call.options.env.shell_escape).toBe('0'); expect(call.options.env.openout_any).toBe('p');
  expect(path.dirname(call.options.env.HOME)).toBe(path.join(path.dirname(call.options.cwd), 'runtime'));
  expect(await fs.readFile(path.join(t.cfg.memoriaDir, 'tfg.tex'))).toEqual(original);
  await expect(fs.stat(path.join(t.cfg.memoriaDir, 'tfg.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.stat(path.dirname(call.options.cwd))).rejects.toMatchObject({ code: 'ENOENT' });
  const syn = zlib.gunzipSync(await fs.readFile(path.join(t.cfg.buildDir, result.buildId, 'main.synctex.gz'))).toString();
  expect(syn).toBe('Input:1:tfg.tex\n');
  const log = await fs.readFile(path.join(t.cfg.buildDir, result.buildId, 'latexmk.txt'), 'utf8');
  expect(log).toContain('latexmk: Latexmk, Version 4.88'); expect(log).toContain('biber version: 2.22');
});

it('exporta con el navegador sin detectar TeX cuando el paquete privado no incluye rsvg', async () => {
  t.cfg.texBinDir = bin;
  await fs.rm(path.join(bin, 'rsvg-convert' + (process.platform === 'win32' ? '.exe' : '')));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const pdf = Buffer.from('%PDF-1.7\nFicticio\n%%EOF\n');
  await expect(localEngine(t.cfg).svg2pdf(svg)).rejects.toMatchObject({ statusCode: 422, body: { code: 'PDF_BROWSER_REQUIRED' } });
  expect(await localEngine(t.cfg).svg2pdf(svg, pdf)).toEqual(pdf);
  expect(calls).toHaveLength(0);
});

it('local conserva rsvg cuando está disponible aunque reciba un PDF del navegador', async () => {
  const pdf = await localEngine(t.cfg).svg2pdf('<svg xmlns="http://www.w3.org/2000/svg"></svg>', Buffer.from('%PDF-1.7\nAdjunto ficticio\n%%EOF\n'));
  expect(pdf.toString()).toContain('Convertido por rsvg ficticio');
  const call = calls.find(call => call.args.includes('--format=pdf'))!;
  expect(call.cmd).toBe(path.join(bin, 'rsvg-convert' + (process.platform === 'win32' ? '.exe' : '')));
  expect(call.options.env.AUTH_TOKEN).toBeUndefined();
});

it.skipIf(!supportsDirectoryLink)('canoniza temporales enlazados para que SyncTeX conserve rutas relativas', async () => {
  const realRoot = path.join(t.dir, 'temporales-reales');
  const alias = path.join(t.dir, 'alias-temporales');
  await fs.mkdir(realRoot);
  await fs.symlink(realRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const makeTemp = fs.mkdtemp.bind(fs);
  vi.spyOn(fs, 'mkdtemp').mockImplementation((async (prefix: string, options: any) =>
    makeTemp(path.basename(prefix).startsWith('estudio-tfg-') ? path.join(alias, path.basename(prefix)) : prefix, options)) as any);
  const result = await compile();
  expect(result.ok).toBe(true);
  const call = compiles()[0];
  expect(call.options.cwd.startsWith(realRoot + path.sep)).toBe(true);
  expect(call.options.cwd).toBe(call.canonicalCwd);
  expect(call.options.env.HOME.startsWith(realRoot + path.sep)).toBe(true);
  const syn = zlib.gunzipSync(await fs.readFile(path.join(t.cfg.buildDir, result.buildId, 'main.synctex.gz'))).toString();
  expect(syn).toBe('Input:1:tfg.tex\n');
  await expect(fs.stat(path.dirname(call.options.cwd))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('incluye el auxiliar Perl detectado sin heredar otras carpetas de PATH', async () => {
  const perlBin = path.join(t.dir, 'perl separado');
  const unrelated = path.join(t.dir, 'sin-binarios');
  await binaries(perlBin, ['perl']); await fs.mkdir(unrelated);
  const internalPerl = path.join(t.cfg.notesDir, 'perl-no-confiable');
  await binaries(internalPerl, ['perl']);
  vi.stubEnv('PATH', [internalPerl, bin, unrelated, perlBin].join(path.delimiter));
  const health = await detectLocal(t.cfg, true);
  expect(health.ok).toBe(true);
  expect(Object.keys(health.tools)).toEqual(['latexmk', 'biber', 'pdflatex', 'rsvg']);
  expect((await compile()).ok).toBe(true);
  for (const call of calls) {
    const dirs = call.options.env.PATH.split(path.delimiter);
    expect(dirs).toContain(bin); expect(dirs).toContain(perlBin);
    expect(dirs).not.toContain(unrelated); expect(dirs).not.toContain(internalPerl);
  }
});

it('rechaza tar con escape antes de compilar y borra el trabajo incompleto', async () => {
  await detectLocal(t.cfg, true);
  const mkdir = vi.spyOn(fs, 'mkdtemp');
  const data = Buffer.from('Ficticio');
  const header = new Header({ path: '../escape.tex', mode: 0o644, uid: 0, gid: 0, type: 'File', size: data.length });
  header.encode();
  const stream = Readable.from([header.block!, data, Buffer.alloc(512 - data.length), Buffer.alloc(1024)]);
  await expect(localEngine(t.cfg).compile(stream, 'tfg.tex')).rejects.toMatchObject({ statusCode: 400 });
  expect(compiles()).toHaveLength(0);
  expect(stream.destroyed).toBe(true);
  for (const result of mkdir.mock.results) if (result.type === 'return') await expect(fs.stat(await result.value)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('timeout y cancelación matan procesos, limpian fuentes y permiten el siguiente trabajo', async () => {
  vi.stubEnv('COMPILE_TIMEOUT_MS', '30');
  mode = 'timeout';
  const expired = await compile();
  expect(expired.ok).toBe(false); expect(expired.pdf).toBeNull();
  expect(expired.diagnostics[0].message).toContain('superó');
  await expect(fs.stat(path.dirname(compiles()[0].options.cwd))).rejects.toMatchObject({ code: 'ENOENT' });
  if (process.platform !== 'win32') expect(process.kill).toHaveBeenCalledWith(-compiles()[0].child.pid, 'SIGTERM');
  else expect(calls.some((call) => call.cmd.endsWith('taskkill.exe') && call.args.includes('/T') && call.args.includes('/F'))).toBe(true);
  const controller = new AbortController();
  vi.stubEnv('COMPILE_TIMEOUT_MS', '10000');
  const pending = compile(controller.signal);
  await vi.waitFor(() => expect(compiles()).toHaveLength(2));
  controller.abort();
  const cancelled = await pending;
  expect(cancelled.ok).toBe(false); expect(cancelled.diagnostics[0].message).toContain('cancelada por el usuario');
  await expect(fs.stat(path.dirname(compiles()[1].options.cwd))).rejects.toMatchObject({ code: 'ENOENT' });
  mode = 'ok';
  expect((await compile()).ok).toBe(true);
});

it('rechaza timeout de despliegue inválido antes de preparar fuentes', async () => {
  vi.stubEnv('COMPILE_TIMEOUT_MS', '0');
  const stream = await source();
  await expect(localEngine(t.cfg).compile(stream, 'tfg.tex')).rejects.toMatchObject({ statusCode: 500, message: expect.stringContaining('COMPILE_TIMEOUT_MS') });
  stream.destroy();
  expect(compiles()).toHaveLength(0);
});

it('cerrar la aplicación espera la cancelación y limpieza y no inicia trabajos pendientes', async () => {
  t.cfg.compileEngine = 'local';
  vi.stubEnv('COMPILE_TIMEOUT_MS', '10000');
  mode = 'timeout';
  let completed = false;
  const active = t.ctx.compiler.compile().then((result) => { completed = true; return result; });
  await vi.waitFor(() => expect(compiles()).toHaveLength(1));
  const job = path.dirname(compiles()[0].options.cwd);
  const queued = t.ctx.compiler.compile().then(() => null, (error) => error);
  await t.app.close();
  expect(completed).toBe(true);
  await expect(fs.stat(job)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await active).diagnostics[0].message).toContain('cancelada por el usuario');
  expect(await queued).toMatchObject({ statusCode: 503 });
  expect(compiles()).toHaveLength(1);
  await expect(t.ctx.compiler.compile()).rejects.toMatchObject({ statusCode: 503 });
});
