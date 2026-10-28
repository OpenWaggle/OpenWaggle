import type {
  ResolvedShellEnvironment,
  ShellEnvironmentCache,
} from './desktop-shell-environment-cache'
import {
  readLaunchctlPath,
  readLoginShellEnvironment,
  readWindowsShellEnvironment,
  runBoundedShellEnvironmentCommand,
  type ShellEnvironmentCommandRunner,
  type ShellEnvironmentPatch,
} from './desktop-shell-environment-probes'

type MutableEnvironment = Record<string, string | undefined>

export interface DesktopShellEnvironmentOptions {
  readonly env: MutableEnvironment
  readonly platform: NodeJS.Platform
  readonly userShell?: string
  readonly uid?: number
  readonly exists?: (path: string) => boolean
  readonly runCommand?: ShellEnvironmentCommandRunner
}

const LOCALE_ENV_NAMES = ['LANG', 'LC_ALL', 'LC_CTYPE'] as const
const FALLBACK_LC_CTYPE = 'en_US.UTF-8'

function trimNonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function pathDelimiter(platform: NodeJS.Platform) {
  return platform === 'win32' ? ';' : ':'
}

function readEnvPath(env: MutableEnvironment) {
  return trimNonEmpty(env.PATH ?? env.Path ?? env.path)
}

