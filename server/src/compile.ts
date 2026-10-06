import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { atomicWrite, walkFiles } from './fsutil.ts';
import { isInside } from './paths.ts';

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
const BUILD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidBuildId(id: string): boolean {
  return BUILD_ID_RE.test(id) && !id.includes('..');
}

/** Hash over the (non-ignored) memoria sources: path + content of each file, sorted. */
export async function computeSourceRev(cfg: Config): Promise<string> {
  const files = await walkFiles(cfg, 'memoria');
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
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
    const sourceRev = await computeSourceRev(this.cfg);
    let result: CompileResult;
    try {
      const res = await fetch(`${this.cfg.workerUrl}/compile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ main: this.cfg.memoriaMain }),
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      });
      const text = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* not json */
      }
      const buildId = typeof body?.buildId === 'string' && isValidBuildId(body.buildId) ? body.buildId : localBuildId(started);
      if (!res.ok && !body?.diagnostics) {
        result = await this.failure(buildId, started, t0, sourceRev, `Error del worker (HTTP ${res.status}): ${text.slice(0, 300)}`);
      } else {
        const ok = Boolean(body?.ok) && typeof body?.pdf === 'string' && (await this.pdfExists(body.pdf));
        const diagnostics = normDiagnostics(body?.diagnostics);
        if (body?.ok && !ok) {
          diagnostics.push({ severity: 'error', file: this.cfg.memoriaMain, line: null, message: 'El worker no generó el PDF esperado' });
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
      result = await this.failure(localBuildId(started), started, t0, sourceRev, msg);
    }
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
    const url = this.state.lastGoodPdfUrl;
    const m = url ? /^\/api\/pdf\/(.+)\.pdf$/.exec(url) : null;
    if (!m || !(await this.buildFile(m[1], '.pdf'))) return null;
    return url;
  }

  private async failure(buildId: string, started: Date, t0: number, sourceRev: string, message: string): Promise<CompileResult> {
    return {
      ok: false,
      buildId,
      startedAt: started.toISOString(),
      durationMs: Math.round(performance.now() - t0),
      diagnostics: [{ severity: 'error', file: this.cfg.memoriaMain, line: null, message }],
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

  /** Locate an artifact (pdf/log) of a build. */
  async buildFile(buildId: string, ext: '.pdf' | '.log'): Promise<string | null> {
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
}

function localBuildId(d: Date): string {
  return `local-${d.toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
}
