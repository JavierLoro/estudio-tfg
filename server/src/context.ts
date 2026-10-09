import type { Config } from './config.ts';
import type { Compiler } from './compile.ts';
import type { EventBus, WatchManager } from './events.ts';
import type { Settings } from './settings.ts';
import type { KeyedLock } from './fsutil.ts';
import type { OutlineService } from './outline.ts';

import type { MetadataFetcher } from './metadataHttp.ts';

export interface Ctx {
  fetchMetadata?: MetadataFetcher;
  cfg: Config;
  bus: EventBus;
  compiler: Compiler;
  locks: KeyedLock;
  /** Cached outline of the memoria (Vista Documento). */
  outline: OutlineService;
  settings: Settings;
  /** null when the app was built without a watcher (tests). */
  watcher: WatchManager | null;
}
