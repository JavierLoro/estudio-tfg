import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import * as tar from 'tar';
import type { Config } from './config.ts';
import { atomicWrite, walkFiles } from './fsutil.ts';
import { isInside } from './paths.ts';
import { parseSynctex, type SynctexData } from './synctex.ts';

export interface Diagnostic {
  severity: 'error' | 'warning';
  file: string;
  line: number | null;
  message: string;
}

export interface CompileResult {
  ok: boolean;
  buildId: string;
  startedAt: string;
  durationMs: number;
  diagnostics: Diagnostic[];
  pdfUrl: string | null;
  sourceRev: string;
}

interface Persisted {
  last: CompileResult | null;
  lastGoodPdfUrl: string | null;
}

export const WORKER_DOWN_MSG = 'Worker de compilación no disponible';
const WORKER_TIMEOUT_MS = 180_000;
/** Same limit the worker enforces on the tar body. */
export const MAX_TAR_BYTES = 200 * 1024 * 1024;
const BUILD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Compilaciones con el synctex ya analizado en memoria. */
const SYNCTEX_CACHE = 3;
/** Límite del synctex descomprimido (una memoria normal ocupa pocos MB). */
const MAX_SYNCTEX_BYTES = 256 * 1024 * 1024;
const gunzip = promisify(zlib.gunzip);

export function isValidBuildId(id: string): boolean {
  return BUILD_ID_RE.test(id) && !id.includes('..');
}

async function sourceFiles(cfg: Config) {
  const files = await walkFiles(cfg, 'memoria');
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return files;
}

