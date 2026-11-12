import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'
import { applyPreparedEnvironment, type PreparedEnvironment } from './domain/prepared-environment'
import {
  buildNpmCompatiblePath,
  readEnvironmentValue,
  setEnvironmentValue,
  shouldExcludeInteractiveTerminalEnvKey,
  stripAppImageRuntimeEnv,
} from './environment-paths'
import {
  type LiveEnv,
  liveEnvSchema,
  SOURCE_CONTROL_CLI_STRIPPED_VARIABLES,
} from './env-live-schema'
import { fillLinuxSessionBusAddress } from './linux-session-bus-environment'
import {
  applyPiPackageDirectoryTo,
  withShellPiPackageDirectory,
} from './pi-package-directory-environment'
import {
  SHELL_ENVIRONMENT_REFRESHED_SINCE_VARIABLE,
  sessionHostSafeEnvironment,
} from './session-host/session-host-launch-command'

const optionalUrlSchema = Schema.optional(
  Schema.String.pipe(
    Schema.filter((value) => {
      try {
        new URL(value) // Throws unless the value is a valid URL.
        return true
      } catch {
        return 'Must be a valid URL.'
      }
    }),
  ),
)

const envSchema = Schema.Struct({
  PATH: Schema.optional(Schema.String),
  APPIMAGE: Schema.optional(Schema.String),
  ELECTRON_RENDERER_URL: optionalUrlSchema,
  OPENWAGGLE_AUTOMATION: Schema.optional(Schema.Literal('1')),
  OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS: Schema.optional(Schema.Literal('1')),
  OPENWAGGLE_AUTOMATION_PI_EXTENSIONS: Schema.optional(Schema.String), // Hidden QA Pi fixtures
  OPENWAGGLE_AUTOMATION_LEASE_TOKEN: Schema.optional(Schema.String),
  OPENWAGGLE_AUTOMATION_PROJECT_PATH: Schema.optional(Schema.String),
  OPENWAGGLE_USER_DATA_DIR: Schema.optional(Schema.String),
  OPENWAGGLE_DISABLE_SINGLE_INSTANCE: Schema.optional(Schema.String),
  OPENWAGGLE_LOG_LEVEL: Schema.optional(Schema.Literal('debug', 'info', 'warn', 'error')),
  OPENWAGGLE_CLI_OUTPUT_FD: Schema.optional(Schema.String),
  OPENWAGGLE_PROFILE: Schema.optional(Schema.String),
  OPENWAGGLE_PROFILE_CREDENTIAL_FILE: Schema.optional(Schema.String),
  OPENWAGGLE_AGENT_RUN: Schema.optional(Schema.Literal('1')),
  /** The Host's own temp directory, preserved in agent tool processes whose TMPDIR is a scratch dir. */
  OPENWAGGLE_HOST_TMPDIR: Schema.optional(Schema.String),
  /** Usage statistics opt-outs (ADR 0046), interpreted by `resolveUsageStatisticsEnablement`. */
  DO_NOT_TRACK: Schema.optional(Schema.String),
  PI_TELEMETRY: Schema.optional(Schema.String),
  CI: Schema.optional(Schema.String),
  SystemRoot: Schema.optional(Schema.String),
  TEMP: Schema.optional(Schema.String),
  TMP: Schema.optional(Schema.String),
  USERPROFILE: Schema.optional(Schema.String),
  LOCALAPPDATA: Schema.optional(Schema.String),
})

export type Env = SchemaType<typeof envSchema>

export type { LiveEnv }

/**
 * The live process environment, decoded now (unlike the startup {@link env} snapshot):
 * desktop-shell hydration and `withTemporaryProcessEnv` change `process.env` while the app runs.
 */
export function readLiveEnv(): LiveEnv {
  return decodeUnknownOrThrow(liveEnvSchema, process.env)
}

export const env: Env = decodeUnknownOrThrow(envSchema, process.env)

export const logLevel = env.OPENWAGGLE_LOG_LEVEL ?? 'info'

const TEMPORARY_DIRECTORY_VARIABLES = ['TMPDIR', 'TMP', 'TEMP'] as const

/**
 * An OpenWaggle process started from an agent's shell tool (the `openwaggle` CLI, or `bun run dev`)
 * inherits that Session's scratch directory as TMPDIR, TMP, and TEMP. Its own temp files belong in
 * the Host temp directory the agent environment keeps in OPENWAGGLE_HOST_TMPDIR, or archiving the
 * Session would delete them under the running process.
 */
export function restoreHostTemporaryDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  hostTemporaryDirectory = env.OPENWAGGLE_HOST_TMPDIR,
) {
  if (!hostTemporaryDirectory) return
  for (const name of TEMPORARY_DIRECTORY_VARIABLES) environment[name] = hostTemporaryDirectory
}

/** Unlike the startup snapshot above, PATH can change after desktop-shell hydration. */
export function getCurrentProcessPath(): string | undefined {
  return readLiveEnv().PATH
}

const livePiEnvSchema = Schema.Struct({
  PI_CODING_AGENT_SESSION_DIR: Schema.optional(Schema.String),
})

/** Pi's session directory override, read live like PATH: Pi reads it when it opens a session. */
export const getPiSessionDirectoryOverride = (): string | undefined =>
  decodeUnknownOrThrow(livePiEnvSchema, process.env).PI_CODING_AGENT_SESSION_DIR

const TERMINAL_PROGRAM_NAME = 'OpenWaggle'
const TERMINAL_TYPE = 'xterm-256color'
const TERMINAL_COLOR_TYPE = 'truecolor'

let temporaryProcessEnvQueue: Promise<void> = Promise.resolve()

/**
 * This process's own environment, which `desktop-shell-environment-process` hydrates in place
 * from the login shell.
 */
