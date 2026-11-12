import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { fileShellEnvironmentCache } from './desktop-shell-environment-cache'
import {
  type StartedDesktopShellEnvironment,
  startDesktopShellEnvironment,
} from './desktop-shell-environment-start'
import { liveProcessEnvironment } from './env'

let desktopShellEnvironment: StartedDesktopShellEnvironment | null = null
let cacheRefreshStartedAt: number | null = null

/** How long a Host waits for the desktop app's refresh before it runs its own login shell. */
const REFRESH_ELSEWHERE_TIMEOUT_MS = 12_000

function userLoginShell() {
  if (process.platform === 'win32') return undefined
  try {
    return userInfo().shell || undefined
  } catch {
    return undefined
  }
}

/** The login shell and uid of this process's user, leaving out the ones it does not have. */
function processUserIdentity() {
  const userShell = userLoginShell()
  const uid = process.getuid?.()
  return {
    ...(userShell === undefined ? {} : { userShell }),
    ...(uid === undefined ? {} : { uid }),
  }
}

export interface ProcessDesktopShellEnvironmentOptions {
  readonly cacheFile?: string
  /** False for a Session Host: only the desktop app writes the cache (see below). */
  readonly writeCache?: boolean
  /** The launching desktop app refreshes the cache from this epoch ms on; wait for it. */
  readonly refreshedElsewhereSince?: number
}

/**
 * Hydrates GUI-launch gaps (PATH, SSH agent, locale) from the login shell once per process. With
 * `cacheFile`, the last result for this shell and HOME applies at once and the probe refreshes it
 * in the background; startup never waits for it. Work that starts the user's own tools waits for
 * `desktopShellEnvironmentReady()` instead. Only the desktop app writes the cache: a Host can be
 * started from a terminal or an agent shell, whose PATH (a venv, a project's `node_modules/.bin`)
 * would otherwise reach every later launch, and a Host the desktop app launched waits for the
 * app's refresh rather than running a second login shell.
 */
export function installProcessDesktopShellEnvironment(
  environment: Record<string, string | undefined>,
  options: ProcessDesktopShellEnvironmentOptions = {},
) {
  if (desktopShellEnvironment) return desktopShellEnvironment
  const writesCache = options.cacheFile !== undefined && options.writeCache !== false
  if (writesCache) cacheRefreshStartedAt = Date.now()
  desktopShellEnvironment = startDesktopShellEnvironment({
    env: environment,
    platform: process.platform,
    ...processUserIdentity(),
    exists: existsSync,
    ...(options.cacheFile ? { cache: fileShellEnvironmentCache(options.cacheFile) } : {}),
    writeCache: writesCache,
    ...(options.refreshedElsewhereSince === undefined
      ? {}
      : {
          refreshedElsewhere: {
            since: options.refreshedElsewhereSince,
            timeoutMs: REFRESH_ELSEWHERE_TIMEOUT_MS,
          },
        }),
  })
  return desktopShellEnvironment
}

/** Hydrates this process's environment from the login shell. */
export function installDesktopShellEnvironment(
  options: ProcessDesktopShellEnvironmentOptions = {},
) {
  return installProcessDesktopShellEnvironment(liveProcessEnvironment(), options)
}

/**
 * When this process started refreshing the profile's login-shell cache (the desktop app), so a
 * Host it launches can wait for that refresh instead of probing again; null if it does not.
 */
export function desktopShellEnvironmentRefreshStartedAt() {
  return cacheRefreshStartedAt
}

/**
 * Settles once the login-shell environment is usable in this process: at once from the cache,
 * else when the probe finishes, failed or not. Runs, agent tools, terminals, project actions,
 * git and stdio MCP servers wait for it before they start a process. A process that never
 * hydrates (the CLI, tests) does not wait.
 */
export function desktopShellEnvironmentReady() {
  return desktopShellEnvironment
    ? desktopShellEnvironment.ready.catch(() => undefined)
    : Promise.resolve()
}
