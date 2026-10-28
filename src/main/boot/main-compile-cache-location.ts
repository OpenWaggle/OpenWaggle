import path from 'node:path'
import type { BuildChannel } from '@shared/types/build-identity'

/** Directory name under the per-user cache root; the channel keeps release lines apart. */
const CACHE_DIRECTORY_NAME = 'compile-cache'
const APPLICATION_DIRECTORY_NAME = 'OpenWaggle'
const LINUX_APPLICATION_DIRECTORY_NAME = 'openwaggle'

export interface MainCompileCacheEnvironment {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homeDirectory: string
  readonly channel: BuildChannel
}

export type MainCompileCacheLocation =
  | { readonly kind: 'enabled'; readonly directory: string }
  | { readonly kind: 'disabled'; readonly reason: 'opted-out' | 'appimage' }

function perUserCacheRoot(environment: MainCompileCacheEnvironment) {
  const { env, homeDirectory, platform } = environment
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Caches', APPLICATION_DIRECTORY_NAME)
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local')
    return path.join(localAppData, APPLICATION_DIRECTORY_NAME, 'Cache')
  }
  const xdgCacheHome = env.XDG_CACHE_HOME
  const cacheHome =
    xdgCacheHome && path.isAbsolute(xdgCacheHome)
      ? xdgCacheHome
      : path.join(homeDirectory, '.cache')
  return path.join(cacheHome, LINUX_APPLICATION_DIRECTORY_NAME)
}

/**
 * Where V8 keeps compiled code for the main bundle between launches (A-F3).
 *
 * The directory is per user and per Build channel, outside userData (ADR 0032: the shim runs
 * before anything may decide userData) and outside `os.tmpdir()`, which a CLI started from an
 * agent shell inherits as that Session's scratch directory (ADR 0042). An AppImage mounts at a
 * new path on every launch, so a cache keyed by file name would only grow; it is skipped there,
 * as t3code does. `OPENWAGGLE_COMPILE_CACHE_DIR` moves it (measurement profiles keep one cache
 * across throwaway homes) and `OPENWAGGLE_DISABLE_COMPILE_CACHE=1` turns it off; Node's own
 * `NODE_DISABLE_COMPILE_CACHE` is honored by Node itself.
 */
export function mainCompileCacheLocation(
  environment: MainCompileCacheEnvironment,
): MainCompileCacheLocation {
  const { env, platform, channel } = environment
  if (env.OPENWAGGLE_DISABLE_COMPILE_CACHE === '1') return { kind: 'disabled', reason: 'opted-out' }
  if (platform === 'linux' && env.APPIMAGE) return { kind: 'disabled', reason: 'appimage' }
  const override = env.OPENWAGGLE_COMPILE_CACHE_DIR
  if (override && path.isAbsolute(override)) {
    return { kind: 'enabled', directory: path.join(override, channel) }
  }
  return {
    kind: 'enabled',
    directory: path.join(perUserCacheRoot(environment), CACHE_DIRECTORY_NAME, channel),
  }
}
