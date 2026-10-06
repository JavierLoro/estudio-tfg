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
  kind: 'add' | 'change' | 'unlink';
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
  const dirs = ROOTS.map((r) => rootDir(cfg, r));
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
  const emit = (kind: ChangeEvent['kind']) => (p: string) => {
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
