/**
 * Launches the desktop app's Session Host from the boot shim, before the main bundle loads
 * (v1 performance plan, W11). The GUI's own Host launch waits until that bundle is read, compiled
 * and evaluated and Electron is ready, about 350-500 ms into a cold start, and the Host then needs
 * as long again to listen; started here, the Host's startup overlaps the GUI's instead of following
 * it. The GUI's Host startup takes the launched process (`session-host-prelaunch-handoff.ts`) and
 * waits for it rather than launching another.
 *
 * Only a start that would launch a Host anyway does it: a desktop-app launch whose profile has no
 * Host socket (macOS, Linux) or Host pipe (Windows), and no legacy store that the GUI must first
 * move under its single-instance lock. Anything else (a socket left by a running or crashed Host,
 * a running Host's pipe, an update hand-off) keeps the GUI's usual path. A Host launched for
 * nothing, such as for a second window that quits, stops itself after its orphan grace period.
 *
 * Windows. The Host names its pipe after a capability it rotates at every start and publishes in
 * `endpoint.capability` (`local-session-paths.ts`), so a running Host is found by the pipe that
 * file names, asked of the kernel without connecting to it (`windowsPipeExists`). The Host starts
 * with `CreateProcessW` (`windows-headless-process.ts`): libuv would let it inherit this process's
 * handles. The GUI reads each endpoint the Host publishes until it answers.
 *
 * Like the rest of the shim it imports no OpenWaggle runtime: everything here is compiled on every
 * launch before the compile cache exists.
 */
