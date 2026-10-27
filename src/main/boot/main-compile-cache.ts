import nodeModule from 'node:module'
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

/** The part of `node:module` the shim uses. */
export interface CompileCacheApi {
  readonly enableCompileCache: (directory: string) => { readonly status: number }
  readonly flushCompileCache: () => void
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
}

const DISABLED_CACHE: MainCompileCache = { enabled: false, flush: () => undefined }

/**
 * Turns on Node's on-disk V8 compile cache for every module this process loads from now on
 * (A-F3: the 25 MB main bundle compiled in ≈185 ms on every launch and in ≈25 ms from cache).
 * Entries are keyed by file content, so an update recompiles once. A failure never stops startup.
 */
export function enableMainCompileCache(
  location: MainCompileCacheLocation,
  api: CompileCacheApi = nodeModule,
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
