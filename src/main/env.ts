import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'
import { installDesktopShellEnvironment as hydrateDesktopShellEnvironment } from './desktop-shell-environment'
import {
  buildNpmCompatiblePath,
  readEnvironmentValue,
  setEnvironmentValue,
  shouldExcludeInteractiveTerminalEnvKey,
  stripAppImageRuntimeEnv,
} from './environment-paths'

const optionalUrlSchema = Schema.optional(
  Schema.String.pipe(
    Schema.filter((value) => {
      try {
        // URL constructor normalizes and validates the shape for us.
        new URL(value)
        return true
      } catch {
        return 'Must be a valid URL.'
      }
    }),
  ),
)

const envSchema = Schema.Struct({
  ELECTRON_RENDERER_URL: optionalUrlSchema,
  OPENWAGGLE_AUTOMATION: Schema.optional(Schema.Literal('1')),
  OPENWAGGLE_AUTOMATION_LEASE_TOKEN: Schema.optional(Schema.String),
  OPENWAGGLE_AUTOMATION_PROJECT_PATH: Schema.optional(Schema.String),
  OPENWAGGLE_USER_DATA_DIR: Schema.optional(Schema.String),
  OPENWAGGLE_DISABLE_SINGLE_INSTANCE: Schema.optional(Schema.String),
  OPENWAGGLE_LOG_LEVEL: Schema.optional(Schema.Literal('debug', 'info', 'warn', 'error')),
})

export type Env = SchemaType<typeof envSchema>

export const env: Env = decodeUnknownOrThrow(envSchema, process.env)

export const logLevel = env.OPENWAGGLE_LOG_LEVEL ?? 'info'

const TERMINAL_PROGRAM_NAME = 'OpenWaggle'
const TERMINAL_TYPE = 'xterm-256color'
const TERMINAL_COLOR_TYPE = 'truecolor'

let temporaryProcessEnvQueue: Promise<void> = Promise.resolve()
let desktopShellEnvironmentPromise: Promise<void> | null = null

function userLoginShell() {
  if (process.platform === 'win32') return undefined
  try {
    return userInfo().shell || undefined
  } catch {
    return undefined
  }
}

/** Hydrate GUI-launch gaps once before terminal/runtime services start. */
export function installDesktopShellEnvironment(): Promise<void> {
  desktopShellEnvironmentPromise ??= hydrateDesktopShellEnvironment({
    env: process.env,
    platform: process.platform,
    userShell: userLoginShell(),
    uid: process.getuid?.(),
    exists: existsSync,
  })
  return desktopShellEnvironmentPromise
}

/**
 * Safe environment for child processes.
 * Only passes through essential variables — prevents leaking API keys,
 * secrets, or other sensitive values from the parent process.
 */
export function getSafeChildEnv(): Record<string, string | undefined> {
  return {
    PATH: getNpmCompatiblePath(),
    HOME: process.env.HOME,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
    LANG: process.env.LANG,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR,
  }
}

/**
 * Minimal environment for OS credential helpers used by browser-cookie import.
 * Linux Secret Service needs the session bus/display variables; Windows
 * PowerShell needs the Windows root/temp variables. No unrelated secrets pass
 * through to either subprocess.
 */
export function getBrowserCredentialChildEnv(): Record<string, string | undefined> {
  return {
    ...getSafeChildEnv(),
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    DISPLAY: process.env.DISPLAY,
    LC_ALL: process.env.LC_ALL,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERNAME: process.env.USERNAME,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
    WINDIR: process.env.WINDIR,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  }
}

/** Windows profile roots used only for installed-browser discovery. */
export function getBrowserImportPathEnv(): {
  readonly appData?: string
  readonly localAppData?: string
} {
  const appData = process.env.APPDATA?.trim()
  const localAppData = process.env.LOCALAPPDATA?.trim()
  return {
    ...(appData ? { appData } : {}),
    ...(localAppData ? { localAppData } : {}),
  }
}

