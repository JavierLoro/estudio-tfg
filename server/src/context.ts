import type { Config } from './config.ts';
import type { Compiler } from './compile.ts';
import type { EventBus } from './events.ts';
import type { KeyedLock } from './fsutil.ts';

export interface Ctx {
  cfg: Config;
  bus: EventBus;
  compiler: Compiler;
  locks: KeyedLock;
}
