/**
 * How a detached Session Host is started: its command, switches and environment. Kept free of
 * OpenWaggle runtime imports (no `env.ts`, logger or Effect), because the boot shim launches the
 * GUI's Host from it before the main bundle loads (src/main/boot/session-host-prelaunch.ts), and
 * everything the shim imports is compiled on every launch. The launcher re-exports it.
 */
import path from 'node:path'

/** The internal argument that turns an OpenWaggle process into the detached Session Host. */
export const SESSION_HOST_INTERNAL_COMMAND = 'session-host-internal'

/** Passed to a Host launched by a GUI that measures its startup, which has no switches. */
export const STARTUP_TIMINGS_ENVIRONMENT_VARIABLE = 'OPENWAGGLE_STARTUP_TIMINGS'
export const STARTUP_TIMINGS_SWITCH = 'openwaggle-startup-timings'

export type SessionHostLogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Passed to a Host launched by the desktop app, which probes the login shell itself and caches
 * the result: the epoch ms from which a cached entry is that refresh. The Host waits for it
 * instead of running a second login shell (`startDesktopShellEnvironment`).
 */
export const SHELL_ENVIRONMENT_REFRESHED_SINCE_VARIABLE =
  'OPENWAGGLE_SHELL_ENVIRONMENT_REFRESHED_SINCE'

export function sessionHostLaunchArguments(input: {
  readonly isPackaged: boolean
  readonly appPath: string
}) {
  return input.isPackaged
    ? [SESSION_HOST_INTERNAL_COMMAND]
    : [input.appPath, SESSION_HOST_INTERNAL_COMMAND]
}

export function sessionHostLaunchCommand(input: {
  readonly platform: NodeJS.Platform
  readonly isPackaged: boolean
  readonly executablePath: string
  readonly appPath: string
  readonly appImagePath?: string
  readonly parentNoSandbox?: boolean
  /** Chromium's --use-mock-keychain on the GUI: QA keeps credential prompts off the screen. */
  readonly parentUseMockKeychain?: boolean
  /** The value of the GUI's --password-store switch, which only Linux Chromium reads. */
  readonly parentPasswordStore?: string
}) {
  // Restricted Linux environments may launch the GUI with this explicit Electron switch.
  // Its detached authority needs the same policy; never disable the sandbox by default.
  // The Host reads and writes credentials too, so it uses the GUI's credential store switches.
  const electronArguments = [
    ...(input.platform === 'linux' && input.parentNoSandbox ? ['--no-sandbox'] : []),
    ...(input.parentUseMockKeychain ? ['--use-mock-keychain'] : []),
    ...(input.platform === 'linux' && input.parentPasswordStore
      ? [`--password-store=${input.parentPasswordStore}`]
      : []),
  ]
  if (
    input.platform === 'linux' &&
    input.isPackaged &&
    input.appImagePath &&
    path.isAbsolute(input.appImagePath)
  ) {
    return {
      command: input.appImagePath,
      args: [...electronArguments, SESSION_HOST_INTERNAL_COMMAND],
    }
  }
  return {
    command: input.executablePath,
    args: [...electronArguments, ...sessionHostLaunchArguments(input)],
  }
}

/** The switches of this Electron process that its Host launch command depends on. */
export interface SessionHostLaunchSwitches {
  readonly hasSwitch: (name: string) => boolean
  readonly getSwitchValue: (name: string) => string
}

/** The command that launches a Host with the switches the launching process was started with. */
export function sessionHostLaunchCommandFor(input: {
  readonly platform: NodeJS.Platform
  readonly isPackaged: boolean
  readonly executablePath: string
  readonly appPath: string
  readonly appImagePath: string | undefined
  readonly commandLine: SessionHostLaunchSwitches
}) {
  const passwordStore = input.commandLine.getSwitchValue('password-store')
  return sessionHostLaunchCommand({
    platform: input.platform,
    isPackaged: input.isPackaged,
    executablePath: input.executablePath,
    appPath: input.appPath,
    parentNoSandbox: input.commandLine.hasSwitch('no-sandbox'),
    parentUseMockKeychain: input.commandLine.hasSwitch('use-mock-keychain'),
    ...(passwordStore ? { parentPasswordStore: passwordStore } : {}),
    ...(input.appImagePath ? { appImagePath: input.appImagePath } : {}),
  })
}

/**
 * Detached Session Hosts are the user's durable Pi runtime and need provider credentials and shell
 * agent state. Strip only client-scoped OpenWaggle credentials and Electron execution switches,
 * which must never become daemon authority.
 */
export function sessionHostSafeEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  npmCompatiblePath: string,
): Record<string, string | undefined> {
  const childEnvironment: Record<string, string | undefined> = {
    ...environment,
    PATH: npmCompatiblePath,
  }
  delete childEnvironment.ELECTRON_RUN_AS_NODE
  delete childEnvironment.OPENWAGGLE_CLI_OUTPUT_FD
  delete childEnvironment.OPENWAGGLE_PROFILE
  delete childEnvironment.OPENWAGGLE_PROFILE_CREDENTIAL_FILE
  delete childEnvironment.OPENWAGGLE_AGENT_RUN
  delete childEnvironment.OPENWAGGLE_AUTOMATION_LEASE_TOKEN
  delete childEnvironment[SHELL_ENVIRONMENT_REFRESHED_SINCE_VARIABLE]
  return childEnvironment
}

/**
 * The detached Host outlives the client that starts it, so it must not retain the client's
 * client-scoped credentials or inherit Electron's Node-compatibility switch. Provider and shell
 * environment must survive because this process owns Pi Runs after the launching client exits.
 */
export function sessionHostChildEnvironmentFrom(input: {
  readonly safeEnvironment: Readonly<Record<string, string | undefined>>
  readonly userDataRoot: string
  readonly logLevel?: SessionHostLogLevel
  /** The launching GUI measures its startup, so the Host marks its own too. */
  readonly startupTimings?: boolean
  /** The launching desktop app refreshes the login-shell cache from this epoch ms on. */
  readonly shellEnvironmentRefreshedSince?: number
}) {
  const refreshedSince = input.shellEnvironmentRefreshedSince
  return {
    ...input.safeEnvironment,
    OPENWAGGLE_USER_DATA_DIR: input.userDataRoot,
    ...(input.logLevel ? { OPENWAGGLE_LOG_LEVEL: input.logLevel } : {}),
    ...(input.startupTimings ? { [STARTUP_TIMINGS_ENVIRONMENT_VARIABLE]: '1' } : {}),
    ...(refreshedSince === undefined
      ? {}
      : { [SHELL_ENVIRONMENT_REFRESHED_SINCE_VARIABLE]: String(refreshedSince) }),
  }
}

/** Whether this process measures its startup: the GUI's switch, or a launching GUI's variable. */
export function startupTimingsRequestedBy(input: {
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly commandLine: Pick<SessionHostLaunchSwitches, 'hasSwitch'>
}) {
  return (
    input.environment[STARTUP_TIMINGS_ENVIRONMENT_VARIABLE] === '1' ||
    input.commandLine.hasSwitch(STARTUP_TIMINGS_SWITCH)
  )
}