import type { ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { type DetachedProcessLaunch, spawnDetachedProcess } from '../detached-process'
import { buildNpmCompatiblePath } from '../environment-paths'
import type { BootEnvironment } from './boot-environment'
import { fillLinuxSessionBusAddress } from '../linux-session-bus-environment'
import { legacyDatabaseFileStateSync } from '../session-host/legacy-database-file'
import {
  legacySessionDatabasePath,
  sessionHostDatabasePath,
  unixSessionHostEndpoint,
  WINDOWS_ENDPOINT_CAPABILITY_PATTERN,
  windowsEndpointCapabilityPath,
  windowsSessionHostPipe,
} from '../session-host/local-session-host-layout'
import {
  type SessionHostLaunchSwitches,
  type SessionHostLogLevel,
  sessionHostChildEnvironmentFrom,
  sessionHostLaunchCommandFor,
  sessionHostSafeEnvironment,
  startupTimingsRequestedBy,
} from '../session-host/session-host-launch-command'
import {
  recordSessionHostPrelaunch,
  type SessionHostPrelaunch,
} from '../session-host/session-host-prelaunch-handoff'
import {
  startWindowsHeadlessProcess,
  WINDOWS_CHILD_REQUIRED_VARIABLES,
  type WindowsHeadlessLaunchInput,
  type WindowsHeadlessProcess,
  windowsPipeExists,
  windowsProcessKernel,
} from '../windows-headless-process'

export type SessionHostPrelaunchSkipReason =
  | 'not-desktop-app'
  | 'relative-profile'
  | 'host-socket-present'
  | 'host-pipe-present'
  | 'legacy-store-to-move'

export type SessionHostPrelaunchDecision =
  | { readonly kind: 'launch' }
  | { readonly kind: 'skip'; readonly reason: SessionHostPrelaunchSkipReason }

export interface SessionHostPrelaunchDecisionInput {
  readonly platform: NodeJS.Platform
  readonly desktopApp: boolean
  readonly userDataRoot: string
  /** The Host temp directory, where a profile whose socket path is too long has its socket. */
  readonly temporaryRoot: () => string
  readonly pathExists: (target: string) => boolean
  /**
   * Whether a legacy database holds a store to move, judged as the Host's cutover judges it
   * (`legacyDatabaseFileState`): an empty file holds nothing (#357), unless its `-wal` has frames.
   */
  readonly legacyStorePresent: (databasePath: string) => boolean
  /** Windows: whether a Host's pipe exists for this profile (`windowsHostPipePresent`). */
  readonly windowsHostPresent: (userDataRoot: string) => boolean
}

function skip(reason: SessionHostPrelaunchSkipReason) {
  const decision: SessionHostPrelaunchDecision = { kind: 'skip', reason }
  return decision
}

export function sessionHostPrelaunchDecision(input: SessionHostPrelaunchDecisionInput) {
  if (!input.desktopApp) return skip('not-desktop-app')
  if (!path.isAbsolute(input.userDataRoot)) return skip('relative-profile')
  if (input.platform === 'win32') {
    // A running Host, or one handing over to an update; a crashed Host's pipe is gone.
    if (input.windowsHostPresent(input.userDataRoot)) return skip('host-pipe-present')
  } else {
    const { endpoint } = unixSessionHostEndpoint(input.userDataRoot, input.temporaryRoot)
    // A running Host, a Host handing over to an update, or a crashed Host's stale socket.
    if (input.pathExists(endpoint)) return skip('host-socket-present')
  }
  // The GUI moves a legacy store under its single-instance lock before any Host starts.
  if (
    !input.pathExists(sessionHostDatabasePath(input.userDataRoot)) &&
    input.legacyStorePresent(legacySessionDatabasePath(input.userDataRoot))
  ) {
    const decision: SessionHostPrelaunchDecision = skip('legacy-store-to-move')
    return decision
  }
  const decision: SessionHostPrelaunchDecision = { kind: 'launch' }
  return decision
}

/** The app identity and paths the prelaunch reads (`AppLifecycle`, `AppPaths`); paths work before `ready`. */
export interface SessionHostPrelaunchApp {
  readonly isPackaged: boolean
  readonly getAppPath: () => string
  readonly getPath: (name: 'userData') => string
  readonly commandLine: SessionHostLaunchSwitches
}

export interface SessionHostPrelaunchInput {
  readonly app: SessionHostPrelaunchApp
  readonly desktopApp: boolean
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly platform: NodeJS.Platform
  readonly executablePath: string
  readonly homeDirectory: string
  readonly temporaryDirectory: () => string
  /** This user's id, for the Linux session bus under `/run/user/<uid>`. */
  readonly uid?: number
  readonly now?: () => number
  readonly pathExists?: (target: string) => boolean
  readonly legacyStorePresent?: (databasePath: string) => boolean
  readonly spawn?: (launch: DetachedProcessLaunch) => ChildProcess
  /** Windows: starts the Host without handing it this process's handles. */
  readonly startWindows?: (launch: WindowsHeadlessLaunchInput) => WindowsHeadlessProcess
  readonly windowsHostPresent?: (userDataRoot: string) => boolean
  readonly record?: (prelaunch: SessionHostPrelaunch) => void
}

const LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error'])
const TEMPORARY_DIRECTORY_VARIABLES = ['TMPDIR', 'TMP', 'TEMP'] as const

function isLogLevel(value: string | undefined): value is SessionHostLogLevel {
  return value !== undefined && LOG_LEVELS.has(value)
}

/** The launch environment's variables this start reads. */
function launchEnvironment(input: SessionHostPrelaunchInput) {
  const result: BootEnvironment = input.environment
  return result
}

function legacyStorePresent(databasePath: string) {
  // An unreadable file throws, and the start then leaves the Host to the GUI's usual path.
  return legacyDatabaseFileStateSync(databasePath) === 'present'
}

/**
 * The environment the GUI's own launch would give the Host (`sessionHostChildEnvironment`). The
 * main bundle has not yet moved TMPDIR back to the Host temp directory (`restoreHostTemporary
 * Directory`) or set Pi's package directory, so the first is done here and the second is the
 * user's own value, which is what the GUI passes on too.
 */
function prelaunchEnvironment(input: SessionHostPrelaunchInput, userDataRoot: string) {
  const environment: Record<string, string | undefined> = { ...input.environment }
  const known: BootEnvironment = environment
  const hostTemporaryDirectory = known.OPENWAGGLE_HOST_TMPDIR
  if (hostTemporaryDirectory) {
    for (const name of TEMPORARY_DIRECTORY_VARIABLES) environment[name] = hostTemporaryDirectory
  }
  // Before Electron is ready in the Host, whose secret store reaches the session bus through it.
  fillLinuxSessionBusAddress(environment, {
    platform: input.platform,
    ...(input.uid === undefined ? {} : { uid: input.uid }),
    exists: input.pathExists ?? existsSync,
  })
  const logLevel = known.OPENWAGGLE_LOG_LEVEL
  return sessionHostChildEnvironmentFrom({
    safeEnvironment: sessionHostSafeEnvironment(
      environment,
      buildNpmCompatiblePath(known.PATH, input.platform, input.homeDirectory),
    ),
    userDataRoot,
    ...(isLogLevel(logLevel) ? { logLevel } : {}),
    startupTimings: startupTimingsRequestedBy({
      environment,
      commandLine: input.app.commandLine,
    }),
    // The desktop app this shim starts probes the login shell and caches it from now on.
    shellEnvironmentRefreshedSince: (input.now ?? Date.now)(),
  })
}

/**
 * Whether the pipe `endpoint.capability` names exists. A missing or malformed file means no Host
 * has published an endpoint, so none runs.
 */
export function windowsHostPipePresent(
  userDataRoot: string,
  pipeExists: (pipe: string) => boolean = (pipe) => windowsPipeExists(windowsProcessKernel(), pipe),
) {
  let capability: string
  try {
    capability = readFileSync(windowsEndpointCapabilityPath(userDataRoot), 'utf8').trim()
  } catch {
    return false
  }
  if (!WINDOWS_ENDPOINT_CAPABILITY_PATTERN.test(capability)) return false
  return pipeExists(windowsSessionHostPipe(capability))
}

function startWindowsHost(launch: WindowsHeadlessLaunchInput) {
  return startWindowsHeadlessProcess(windowsProcessKernel(), launch)
}

const WINDOWS_EXIT_POLL_MS = 1_000

function trackWindowsHost(started: WindowsHeadlessProcess, userDataRoot: string) {
  const { promise, resolve } = Promise.withResolvers<void>()
  const hasEnded = () => {
    if (!started.hasExited()) return false
    resolve()
    return true
  }
  const poll = setInterval(() => {
    if (hasEnded()) clearInterval(poll)
  }, WINDOWS_EXIT_POLL_MS)
  poll.unref()
  return { userDataRoot, ended: promise, hasEnded } satisfies SessionHostPrelaunch
}

function inheritedWindowsVariables(environment: Readonly<Record<string, string | undefined>>) {
  const inherited: Record<string, string | undefined> = {}
  for (const name of WINDOWS_CHILD_REQUIRED_VARIABLES) inherited[name] = environment[name]
  return inherited
}

function trackLaunchedHost(child: ChildProcess, userDataRoot: string) {
  let ended = false
  const { promise, resolve } = Promise.withResolvers<void>()
  const end = () => {
    ended = true
    resolve()
  }
  child.once('spawn', () => child.unref())
  child.once('error', end)
  child.once('exit', end)
  const prelaunch: SessionHostPrelaunch = { userDataRoot, ended: promise, hasEnded: () => ended }
  return prelaunch
}

/**
 * Launches the Session Host now when this start would launch one anyway, and records it for the
 * GUI. Never throws: the GUI's usual Host start covers every case this one leaves out or fails.
 */
export function startSessionHostPrelaunch(input: SessionHostPrelaunchInput) {
  try {
    const userDataRoot =
      launchEnvironment(input).OPENWAGGLE_USER_DATA_DIR || input.app.getPath('userData')
    const decision = sessionHostPrelaunchDecision({
      platform: input.platform,
      desktopApp: input.desktopApp,
      userDataRoot,
      // The Host temp directory (`hostTemporaryDirectory`), which the main bundle reads the same way.
      temporaryRoot: () =>
        launchEnvironment(input).OPENWAGGLE_HOST_TMPDIR || input.temporaryDirectory(),
      pathExists: input.pathExists ?? existsSync,
      legacyStorePresent: input.legacyStorePresent ?? legacyStorePresent,
      windowsHostPresent: input.windowsHostPresent ?? ((root) => windowsHostPipePresent(root)),
    })
    if (decision.kind !== 'launch') {
      const result: SessionHostPrelaunchDecision | null = decision
      return result
    }
    const command = sessionHostLaunchCommandFor({
      platform: input.platform,
      executablePath: input.executablePath,
      appPath: input.app.getAppPath(),
      commandLine: input.app.commandLine,
    })
    const environment = prelaunchEnvironment(input, userDataRoot)
    const record = input.record ?? recordSessionHostPrelaunch
    if (input.platform === 'win32') {
      const started = (input.startWindows ?? startWindowsHost)({
        ...command,
        environment,
        inherited: inheritedWindowsVariables(input.environment),
      })
      record(trackWindowsHost(started, userDataRoot))
      return decision
    }
    const child = (input.spawn ?? spawnDetachedProcess)({ ...command, environment })
    record(trackLaunchedHost(child, userDataRoot))
    return decision
  } catch {
    return null
  }
}
