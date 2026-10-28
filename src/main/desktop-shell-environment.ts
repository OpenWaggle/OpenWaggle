import type {
  ResolvedShellEnvironment,
  ShellEnvironmentCacheKey,
} from './desktop-shell-environment-cache'
import {
  type MutableEnvironment,
  mergePaths,
  readEnvPath,
  trimNonEmpty,
  withoutLaunchOnlyPath,
} from './desktop-shell-environment-path'
import {
  readLaunchctlPath,
  readLoginShellEnvironment,
  readWindowsShellEnvironment,
  runBoundedShellEnvironmentCommand,
  type ShellEnvironmentCommandRunner,
  type ShellEnvironmentPatch,
} from './desktop-shell-environment-probes'
import { fillLinuxSessionBusAddress } from './linux-session-bus-environment'

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
  launchEnvironment: Readonly<MutableEnvironment>,
) {
  const environment: ShellEnvironmentPatch = {}
  for (const shell of loginShellCandidates(options)) {
    Object.assign(environment, await readLoginShellEnvironment(shell, runner, launchEnvironment))
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
  fillLinuxSessionBusAddress(options.env, {
    platform: options.platform,
    ...(options.uid === undefined ? {} : { uid: options.uid }),
    exists: (path) => options.exists?.(path) === true,
  })
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
/** The names a result writes; each is reset to its launch value before a result is applied. */
const APPLIED_ENV_NAMES = [...FILLED_ENV_NAMES, ...REPLACED_ENV_NAMES, ...LOCALE_ENV_NAMES] as const
const BASE_ENV_NAMES = ['PATH', 'Path', 'path', ...APPLIED_ENV_NAMES] as const

/** Where a result came from: this process's probe, or a cache another launch or process wrote. */
export type ShellEnvironmentResultSource = 'probe' | 'cache'

/** Probes the login shell from the launch environment, never from one a cache already changed. */
async function probePosixEnvironment(
  options: DesktopShellEnvironmentOptions,
  runner: ShellEnvironmentCommandRunner,
  launchEnvironment: Readonly<MutableEnvironment>,
): Promise<ResolvedShellEnvironment> {
  const environment = await readPreferredLoginShellEnvironment(options, runner, launchEnvironment)
  const launchctlPath =
    options.platform === 'darwin' && !environment.PATH ? await readLaunchctlPath(runner) : undefined
  return { environment, ...(launchctlPath === undefined ? {} : { launchctlPath }) }
}

function restoreBaseEnvironment(options: DesktopShellEnvironmentOptions, base: MutableEnvironment) {
  for (const name of APPLIED_ENV_NAMES) {
    const value = base[name]
    if (value === undefined) Reflect.deleteProperty(options.env, name)
    else options.env[name] = value
  }
}

/**
 * Applies a result over the environment this process started with (`base`), so a later result
 * (the refresh after a cached one) replaces the earlier one instead of stacking on it: a name the
 * refresh no longer reports goes back to its launch value. A cached result never replaces a
 * desktop-session name the launch has (`DBUS_SESSION_BUS_ADDRESS`, `XDG_SESSION_TYPE`, ...): those
 * describe this login session, and an earlier launch's value may belong to another one.
 */
function applyPosixEnvironment(
  options: DesktopShellEnvironmentOptions,
  base: MutableEnvironment,
  resolved: ResolvedShellEnvironment,
  source: ShellEnvironmentResultSource,
) {
  restoreBaseEnvironment(options, base)
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
    if (source === 'cache' && trimNonEmpty(base[name])) continue
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
    const posix = preparePosixShellEnvironment(options)
    posix.apply(await posix.probe(), 'probe')
  }
}

/** A probe that found neither a PATH nor launchd's: nothing worth applying or caching. */
export function resolvedNothing(resolved: ResolvedShellEnvironment) {
  return !trimNonEmpty(resolved.environment.PATH) && !resolved.launchctlPath
}

/** One POSIX hydration of `options.env`: whose shell it is, and its probe and results. */
export interface PosixShellEnvironment {
  /** Whose login shell this is (null without a shell or HOME): a cache entry is per key. */
  readonly key: ShellEnvironmentCacheKey | null
  /** Applies a result over the launch environment, replacing the previous result. */
  readonly apply: (resolved: ResolvedShellEnvironment, source: ShellEnvironmentResultSource) => void
  /** Probes the login shell from the launch environment, whatever `apply` has done since. */
  readonly probe: () => Promise<ResolvedShellEnvironment>
  /**
   * A probe result without the PATH entries only this launch had, for every later launch; an
   * entry the `previous` cached result already had is kept.
   */
  readonly cacheable: (
    resolved: ResolvedShellEnvironment,
    previous: ResolvedShellEnvironment | null,
  ) => ResolvedShellEnvironment
}

/** Snapshots the launch environment; call it before any result is applied. */
export function preparePosixShellEnvironment(
  options: DesktopShellEnvironmentOptions,
): PosixShellEnvironment {
  const runner = options.runCommand ?? runBoundedShellEnvironmentCommand
  const base = snapshotBase(options.env)
  // The probe runs in the launch environment: a login shell keeps the PATH it inherits.
  const launchEnvironment = { ...options.env }
  const shell = loginShellCandidates(options)[0]
  const home = trimNonEmpty(options.env.HOME)
  return {
    key: shell && home ? { platform: options.platform, shell, home } : null,
    apply: (resolved, source) => applyPosixEnvironment(options, base, resolved, source),
    probe: () => probePosixEnvironment(options, runner, launchEnvironment),
    cacheable: (resolved, previous) =>
      withoutLaunchOnlyPath(options.platform, resolved, launchEnvironment, previous),
  }
}