/** Hash over the (non-ignored) memoria sources: path + content of each file, sorted. */
export async function computeSourceRev(cfg: Config): Promise<string> {
  const files = await sourceFiles(cfg);
  const h = crypto.createHash('sha256');
  for (const f of files) {
    try {
      const buf = await fs.readFile(f.abs);
      h.update(f.rel).update('\0').update(crypto.createHash('sha256').update(buf).digest()).update('\0');
    } catch {
      /* vanished during hashing */
    }
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Tar (uncompressed, portable) of the memoria sources, with the same filter as
 * computeSourceRev. Symlinks inside the root are stored as regular files
 * (walkFiles already dropped those escaping it); the worker rejects links.
 */
export async function createSourceTar(cfg: Config): Promise<{ stream: Readable; files: number; bytes: number }> {
  const files = await sourceFiles(cfg);
  let bytes = 0;
  for (const f of files) bytes += await fs.stat(f.abs).then((s) => s.size, () => 0);
  const base = await fs.realpath(cfg.memoriaDir);
  const pack = tar.create({ cwd: base, portable: true, follow: true, noDirRecurse: true }, files.map((f) => f.rel));
  pack.on('error', () => {});
  // Never destroy the Pack itself (node-tar throws on writes after destroy): wrap it in a
  // Node Readable and, on cleanup, let the Pack drain into the void.
  const stream = Readable.from(pack as AsyncIterable<Buffer>, { objectMode: false });
  const discard = () => {
    pack.resume();
  };
  stream.once('close', discard);
  return { stream, files: files.length, bytes };
}

function normDiagnostics(v: unknown): Diagnostic[] {
  if (!Array.isArray(v)) return [];
  return v.map((d: any) => ({
    severity: d?.severity === 'warning' ? 'warning' : 'error',
    file: typeof d?.file === 'string' ? d.file : '',
    line: typeof d?.line === 'number' && Number.isFinite(d.line) ? d.line : null,
    message: typeof d?.message === 'string' ? d.message : String(d?.message ?? ''),
  }));
}

export class Compiler {
  private running: Promise<CompileResult> | null = null;
  private queued: Promise<CompileResult> | null = null;
  private state: Persisted = { last: null, lastGoodPdfUrl: null };
  private loaded = false;
  /** LRU (por orden de inserción) de synctex analizados: clave = ruta + mtime + tamaño. */
  private synctexCache = new Map<string, Promise<SynctexData | null>>();

  constructor(
    private cfg: Config,
    private onResult: (r: CompileResult) => void = () => {},
  ) {}

  get lastFile() {
    return path.join(this.cfg.buildDir, 'last.json');
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await fs.readFile(this.lastFile, 'utf8'));
      this.state = { last: raw.last ?? null, lastGoodPdfUrl: raw.lastGoodPdfUrl ?? null };
    } catch {
      /* none yet */
    }
  }

  /** buildId del último PDF bueno (el que muestra la interfaz por defecto). */
  get lastGoodBuildId(): string | null {
    const url = this.state.lastGoodPdfUrl;
    const m = url ? /^\/api\/pdf\/(.+)\.pdf$/.exec(url) : null;
    return m && isValidBuildId(m[1]) ? m[1] : null;
  }

  async last(): Promise<CompileResult | null> {
    await this.load();
    return this.state.last;
  }

  /**
   * One compile at a time. If one is running, wait for it and then compile
   * again; concurrent waiters share the same queued compile.
   */
  compile(): Promise<CompileResult> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
      return this.running;
    }
    if (!this.queued) {
      const after = this.running.catch(() => undefined);
      this.queued = after.then(() => {
        this.queued = null;
        return this.compile();
      });
    }
    return this.queued;
  }

  private async run(): Promise<CompileResult> {
    await this.load();
    const started = new Date();
    const t0 = performance.now();
    // Snapshot: a settings change during a compile does not affect it (it finishes with the old folder).
    const snap: Config = { ...this.cfg };
    const sourceRev = await computeSourceRev(snap);
    let result: CompileResult;
    let src: Awaited<ReturnType<typeof createSourceTar>> | null = null;
    try {
      src = await createSourceTar(snap);
    } catch (e: any) {
      result = await this.failure(localBuildId(started), started, t0, sourceRev, `No se pudieron empaquetar las fuentes: ${e?.message ?? e}`, snap);
      return this.finish(result);
    }
    if (src.bytes > MAX_TAR_BYTES) {
      src.stream.destroy();
      result = await this.failure(localBuildId(started), started, t0, sourceRev, `Las fuentes de la memoria ocupan más de ${MAX_TAR_BYTES / 1024 / 1024} MB`, snap);
      return this.finish(result);
    }
    try {
      const res = await fetch(`${snap.workerUrl}/compile`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-tar', 'x-main': encodeURIComponent(snap.memoriaMain) },
        body: Readable.toWeb(src.stream) as any,
        duplex: 'half',
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      } as RequestInit);
      const text = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* not json */
      }
      const buildId = typeof body?.buildId === 'string' && isValidBuildId(body.buildId) ? body.buildId : localBuildId(started);
      if (!res.ok && !body?.diagnostics) {
        const msg = typeof body?.error === 'string' ? body.error : text.slice(0, 300);
        result = await this.failure(buildId, started, t0, sourceRev, `Error del worker (HTTP ${res.status}): ${msg}`, snap);
      } else {
        const ok = Boolean(body?.ok) && typeof body?.pdf === 'string' && (await this.pdfExists(body.pdf));
        const diagnostics = normDiagnostics(body?.diagnostics);
        if (body?.ok && !ok) {
          diagnostics.push({ severity: 'error', file: snap.memoriaMain, line: null, message: 'El worker no generó el PDF esperado' });
        }
        const pdfUrl = ok ? `/api/pdf/${buildId}.pdf` : await this.lastGood();
        result = {
          ok,
          buildId,
          startedAt: started.toISOString(),
          durationMs: typeof body?.durationMs === 'number' ? body.durationMs : Math.round(performance.now() - t0),
          diagnostics,
          pdfUrl,
          sourceRev,
        };
        if (ok) this.state.lastGoodPdfUrl = pdfUrl;
      }
    } catch (e: any) {
      const msg = e?.name === 'TimeoutError' ? `${WORKER_DOWN_MSG} (tiempo de espera agotado)` : WORKER_DOWN_MSG;
      result = await this.failure(localBuildId(started), started, t0, sourceRev, msg, snap);
    } finally {
      src.stream.destroy();
    }
    return this.finish(result);
  }

  private async finish(result: CompileResult): Promise<CompileResult> {
    this.state.last = result;
    await this.persist();
    try {
      this.onResult(result);
    } catch {
      /* listeners must not break compile */
    }
    return result;
  }

  /** Last good PDF URL, or null if the worker has pruned that build. */
  private async lastGood(): Promise<string | null> {
    const id = this.lastGoodBuildId;
    if (!id || !(await this.buildFile(id, '.pdf'))) return null;
    return this.state.lastGoodPdfUrl;
  }

  private async failure(buildId: string, started: Date, t0: number, sourceRev: string, message: string, snap: Config): Promise<CompileResult> {
    return {
      ok: false,
      buildId,
      startedAt: started.toISOString(),
      durationMs: Math.round(performance.now() - t0),
      diagnostics: [{ severity: 'error', file: snap.memoriaMain, line: null, message }],
      pdfUrl: await this.lastGood(),
      sourceRev,
    };
  }

  private async pdfExists(rel: string): Promise<boolean> {
    const abs = path.resolve(this.cfg.buildDir, rel);
    if (!isInside(this.cfg.buildDir, abs)) return false;
    return fs.stat(abs).then((s) => s.isFile(), () => false);
  }

  private async persist() {
    await fs.mkdir(this.cfg.buildDir, { recursive: true });
    await atomicWrite(this.lastFile, JSON.stringify(this.state, null, 2));
  }

  /** Locate an artifact (pdf/log/synctex) of a build. */
  async buildFile(buildId: string, ext: '.pdf' | '.log' | '.synctex.gz'): Promise<string | null> {
    if (!isValidBuildId(buildId)) return null;
    const dir = path.join(this.cfg.buildDir, buildId);
    if (!isInside(this.cfg.buildDir, dir)) return null;
    const preferred = path.join(dir, path.basename(this.cfg.memoriaMain).replace(/\.tex$/i, '') + ext);
    const candidates = [preferred, path.join(dir, 'main' + ext)];
    for (const c of candidates) {
      if (await fs.stat(c).then((s) => s.isFile(), () => false)) return c;
    }
    const ents = await fs.readdir(dir).catch(() => [] as string[]);
    const hit = ents.find((e) => e.toLowerCase().endsWith(ext));
    return hit ? path.join(dir, hit) : null;
  }

  /** SyncTeX analizado de una compilación (null si no existe o no se puede leer). */
  async synctex(buildId: string): Promise<SynctexData | null> {
    const abs = await this.buildFile(buildId, '.synctex.gz');
    const st = abs ? await fs.stat(abs).catch(() => null) : null;
    if (!abs || !st) return null;
    const key = `${abs}\0${st.mtimeMs}\0${st.size}`;
    let p = this.synctexCache.get(key);
    if (p) {
      this.synctexCache.delete(key);
    } else {
      p = fs
        .readFile(abs)
        .then((buf) => gunzip(buf, { maxOutputLength: MAX_SYNCTEX_BYTES }))
        .then((raw) => parseSynctex(raw.toString('utf8')))
        .catch(() => {
          this.synctexCache.delete(key);
          return null;
        });
    }
    this.synctexCache.set(key, p);
    while (this.synctexCache.size > SYNCTEX_CACHE) this.synctexCache.delete(this.synctexCache.keys().next().value!);
    return p;
  }
}

function localBuildId(d: Date): string {
  return `local-${d.toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
}
