import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Config } from './config.ts';
import { isIgnoredRel } from './ignore.ts';
import { ROOTS, rootDir, toPosix, type RootName } from './paths.ts';

export interface ChangeEvent {
  root: RootName;
  path: string;
  kind: 'add' | 'change' | 'unlink' | 'move';
  /** Solo en `move`: ruta anterior. */
  from?: string;
}

export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
  change(e: ChangeEvent) {
    this.emit('change', e);
  }
}

function realOr(p: string) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Map an absolute path to { root, rel } (longest root wins). */
export function locate(cfg: Config, abs: string): { root: RootName; rel: string } | null {
  const cands = ROOTS.flatMap((r) => {
    const d = rootDir(cfg, r);
    return [{ r, d }, { r, d: realOr(d) }];
  }).sort((a, b) => b.d.length - a.d.length);
  for (const { r, d } of cands) {
    const rel = path.relative(d, abs);
    if (rel === '') return { root: r, rel: '' };
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return { root: r, rel: toPosix(rel) };
  }
  return null;
}

export function startWatcher(cfg: Config, bus: EventBus): FSWatcher {
  // Missing roots (not configured yet) are simply not watched; restart() after settings change.
  const dirs = ROOTS.map((r) => rootDir(cfg, r)).filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
  const watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (p: string, stats?: fs.Stats) => {
      const loc = locate(cfg, p);
      if (!loc) return false;
      return isIgnoredRel(loc.rel, loc.root, stats ? stats.isDirectory() : undefined);
    },
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  const emit = (kind: 'add' | 'change' | 'unlink') => (p: string) => {
    const loc = locate(cfg, p);
    if (!loc || !loc.rel) return;
    bus.change({ root: loc.root, path: loc.rel, kind });
  };
  watcher.on('add', emit('add'));
  watcher.on('addDir', emit('add'));
  watcher.on('change', emit('change'));
  watcher.on('unlink', emit('unlink'));
  watcher.on('unlinkDir', emit('unlink'));
  watcher.on('error', () => {});
  return watcher;
}

/** Owns the chokidar watcher so it can be restarted when settings change. */
export class WatchManager {
  private watcher: FSWatcher | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private cfg: Config,
    private bus: EventBus,
  ) {}

  /** Resolves when the (new) watcher is ready. */
  restart(): Promise<void> {
    const next = this.chain.then(async () => {
      const old = this.watcher;
      this.watcher = null;
      await old?.close().catch(() => {});
      const w = startWatcher(this.cfg, this.bus);
      this.watcher = w;
      await new Promise<void>((r) => {
        const t = setTimeout(r, 10_000);
        w.once('ready', () => {
          clearTimeout(t);
          r();
        });
      });
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  start(): Promise<void> {
    return this.restart();
  }

  close(): Promise<void> {
    const next = this.chain.then(async () => {
      const old = this.watcher;
      this.watcher = null;
      await old?.close().catch(() => {});
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  get current(): FSWatcher | null {
    return this.watcher;
  }
}
