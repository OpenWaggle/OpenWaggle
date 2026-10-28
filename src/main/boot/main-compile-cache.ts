import { readdir, realpath, rm, stat, utimes } from 'node:fs/promises'
import nodeModule from 'node:module'
import path from 'node:path'
import type { MainCompileCacheLocation } from './main-compile-cache-location'

/**
 * When the cache is written again after the main bundle loaded, for files each process loads on
 * demand: the externals behind `lazyModule` and Rolldown's lazy stand-ins (sharp, editorconfig,
 * electron-updater, the embedding model), Pi's worker files. The Host loads some before it
 * listens (≈1 s), the window while it opens (≈3 s), the rest later. A write finds nothing new for
 * files already written, so the later ones cost almost nothing.
 */
export const MAIN_COMPILE_CACHE_LATE_FLUSH_DELAYS_MS: readonly number[] = [
  1_000, 3_000, 10_000, 60_000,
]

/**
 * When the desktop app and the Session Host first write it. Writing serializes what V8 compiled
 * (≈40 ms for the main bundle on a cold cache), which right after the bundle loaded sat on both
 * processes' path to the window and to listening (W11). They run for minutes, so it waits until
 * they are up; either process stopped within these seconds only costs the next launch its cache.
 */
export const LONG_LIVED_PROCESS_FLUSH_DELAYS_MS: readonly number[] = [3_000, 10_000, 60_000]

/**
 * How long a sibling cache directory may go unused before a long-lived process removes it. Node
 * keys its cache directory by Node version, architecture, V8 flags and user
 * (`v24.22.1-arm64-964aae3f-501`), so every Electron upgrade starts a new one and the old one,
 * about the size of the main bundle's code cache, would stay forever. Each process touches its own
 * directory after it writes, so only directories no installed build uses age out, even where the
 * window and the Host keep different ones.
 */
export const STALE_COMPILE_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1_000

/** The file operations the stale-cache sweep uses. */
export interface CompileCacheFileSystem {
  readonly readdir: (directory: string) => Promise<readonly string[]>
  readonly stat: (entry: string) => Promise<{ readonly mtimeMs: number; isDirectory(): boolean }>
  readonly rm: (entry: string) => Promise<void>
  readonly touch: (entry: string, at: Date) => Promise<void>
  readonly realpath: (entry: string) => Promise<string>
}

const NODE_FILE_SYSTEM: CompileCacheFileSystem = {
  readdir: (directory) => readdir(directory),
  stat: (entry) => stat(entry),
  rm: (entry) => rm(entry, { recursive: true, force: true }),
  touch: (entry, at) => utimes(entry, at, at),
  realpath: (entry) => realpath(entry),
}

/** The part of `node:module` the shim uses. */
export interface CompileCacheApi {
  readonly enableCompileCache: (directory: string) => { readonly status: number }
  readonly flushCompileCache: () => void
  /** The versioned subdirectory Node writes into (`<directory>/v24.22.1-arm64-…`). */
  readonly getCompileCacheDir?: () => string | undefined
  readonly constants: {
    readonly compileCacheStatus: {
      readonly ENABLED: number
      readonly ALREADY_ENABLED: number
    }
  }
}

export type ScheduleTimer = (callback: () => void, delayMs: number) => { unref?: () => unknown }

export interface MainCompileCache {
  readonly enabled: boolean
  /** Writes what V8 compiled so far. Never throws: a cache is an optimization. */
  readonly flush: () => void
  /**
   * Marks this process's cache directory used and removes sibling directories unused for
   * `STALE_COMPILE_CACHE_AGE_MS` (an older Electron's). Never rejects.
   */
  readonly pruneStale?: () => Promise<void>
}

const DISABLED_CACHE: MainCompileCache = { enabled: false, flush: () => undefined }

