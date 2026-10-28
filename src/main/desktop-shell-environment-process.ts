import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import {
  type StartedDesktopShellEnvironment,
  startDesktopShellEnvironment,
} from './desktop-shell-environment'
import { fileShellEnvironmentCache } from './desktop-shell-environment-cache'

let desktopShellEnvironment: StartedDesktopShellEnvironment | null = null

function userLoginShell() {
  if (process.platform === 'win32') return undefined
  try {
    return userInfo().shell || undefined
  } catch {
    return undefined
  }
}

/**
 * Hydrates GUI-launch gaps (PATH, SSH agent, locale) from the login shell once per process. With
 * `cacheFile`, the last result for this shell and HOME applies at once and the probe refreshes it
 * in the background; startup never waits for it. Work that starts the user's own tools waits for
 * `desktopShellEnvironmentReady()` instead.
 */
export function installProcessDesktopShellEnvironment(
  environment: Record<string, string | undefined>,
  options: { readonly cacheFile?: string } = {},
): StartedDesktopShellEnvironment {
  desktopShellEnvironment ??= startDesktopShellEnvironment({
    env: environment,
    platform: process.platform,
    userShell: userLoginShell(),
    uid: process.getuid?.(),
    exists: existsSync,
    ...(options.cacheFile ? { cache: fileShellEnvironmentCache(options.cacheFile) } : {}),
  })
  return desktopShellEnvironment
}

/**
 * Settles once the login-shell environment is usable in this process: at once from the cache,
 * else when the probe finishes, failed or not. Runs, agent tools, terminals, project actions,
 * git and stdio MCP servers wait for it before they start a process. A process that never
 * hydrates (the CLI, tests) does not wait.
 */
export function desktopShellEnvironmentReady(): Promise<void> {
  return desktopShellEnvironment
    ? desktopShellEnvironment.ready.catch(() => undefined)
    : Promise.resolve()
}
