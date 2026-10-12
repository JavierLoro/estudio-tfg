import type { Readable } from 'node:stream';
import type { Config } from '../config.ts';
import type { Diagnostic } from '../compile.ts';
import { dockerEngine } from './docker.ts';

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
  compile(sources: Readable, main: string): Promise<EngineResult>;
  svg2pdf(svg: string): Promise<Buffer>;
}

export function createEngine(cfg: Config): Engine {
  return dockerEngine(cfg.workerUrl);
}