/** See `MainCompileCache.pruneStale`. */
export async function pruneStaleCompileCaches(
  current: string,
  fileSystem: CompileCacheFileSystem,
  now: number,
) {
  const parent = path.dirname(current)
  const own = path.basename(current)
  try {
    await fileSystem.touch(current, new Date(now))
    for (const name of await fileSystem.readdir(parent)) {
      if (name === own) continue
      const entry = path.join(parent, name)
      const info = await fileSystem.stat(entry).catch(() => null)
      if (!info?.isDirectory() || now - info.mtimeMs < STALE_COMPILE_CACHE_AGE_MS) continue
      await fileSystem.rm(entry).catch(() => undefined)
    }
  } catch {
    // A cache sweep is housekeeping; the next long-lived process tries again.
  }
}

/**
 * Turns on Node's on-disk V8 compile cache for every module this process loads from now on
 * (A-F3: the 25 MB main bundle compiled in ≈185 ms on every launch and in ≈25 ms from cache).
 * Entries are keyed by file content, so an update recompiles once. A failure never stops startup.
 */
export function enableMainCompileCache(
  location: MainCompileCacheLocation,
  api: CompileCacheApi = nodeModule,
  fileSystem: CompileCacheFileSystem = NODE_FILE_SYSTEM,
  now: () => number = Date.now,
): MainCompileCache {
  if (location.kind === 'disabled') return DISABLED_CACHE
  try {
    const { status } = api.enableCompileCache(location.directory)
    const { ENABLED, ALREADY_ENABLED } = api.constants.compileCacheStatus
    if (status !== ENABLED && status !== ALREADY_ENABLED) return DISABLED_CACHE
  } catch {
    return DISABLED_CACHE
  }
  return {
    enabled: true,
    flush: () => {
      try {
        api.flushCompileCache()
      } catch {
        // An unwritable cache directory only costs the next launch its compile time.
      }
    },
    pruneStale: async () => {
      const current = api.getCompileCacheDir?.()
      if (!current) return
      // Only below the directory this shim chose (Node reports it resolved, /tmp as /private/tmp).
      const chosen = await fileSystem.realpath(location.directory).catch(() => path.resolve(location.directory))
      if (path.dirname(current) !== chosen) return
      await pruneStaleCompileCaches(current, fileSystem, now())
    },
  }
}

/**
 * Writes the cache now, and again after startup for files loaded later.
 *
 * V8 produces a module's cache data when it compiles the module, so writing right after the main
 * bundle loaded already holds the bundle; a later write adds the files loaded since. It has to be
 * written explicitly: Node writes the cache when the process exits normally, and Electron's
 * `app.exit()` (every CLI command) and a killed Session Host never exit normally. The later write
 * never keeps a finished command alive.
 */
export function flushMainCompileCacheAfterLoad(
  cache: MainCompileCache,
  scheduleTimer: ScheduleTimer,
  lateFlushDelaysMs: readonly number[] = MAIN_COMPILE_CACHE_LATE_FLUSH_DELAYS_MS,
) {
  if (!cache.enabled) return
  cache.flush()
  for (const delayMs of lateFlushDelaysMs) scheduleTimer(cache.flush, delayMs).unref?.()
}

/**
 * The desktop app's and the Session Host's writes: none while they start, then the later ones
 * (`LONG_LIVED_PROCESS_FLUSH_DELAYS_MS`). After the first write they also sweep stale cache
 * directories, once. Short commands keep `flushMainCompileCacheAfterLoad` and never sweep.
 */
export function flushMainCompileCacheOnceStarted(
  cache: MainCompileCache,
  scheduleTimer: ScheduleTimer,
) {
  if (!cache.enabled) return
  for (const [index, delayMs] of LONG_LIVED_PROCESS_FLUSH_DELAYS_MS.entries()) {
    const write =
      index === 0
        ? () => {
            cache.flush()
            void cache.pruneStale?.()
          }
        : cache.flush
    scheduleTimer(write, delayMs).unref?.()
  }
}