/**
 * Full user environment for an interactive terminal.
 *
 * Unlike ordinary app subprocesses, a terminal is the user's command authority:
 * shell integrations, agents, display servers, proxies, locales, and toolchains
 * must remain available. Only app-control variables and known Node/Electron code
 * injection controls are removed. A new snapshot is built for every terminal
 * spawn so environment changes made while OpenWaggle is running are observed.
 */
export function getInteractiveTerminalEnv(
  appVersion: string,
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const inherited: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || shouldExcludeInteractiveTerminalEnvKey(key)) continue
    inherited[key] = value
  }

  const terminalEnv = stripAppImageRuntimeEnv(inherited)
  setEnvironmentValue(
    terminalEnv,
    'PATH',
    buildNpmCompatiblePath(readEnvironmentValue(terminalEnv, 'PATH'), process.platform, homedir()),
  )
  setEnvironmentValue(terminalEnv, 'TERM', TERMINAL_TYPE)
  setEnvironmentValue(terminalEnv, 'COLORTERM', TERMINAL_COLOR_TYPE)
  setEnvironmentValue(terminalEnv, 'TERM_PROGRAM', TERMINAL_PROGRAM_NAME)
  setEnvironmentValue(terminalEnv, 'TERM_PROGRAM_VERSION', appVersion)
  for (const [name, value] of Object.entries(overrides)) {
    setEnvironmentValue(terminalEnv, name, value)
  }
  return terminalEnv
}

/**
 * Environment for source-control CLI calls.
 * Strips provider token variables so gh/glab use their keyring-stored credentials for the exact
 * host selected by the validated Git remote. Inherited tokens from CI or developer tooling can
 * silently select a different identity or be disclosed to an attacker-controlled custom host.
 */
export function getSourceControlCliEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: getNpmCompatiblePath(),
  }
  delete env.GITHUB_TOKEN
  delete env.GH_TOKEN
  delete env.GITHUB_ENTERPRISE_TOKEN
  delete env.GH_ENTERPRISE_TOKEN
  delete env.GITLAB_TOKEN
  delete env.GITLAB_ACCESS_TOKEN
  delete env.GITLAB_PRIVATE_TOKEN
  delete env.OAUTH_TOKEN
  delete env.CI_JOB_TOKEN
  // Repository/host selection is supplied explicitly on every gh/glab invocation. Ambient
  // overrides would otherwise be able to retarget a command despite the validated Git remote.
  delete env.GH_REPO
  delete env.GH_HOST
  delete env.GITLAB_REPO
  delete env.GITLAB_HOST
  delete env.GITLAB_API_HOST
  delete env.GITLAB_SSH_HOST
  delete env.GITLAB_HEAD_REPO
  delete env.GITLAB_URI
  delete env.GITLAB_URL
  delete env.GLAB_REPO
  delete env.GLAB_HOST
  return env
}

/**
 * The current environment plus explicit overrides, for child git invocations that
 * need extra variables (e.g. `GIT_INDEX_FILE` for a scratch index) while still
 * inheriting PATH/HOME. `env.ts` is the only module allowed to read process.env.
 */
export function getEnvWithOverrides(
  overrides: Readonly<Record<string, string>>,
): Record<string, string | undefined> {
  return { ...process.env, ...overrides }
}

export function getNpmCompatiblePath(): string {
  return buildNpmCompatiblePath(process.env.PATH, process.platform, homedir())
}

export async function withNpmCompatibleProcessEnv<T>(operation: () => Promise<T>): Promise<T> {
  return withTemporaryProcessEnv({ PATH: getNpmCompatiblePath() }, operation)
}

export async function withTemporaryProcessEnv<T>(
  overrides: Readonly<Record<string, string>>,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireTemporaryProcessEnvLock()
  const previousValues = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key])
    process.env[key] = value
  }

  try {
    return await operation()
  } finally {
    for (const [key, previousValue] of previousValues) {
      if (previousValue === undefined) {
        delete process.env[key]
        continue
      }
      process.env[key] = previousValue
    }
    release()
  }
}

async function acquireTemporaryProcessEnvLock() {
  const previous = temporaryProcessEnvQueue
  let releaseCurrent: (() => void) | undefined
  temporaryProcessEnvQueue = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  await previous
  return () => releaseCurrent?.()
}