export function liveProcessEnvironment(): NodeJS.ProcessEnv {
  return process.env
}

/** The launching app's login-shell refresh time, removed so no child of this Host inherits it. */
export function takeShellEnvironmentRefreshedSince(): number | undefined {
  const since = Number(process.env[SHELL_ENVIRONMENT_REFRESHED_SINCE_VARIABLE])
  Reflect.deleteProperty(process.env, SHELL_ENVIRONMENT_REFRESHED_SINCE_VARIABLE)
  return Number.isSafeInteger(since) && since > 0 ? since : undefined
}

/** Fills a missing Linux session bus address in this process before Electron is ready. */
export const installLinuxSessionBusEnvironment = () =>
  fillLinuxSessionBusAddress(process.env, {
    platform: process.platform,
    ...(process.getuid ? { uid: process.getuid() } : {}),
    exists: existsSync,
  })

/** Points bundled Pi at its installed package (see `pi-package-directory-environment.ts`). */
export const applyPiPackageDirectory = (directory?: string) =>
  applyPiPackageDirectoryTo(directory, process.env)

/** Safe environment for child processes: essential variables only, so no API key or other
 * secret of the parent process leaks. */
export function getSafeChildEnv(): Record<string, string | undefined> {
  const live = readLiveEnv()
  return {
    PATH: getNpmCompatiblePath(),
    HOME: live.HOME,
    SHELL: live.SHELL,
    TERM: live.TERM,
    LANG: live.LANG,
    USER: live.USER,
    TMPDIR: live.TMPDIR,
  }
}

/** Minimum environment required by the built-in Windows PowerShell security helper. */
export function getWindowsSecurityChildEnv(): Record<string, string | undefined> {
  const live = readLiveEnv()
  return {
    PATH: getNpmCompatiblePath(),
    SystemRoot: live.SystemRoot,
    TEMP: live.TEMP,
    TMP: live.TMP,
    USERPROFILE: live.USERPROFILE,
  }
}

/** The environment a detached Session Host starts with (see `sessionHostSafeEnvironment`). */
export function getSessionHostChildEnv(): Record<string, string | undefined> {
  return sessionHostSafeEnvironment(
    withShellPiPackageDirectory(process.env),
    getNpmCompatiblePath(),
  )
}

/**
 * Minimal environment for OS credential helpers used by browser-cookie import.
 * Linux Secret Service needs the session bus/display variables; Windows
 * PowerShell needs the Windows root/temp variables. No unrelated secrets pass
 * through to either subprocess.
 */
export function getBrowserCredentialChildEnv(): Record<string, string | undefined> {
  const live = readLiveEnv()
  return {
    ...getSafeChildEnv(),
    DBUS_SESSION_BUS_ADDRESS: live.DBUS_SESSION_BUS_ADDRESS,
    DISPLAY: live.DISPLAY,
    LC_ALL: live.LC_ALL,
    SystemRoot: live.SystemRoot,
    TEMP: live.TEMP,
    TMP: live.TMP,
    USERNAME: live.USERNAME,
    WAYLAND_DISPLAY: live.WAYLAND_DISPLAY,
    WINDIR: live.WINDIR,
    XDG_RUNTIME_DIR: live.XDG_RUNTIME_DIR,
  }
}

/** Windows profile roots used only for installed-browser discovery. */
export function getBrowserImportPathEnv(): {
  readonly appData?: string
  readonly localAppData?: string
} {
  const live = readLiveEnv()
  const appData = live.APPDATA?.trim()
  const localAppData = live.LOCALAPPDATA?.trim()
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
  overrides: PreparedEnvironment = {},
): Record<string, string> {
  const inherited: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || shouldExcludeInteractiveTerminalEnvKey(key)) continue
    inherited[key] = value
  }

  const terminalEnv = stripAppImageRuntimeEnv(withShellPiPackageDirectory(inherited))
  setEnvironmentValue(
    terminalEnv,
    'PATH',
    buildNpmCompatiblePath(readEnvironmentValue(terminalEnv, 'PATH'), process.platform, homedir()),
  )
  setEnvironmentValue(terminalEnv, 'TERM', TERMINAL_TYPE)
  setEnvironmentValue(terminalEnv, 'COLORTERM', TERMINAL_COLOR_TYPE)
  setEnvironmentValue(terminalEnv, 'TERM_PROGRAM', TERMINAL_PROGRAM_NAME)
  setEnvironmentValue(terminalEnv, 'TERM_PROGRAM_VERSION', appVersion)
  const allowed = Object.fromEntries(
    Object.entries(overrides).filter(
      ([name]) => !['T3CODE_PROJECT_ROOT', 'T3CODE_WORKTREE_PATH'].includes(name.toUpperCase()),
    ),
  )
  return applyPreparedEnvironment(terminalEnv, allowed, process.platform === 'win32')
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
  for (const name of SOURCE_CONTROL_CLI_STRIPPED_VARIABLES) delete env[name]
  return env
}

/** Named environment values for modules that may not read `process.env` themselves. */
export function readEnvironmentVariables<N extends string>(names: readonly N[]) {
  const values: Partial<Record<N, string>> = {}
  for (const name of names) if (process.env[name]) values[name] = process.env[name]
  return values
}

/**
 * The current environment plus explicit overrides, for child git invocations that need extra
 * variables (e.g. `GIT_INDEX_FILE`) while still inheriting PATH/HOME. Only `env.ts` reads it.
 */
export function getEnvWithOverrides(
  overrides: Readonly<Record<string, string>>,
): Record<string, string | undefined> {
  return { ...withShellPiPackageDirectory(process.env), ...overrides }
}

export function getNpmCompatiblePath(): string {
  return buildNpmCompatiblePath(readLiveEnv().PATH, process.platform, homedir())
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
