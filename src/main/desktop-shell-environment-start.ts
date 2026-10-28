import {
  type DesktopShellEnvironmentOptions,
  installDesktopShellEnvironment,
  preparePosixShellEnvironment,
  resolvedNothing,
} from './desktop-shell-environment'
import type {
  CachedShellEnvironment,
  ShellEnvironmentCache,
  ShellEnvironmentCacheKey,
} from './desktop-shell-environment-cache'

export interface StartedDesktopShellEnvironment {
  /** Settles once the environment is usable: at once from the cache, else after the probe. */
  readonly ready: Promise<void>
  /** Settles once the probe has run and its result is applied (and cached). */
  readonly refreshed: Promise<void>
  /** Whether `ready` came from the cache. */
  readonly fromCache: boolean
}

/** Another process (the desktop app that launched this Host) probes the login shell and caches it. */
export interface ShellEnvironmentRefreshedElsewhere {
  /** A cached entry resolved at or after this epoch ms is that refresh. */
  readonly since: number
  /** How long to wait for it before probing here. */
  readonly timeoutMs: number
}

const REFRESH_ELSEWHERE_POLL_MS = 100

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds).unref?.()
  })
}

/**
 * The other process's refresh, once it is in the cache; null if none is due, it found nothing
 * (the app marks that, so this process probes at once instead of waiting out the timeout), or it
 * does not come in time.
 */
async function awaitRefreshElsewhere(input: {
  readonly cache: ShellEnvironmentCache | undefined
  readonly key: ShellEnvironmentCacheKey | null
  readonly refreshedElsewhere?: ShellEnvironmentRefreshedElsewhere
  readonly now: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
}): Promise<CachedShellEnvironment | null> {
  const { cache, key, refreshedElsewhere: elsewhere } = input
  if (!cache || !key || !elsewhere) return null
  const sleep = input.sleep ?? defaultSleep
  const deadline = input.now() + elsewhere.timeoutMs
  while (true) {
    const entry = cache.read(key, input.now())
    if (entry && entry.resolvedAt >= elsewhere.since) return entry
    const failedAt = cache.refreshFailedAt(key)
    if (failedAt !== null && failedAt >= elsewhere.since) return null
    if (input.now() >= deadline) return null
    await sleep(REFRESH_ELSEWHERE_POLL_MS)
  }
}

export interface StartDesktopShellEnvironmentOptions extends DesktopShellEnvironmentOptions {
  readonly cache?: ShellEnvironmentCache
  /** False: read the cache, never write it (a Session Host). */
  readonly writeCache?: boolean
  /** Wait for that refresh instead of probing, and probe only if it does not come in time. */
  readonly refreshedElsewhere?: ShellEnvironmentRefreshedElsewhere
  readonly now?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
}

/**
 * Hydrates the environment without blocking on the login shell when it can: a cached result for
 * the same shell and HOME applies at once, and the probe refreshes it (and the cache) in the
 * background. Without one, `ready` waits for the probe. When another process refreshes the cache
 * for this launch (`refreshedElsewhere`), its result is used instead of a second login shell; a
 * result from another process is applied as a cached one. Windows reads its PowerShell profile as
 * before; it is not cached.
 */
export function startDesktopShellEnvironment(
  options: StartDesktopShellEnvironmentOptions,
): StartedDesktopShellEnvironment {
  if (options.platform !== 'darwin' && options.platform !== 'linux') {
    const installed = installDesktopShellEnvironment(options)
    return { ready: installed, refreshed: installed, fromCache: false }
  }
  const now = options.now ?? Date.now
  const posix = preparePosixShellEnvironment(options)
  const { cache } = options
  const { key } = posix
  const cached = key ? (cache?.read(key, now()) ?? null) : null
  if (cached) posix.apply(cached, 'cache')
  const refreshed = awaitRefreshElsewhere({ ...options, cache, key, now }).then(async (fresh) => {
    if (fresh) {
      posix.apply(fresh, 'cache')
      return
    }
    const resolved = await posix.probe()
    const writesCache = key !== null && options.writeCache !== false
    if (resolvedNothing(resolved)) {
      // A Host waiting for this refresh learns at once that it has to probe itself.
      if (writesCache) cache?.markRefreshFailed(key, now())
      // A failed probe keeps what the cache gave; it is retried on the next launch.
      if (cached) return
    }
    posix.apply(resolved, 'probe')
    if (writesCache && !resolvedNothing(resolved)) {
      cache?.write(key, posix.cacheable(resolved, cached), now())
    }
  })
  return { ready: cached ? Promise.resolve() : refreshed, refreshed, fromCache: cached !== null }
}
