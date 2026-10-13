import type { Readable } from 'node:stream';
import type { Config } from '../config.ts';
import type { Diagnostic } from '../compile.ts';
import { dockerEngine } from './docker.ts';
import { localEngine } from './local.ts';

export interface EngineHealth {
  ok: boolean;
  version: string | null;
  capabilities: { compile: boolean; svg2pdf: boolean };
}

export interface EngineResult {
  ok: boolean;
  buildId: string;
  durationMs: number | null;
  pdf: string | null;
  diagnostics: Diagnostic[];
}

export interface Engine {
  type: 'docker' | 'local';
  health(): Promise<EngineHealth>;
  compile(sources: Readable, main: string, signal?: AbortSignal): Promise<EngineResult>;
  svg2pdf(svg: string, browserPdf?: Buffer): Promise<Buffer>;
}

export async function createEngine(cfg: Config): Promise<Engine> {
  const docker = dockerEngine(cfg.workerUrl);
  if (cfg.compileEngine === 'docker') return docker;
  const local = localEngine(cfg);
  if (cfg.compileEngine === 'local') return local;
  return (await docker.health()).ok ? docker : local;
}
