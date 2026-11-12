/** PATH handling for the login-shell environment (`desktop-shell-environment.ts`). */
import type { ResolvedShellEnvironment } from './desktop-shell-environment-cache'

export type MutableEnvironment = Record<string, string | undefined>

export function trimNonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function pathDelimiter(platform: NodeJS.Platform) {
  return platform === 'win32' ? ';' : ':'
}

export function readEnvPath(env: MutableEnvironment) {
  return trimNonEmpty(env.PATH ?? env.Path ?? env.path)
}

export function mergePaths(platform: NodeJS.Platform, values: readonly (string | undefined)[]) {
  const delimiter = pathDelimiter(platform)
  const entries: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (value === undefined) continue
    for (const rawEntry of value.split(delimiter)) {
      const entry = platform === 'win32' ? rawEntry.trim().replaceAll('"', '') : rawEntry.trim()
      const key = platform === 'win32' ? entry.toLowerCase() : entry
      if (key.length === 0 || seen.has(key)) continue
      seen.add(key)
      entries.push(entry)
    }
  }
  return entries.length > 0 ? entries.join(delimiter) : undefined
}

/**
 * The PATH a desktop session starts with when nothing configured it: launchd's on macOS,
 * systemd's on Linux. Every launch has these, so the cache keeps them in the shell's order.
 */
const DEFAULT_SESSION_PATHS: Readonly<Partial<Record<NodeJS.Platform, ReadonlySet<string>>>> = {
  darwin: new Set(['/usr/bin', '/bin', '/usr/sbin', '/sbin']),
  linux: new Set(['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin']),
}

/**
 * A login shell keeps the PATH it inherits, so a launch from a terminal (`openwaggle <dir>`, or a
 * GUI started from one) probes back that terminal's entries: a venv `bin`, a project's
 * `node_modules/.bin`. Cached, they would reach the next Dock or Finder launch and every Host that
 * reads the cache. An entry the launch PATH already had is cached only when it is a default
 * session directory or the previous cached result had it too (a terminal's `/opt/homebrew/bin`
 * that a Dock launch's shell produced), so it can only have come from a shell. This launch still
 * gets its own entries through `apply`, which merges the launch PATH back in.
 */
export function withoutLaunchOnlyPath(
  platform: NodeJS.Platform,
  resolved: ResolvedShellEnvironment,
  launchEnvironment: Readonly<MutableEnvironment>,
  previous: ResolvedShellEnvironment | null,
): ResolvedShellEnvironment {
  const probedPath = trimNonEmpty(resolved.environment.PATH)
  const launchPath = readEnvPath(launchEnvironment)
  if (!probedPath || !launchPath) return resolved
  const delimiter = pathDelimiter(platform)
  const entriesOf = (value: string | undefined) =>
    (value ?? '')
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  const fromShell = new Set([
    ...(DEFAULT_SESSION_PATHS[platform] ?? []),
    ...entriesOf(previous?.environment.PATH),
  ])
  const launchOnly = new Set(entriesOf(launchPath).filter((entry) => !fromShell.has(entry)))
  const kept = probedPath.split(delimiter).filter((entry) => !launchOnly.has(entry.trim()))
  const environment = { ...resolved.environment }
  if (kept.length > 0) environment.PATH = kept.join(delimiter)
  else Reflect.deleteProperty(environment, 'PATH')
  return { ...resolved, environment }
}
