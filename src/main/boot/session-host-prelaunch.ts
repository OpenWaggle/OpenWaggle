/**
 * Launches the desktop app's Session Host from the boot shim, before the main bundle loads
 * (v1 performance plan, W11). The GUI's own Host launch waits until that bundle is read, compiled
 * and evaluated and Electron is ready, about 350-500 ms into a cold start, and the Host then needs
 * as long again to listen; started here, the Host's startup overlaps the GUI's instead of following
 * it. The GUI's Host startup takes the launched process (`session-host-prelaunch-handoff.ts`) and
 * waits for it rather than launching another.
 *
 * Only a start that would launch a Host anyway does it: a desktop-app launch on macOS or Linux
 * whose profile has no Host socket, and no legacy store that the GUI must first move under its
 * single-instance lock. Anything else (a socket left by a running or crashed Host, an update
 * hand-off, Windows named pipes) keeps the GUI's usual path. A Host launched for nothing, such as
 * for a second window that quits, stops itself after its orphan grace period.
 *
 * Like the rest of the shim it imports no OpenWaggle runtime: everything here is compiled on every
 * launch before the compile cache exists.
 */
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { type DetachedProcessLaunch, spawnDetachedProcess } from '../detached-process'
import { buildNpmCompatiblePath } from '../environment-paths'
import { fillLinuxSessionBusAddress } from '../linux-session-bus-environment'
import { legacyDatabaseFileStateSync } from '../session-host/legacy-database-file'
import {
  legacySessionDatabasePath,
  sessionHostDatabasePath,
  unixSessionHostEndpoint,
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

export type SessionHostPrelaunchSkipReason =
  | 'not-desktop-app'
  | 'windows-named-pipe'
  | 'relative-profile'
  | 'host-socket-present'
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
}

function skip(reason: SessionHostPrelaunchSkipReason): SessionHostPrelaunchDecision {
  return { kind: 'skip', reason }
}

export function sessionHostPrelaunchDecision(
  input: SessionHostPrelaunchDecisionInput,
): SessionHostPrelaunchDecision {
  if (!input.desktopApp) return skip('not-desktop-app')
  // The Windows endpoint is a named pipe whose name the Host rotates; the GUI reads it.
  if (input.platform === 'win32') return skip('windows-named-pipe')
  if (!path.isAbsolute(input.userDataRoot)) return skip('relative-profile')
  const { endpoint } = unixSessionHostEndpoint(input.userDataRoot, input.temporaryRoot)
  // A running Host, a Host handing over to an update, or a crashed Host's stale socket.
  if (input.pathExists(endpoint)) return skip('host-socket-present')
  // The GUI moves a legacy store under its single-instance lock before any Host starts.
  if (
    !input.pathExists(sessionHostDatabasePath(input.userDataRoot)) &&
    input.legacyStorePresent(legacySessionDatabasePath(input.userDataRoot))
  ) {
    return skip('legacy-store-to-move')
  }
  return { kind: 'launch' }
}

/** The part of Electron's `app` the prelaunch reads; `getPath` works before `ready`. */
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
  readonly record?: (prelaunch: SessionHostPrelaunch) => void
}

const LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error'])
const TEMPORARY_DIRECTORY_VARIABLES = ['TMPDIR', 'TMP', 'TEMP'] as const

function isLogLevel(value: string | undefined): value is SessionHostLogLevel {
  return value !== undefined && LOG_LEVELS.has(value)
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
  const hostTemporaryDirectory = environment.OPENWAGGLE_HOST_TMPDIR
  if (hostTemporaryDirectory) {
    for (const name of TEMPORARY_DIRECTORY_VARIABLES) environment[name] = hostTemporaryDirectory
  }
  // Before Electron is ready in the Host, whose secret store reaches the session bus through it.
  fillLinuxSessionBusAddress(environment, {
    platform: input.platform,
    ...(input.uid === undefined ? {} : { uid: input.uid }),
    exists: input.pathExists ?? existsSync,
  })
  const logLevel = environment.OPENWAGGLE_LOG_LEVEL
  return sessionHostChildEnvironmentFrom({
    safeEnvironment: sessionHostSafeEnvironment(
      environment,
      buildNpmCompatiblePath(environment.PATH, input.platform, input.homeDirectory),
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

function trackLaunchedHost(child: ChildProcess, userDataRoot: string): SessionHostPrelaunch {
  let ended = false
  const { promise, resolve } = Promise.withResolvers<void>()
  const end = () => {
    ended = true
    resolve()
  }
  child.once('spawn', () => child.unref())
  child.once('error', end)
  child.once('exit', end)
  return { userDataRoot, ended: promise, hasEnded: () => ended }
}

/**
 * Launches the Session Host now when this start would launch one anyway, and records it for the
 * GUI. Never throws: the GUI's usual Host start covers every case this one leaves out or fails.
 */
export function startSessionHostPrelaunch(
  input: SessionHostPrelaunchInput,
): SessionHostPrelaunchDecision | null {
  try {
    const userDataRoot = input.environment.OPENWAGGLE_USER_DATA_DIR || input.app.getPath('userData')
    const decision = sessionHostPrelaunchDecision({
      platform: input.platform,
      desktopApp: input.desktopApp,
      userDataRoot,
      // The Host temp directory (`hostTemporaryDirectory`), which the main bundle reads the same way.
      temporaryRoot: () => input.environment.OPENWAGGLE_HOST_TMPDIR || input.temporaryDirectory(),
      pathExists: input.pathExists ?? existsSync,
      legacyStorePresent: input.legacyStorePresent ?? legacyStorePresent,
    })
    if (decision.kind !== 'launch') return decision
    const command = sessionHostLaunchCommandFor({
      platform: input.platform,
      isPackaged: input.app.isPackaged,
      executablePath: input.executablePath,
      appPath: input.app.getAppPath(),
      appImagePath: input.environment.APPIMAGE,
      commandLine: input.app.commandLine,
    })
    const child = (input.spawn ?? spawnDetachedProcess)({
      ...command,
      environment: prelaunchEnvironment(input, userDataRoot),
    })
    ;(input.record ?? recordSessionHostPrelaunch)(trackLaunchedHost(child, userDataRoot))
    return decision
  } catch {
    return null
  }
}