function mergePaths(platform: NodeJS.Platform, values: readonly (string | undefined)[]) {
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

function loginShellCandidates(options: DesktopShellEnvironmentOptions) {
  const fallback =
    options.platform === 'darwin' ? '/bin/zsh' : options.platform === 'linux' ? '/bin/bash' : ''
  return [...new Set([options.env.SHELL, options.userShell, fallback].map(trimNonEmpty))].filter(
    (candidate): candidate is string => candidate !== undefined,
  )
}

function knownWindowsCliDirs(env: MutableEnvironment) {
  const paths: string[] = []
  const appData = trimNonEmpty(env.APPDATA)
  const localAppData = trimNonEmpty(env.LOCALAPPDATA)
  const userProfile = trimNonEmpty(env.USERPROFILE)
  if (appData) paths.push(`${appData}\\npm`)
  if (localAppData) {
    paths.push(
      `${localAppData}\\Programs\\nodejs`,
      `${localAppData}\\Volta\\bin`,
      `${localAppData}\\pnpm`,
    )
  }
  if (userProfile) {
    paths.push(
      `${userProfile}\\.local\\bin`,
      `${userProfile}\\.bun\\bin`,
      `${userProfile}\\scoop\\shims`,
    )
  }
  return paths
}

function fillMissingEnvironment(
  target: MutableEnvironment,
  source: ShellEnvironmentPatch,
  names: readonly string[],
) {
  for (const name of names) {
    if (!trimNonEmpty(target[name]) && source[name]) target[name] = source[name]
  }
}

async function installWindowsEnvironment(
  options: DesktopShellEnvironmentOptions,
  runner: ShellEnvironmentCommandRunner,
) {
  const [noProfile, profile] = await Promise.all([
    readWindowsShellEnvironment(runner, false),
    readWindowsShellEnvironment(runner, true),
  ])
  const path = mergePaths(options.platform, [
    trimNonEmpty(profile.PATH),
    knownWindowsCliDirs(options.env).join(';'),
    trimNonEmpty(noProfile.PATH),
    readEnvPath(options.env),
  ])
  if (path) options.env.PATH = path
  fillMissingEnvironment(options.env, profile, ['FNM_DIR', 'FNM_MULTISHELL_PATH'])
}

async function readPreferredLoginShellEnvironment(
  options: DesktopShellEnvironmentOptions,
  runner: ShellEnvironmentCommandRunner,
) {
  const environment: ShellEnvironmentPatch = {}
  for (const shell of loginShellCandidates(options)) {
    Object.assign(environment, await readLoginShellEnvironment(shell, runner))
    if (environment.PATH) break
  }
  return environment
}

function installLocaleEnvironment(
  options: DesktopShellEnvironmentOptions,
  base: MutableEnvironment,
  shellEnvironment: ShellEnvironmentPatch,
) {
  if (options.platform !== 'darwin') return
  if (LOCALE_ENV_NAMES.some((name) => trimNonEmpty(base[name]))) return
  for (const name of LOCALE_ENV_NAMES) {
    if (shellEnvironment[name]) options.env[name] = shellEnvironment[name]
  }
  if (!LOCALE_ENV_NAMES.some((name) => trimNonEmpty(options.env[name]))) {
    options.env.LC_CTYPE = FALLBACK_LC_CTYPE
  }
}

function installLinuxDbusEnvironment(options: DesktopShellEnvironmentOptions) {
  if (options.platform !== 'linux' || trimNonEmpty(options.env.DBUS_SESSION_BUS_ADDRESS)) return
  const runtimeDirectories = [trimNonEmpty(options.env.XDG_RUNTIME_DIR)]
  if (options.uid !== undefined) runtimeDirectories.push(`/run/user/${options.uid}`)
  for (const runtimeDirectory of runtimeDirectories) {
    if (!runtimeDirectory) continue
    const busPath = `${runtimeDirectory.replace(/\/+$/u, '')}/bus`
    if (options.exists?.(busPath) !== true) continue
    options.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busPath}`
    return
  }
}

const FILLED_ENV_NAMES = [
  'SSH_AUTH_SOCK',
  'DISPLAY',
  'HOMEBREW_PREFIX',
  'HOMEBREW_CELLAR',
  'HOMEBREW_REPOSITORY',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'WAYLAND_DISPLAY',
] as const
const REPLACED_ENV_NAMES = [
  'DBUS_SESSION_BUS_ADDRESS',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_DESKTOP',
  'XDG_SESSION_TYPE',
] as const
const BASE_ENV_NAMES = ['PATH', 'Path', 'path', ...FILLED_ENV_NAMES, ...LOCALE_ENV_NAMES] as const

async function probePosixEnvironment(
  options: DesktopShellEnvironmentOptions,
  runner: ShellEnvironmentCommandRunner,
): Promise<ResolvedShellEnvironment> {
  const environment = await readPreferredLoginShellEnvironment(options, runner)
  const launchctlPath =
    options.platform === 'darwin' && !environment.PATH ? await readLaunchctlPath(runner) : undefined
  return { environment, ...(launchctlPath === undefined ? {} : { launchctlPath }) }
}

/**
 * Applies a probe's result over the environment this process started with (`base`), so a later
 * result (the refresh after a cached one) replaces the earlier one instead of stacking on it.
 */
function applyPosixEnvironment(
  options: DesktopShellEnvironmentOptions,
  base: MutableEnvironment,
  resolved: ResolvedShellEnvironment,
) {
  const shellEnvironment = resolved.environment
  const path = mergePaths(options.platform, [
    trimNonEmpty(shellEnvironment.PATH) ?? resolved.launchctlPath,
    readEnvPath(base),
  ])
  if (path) options.env.PATH = path
  for (const name of FILLED_ENV_NAMES) {
    if (!trimNonEmpty(base[name]) && shellEnvironment[name])
      options.env[name] = shellEnvironment[name]
  }
  for (const name of REPLACED_ENV_NAMES) {
    if (shellEnvironment[name]) options.env[name] = shellEnvironment[name]
  }
  installLocaleEnvironment(options, base, shellEnvironment)
  installLinuxDbusEnvironment(options)
}

function snapshotBase(env: MutableEnvironment): MutableEnvironment {
  return Object.fromEntries(BASE_ENV_NAMES.map((name) => [name, env[name]]))
}

export async function installDesktopShellEnvironment(
  options: DesktopShellEnvironmentOptions,
): Promise<void> {
  const runner = options.runCommand ?? runBoundedShellEnvironmentCommand
  if (options.platform === 'win32') {
    await installWindowsEnvironment(options, runner)
    return
  }
  if (options.platform === 'darwin' || options.platform === 'linux') {
    const base = snapshotBase(options.env)
    applyPosixEnvironment(options, base, await probePosixEnvironment(options, runner))
  }
}

/** A probe that found neither a PATH nor launchd's: nothing worth applying or caching. */
function resolvedNothing(resolved: ResolvedShellEnvironment) {
  return !trimNonEmpty(resolved.environment.PATH) && !resolved.launchctlPath
}

export interface StartedDesktopShellEnvironment {
  /** Settles once the environment is usable: at once from the cache, else after the probe. */
  readonly ready: Promise<void>
  /** Settles once the probe has run and its result is applied (and cached). */
  readonly refreshed: Promise<void>
  /** Whether `ready` came from the cache. */
  readonly fromCache: boolean
}

/**
 * Hydrates the environment without blocking on the login shell when it can: a cached result for
 * the same shell and HOME applies at once, and the probe refreshes it (and the cache) in the
 * background. Without one, `ready` waits for the probe. Windows reads its PowerShell profile as
 * before; it is not cached.
 */
export function startDesktopShellEnvironment(
  options: DesktopShellEnvironmentOptions & {
    readonly cache?: ShellEnvironmentCache
    readonly now?: () => number
  },
): StartedDesktopShellEnvironment {
  if (options.platform !== 'darwin' && options.platform !== 'linux') {
    const installed = installDesktopShellEnvironment(options)
    return { ready: installed, refreshed: installed, fromCache: false }
  }
  const now = options.now ?? Date.now
  const runner = options.runCommand ?? runBoundedShellEnvironmentCommand
  const base = snapshotBase(options.env)
  const shell = loginShellCandidates(options)[0]
  const home = trimNonEmpty(options.env.HOME)
  const key = shell && home ? { platform: options.platform, shell, home } : null
  const cached = key ? (options.cache?.read(key, now()) ?? null) : null
  if (cached) applyPosixEnvironment(options, base, cached)
  const refreshed = probePosixEnvironment(options, runner).then((resolved) => {
    // A failed probe keeps what the cache gave; it is retried on the next launch.
    if (cached && resolvedNothing(resolved)) return
    applyPosixEnvironment(options, base, resolved)
    if (key && !resolvedNothing(resolved)) options.cache?.write(key, resolved, now())
  })
  return { ready: cached ? Promise.resolve() : refreshed, refreshed, fromCache: cached !== null }
}
