import net from 'node:net'
import { app } from 'electron'
import { launchHeadlessBackgroundProcess } from '../desktop-ui'
import { env, getSessionHostChildEnv } from '../env'
import { startupTimingsRequested } from '../startup-timing'
import { awaitWithSignal } from './await-with-signal'
import { probeLocalSessionHost } from './local-session-client'
import {
  type LocalSessionClientConnectionInput,
  LocalSessionHostUpgradePendingError,
} from './local-session-client-connection'
import { LocalSessionHostUnavailableError } from './local-session-client-protocol-error'
import { HOST_POLL_INTERVAL_MS, waitForCondition } from './local-session-host-polling'
import { type LocalSessionHostPaths, refreshLocalSessionHostEndpoint } from './local-session-paths'
import {
  type SessionHostLogLevel,
  sessionHostChildEnvironmentFrom,
  sessionHostLaunchCommandFor,
} from './session-host-launch-command'
import type { SessionHostOwnership } from './session-host-ownership'
import type { SessionHostPrelaunch } from './session-host-prelaunch-handoff'
import { makeSharedOperations } from './shared-operations'

export const HOST_TAKEOVER_TIMEOUT_MS = 15 * 60_000
const CONNECT_PROBE_TIMEOUT_MS = 250

export {
  sessionHostLaunchArguments,
  sessionHostLaunchCommand,
} from './session-host-launch-command'

/** The command that launches a Host with the switches this process was started with. */
export function currentSessionHostLaunchCommand() {
  return sessionHostLaunchCommandFor({
    platform: process.platform,
    isPackaged: app.isPackaged,
    executablePath: process.execPath,
    appPath: app.getAppPath(),
    appImagePath: env.APPIMAGE,
    commandLine: app.commandLine,
  })
}

/**
 * The detached Host outlives the client that starts it, so it must not retain the client's
 * client-scoped credentials or inherit Electron's Node-compatibility switch. Provider and shell
 * environment must survive because this process owns Pi Runs after the launching client exits.
 */
export function sessionHostChildEnvironment(input: {
  readonly safeEnvironment?: Readonly<Record<string, string | undefined>>
  readonly userDataRoot: string
  readonly logLevel?: SessionHostLogLevel
  /** The launching GUI measures its startup, so the Host marks its own too. */
  readonly startupTimings?: boolean
}) {
  return sessionHostChildEnvironmentFrom({
    ...input,
    safeEnvironment: input.safeEnvironment ?? getSessionHostChildEnv(),
  })
}

export interface LocalSessionHostLauncherDependencies {
  readonly canConnect: (endpoint: string, signal?: AbortSignal) => Promise<boolean>
  readonly probe: typeof probeLocalSessionHost
  readonly tryAcquireOwnership: (databasePath: string) => Promise<SessionHostOwnership | null>
  readonly launch: () => void | Promise<void>
  readonly now: () => number
  readonly wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readonly refreshPaths: (paths: LocalSessionHostPaths) => Promise<LocalSessionHostPaths>
}

export function isLocalSessionHostUnavailable(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return (
    error.code === 'ENOENT' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ECONNRESET' ||
    error.code === 'ECONNABORTED' ||
    error.code === 'EPIPE'
  )
}

function canConnect(endpoint: string, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    signal?.throwIfAborted()
    const socket = net.createConnection(endpoint)
    const abort = () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(false)
    }
    const settle = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      settle()
      socket.destroy()
      resolve(false)
    }, CONNECT_PROBE_TIMEOUT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      settle()
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      settle()
      resolve(false)
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}

const defaultDependencies: LocalSessionHostLauncherDependencies = {
  canConnect,
  probe: probeLocalSessionHost,
  tryAcquireOwnership: async (databasePath) => {
    // Its SQLite lock loads only when no Host answers, never on the window's entry graph.
    const ownership = await import('./session-host-ownership')
    try {
      return await ownership.acquireSessionHostOwnership(databasePath, { timeoutMs: 0 })
    } catch (error) {
      if (ownership.isSessionHostOwnershipHeld(error)) return null
      throw error
    }
  },
  launch: () =>
    launchHeadlessBackgroundProcess({
      ...currentSessionHostLaunchCommand(),
      environment: sessionHostChildEnvironment({
        userDataRoot: app.getPath('userData'),
        ...(env.OPENWAGGLE_LOG_LEVEL ? { logLevel: env.OPENWAGGLE_LOG_LEVEL } : {}),
        startupTimings: startupTimingsRequested(),
      }),
    }),
  now: Date.now,
  wait: (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted()
      const abort = () => {
        clearTimeout(timer)
        reject(signal?.reason)
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort)
        resolve()
      }, milliseconds)
      signal?.addEventListener('abort', abort, { once: true })
    }),
  refreshPaths: refreshLocalSessionHostEndpoint,
}

/** Waits until the Host at `endpoint` stops listening; false once `timeoutMs` passed first. */
export async function waitForLocalSessionHostRelease(
  endpoint: string,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
  dependencies: LocalSessionHostLauncherDependencies = defaultDependencies,
) {
  const { signal } = options
  return waitForCondition({
    timeoutMs: options.timeoutMs ?? HOST_TAKEOVER_TIMEOUT_MS,
    condition: async () => !(await dependencies.canConnect(endpoint, signal)),
    dependencies,
    ...(signal ? { signal } : {}),
  })
}

async function waitForCompatibleHost(
  input: LocalSessionClientConnectionInput,
  timeoutMs: number,
  dependencies: LocalSessionHostLauncherDependencies,
) {
  let lastError: unknown
  const ready = await waitForCondition({
    timeoutMs,
    dependencies,
    signal: input.signal,
    condition: async () => {
      const paths = await awaitWithSignal(dependencies.refreshPaths(input.paths), input.signal)
      if (
        !(await awaitWithSignal(
          dependencies.canConnect(paths.endpoint, input.signal),
          input.signal,
        ))
      ) {
        return false
      }
      try {
        await awaitWithSignal(dependencies.probe({ ...input, paths }), input.signal)
        return true
      } catch (error) {
        lastError = error
        return false
      }
    },
  })
  if (ready) return
  if (lastError) throw lastError
  throw new LocalSessionHostUnavailableError('Timed out starting the Local Session Host.')
}

async function waitForLocalSessionHostAuthority(
  input: LocalSessionClientConnectionInput & { readonly onUpgradePending?: () => void },
  timeoutMs: number,
  dependencies: LocalSessionHostLauncherDependencies,
) {
  let upgradePendingError: LocalSessionHostUpgradePendingError | null = null
  const deadline = dependencies.now() + timeoutMs
  while (dependencies.now() < deadline) {
    input.signal?.throwIfAborted()
    const paths = await awaitWithSignal(dependencies.refreshPaths(input.paths), input.signal)
    if (
      await awaitWithSignal(dependencies.canConnect(paths.endpoint, input.signal), input.signal)
    ) {
      try {
        return {
          status: 'connected' as const,
          negotiation: await awaitWithSignal(dependencies.probe({ ...input, paths }), input.signal),
        }
      } catch (error) {
        if (!(error instanceof LocalSessionHostUpgradePendingError)) throw error
        if (!upgradePendingError) input.onUpgradePending?.()
        upgradePendingError = error
      }
      // An older executable may use a different ownership mechanism. Its authenticated listener
      // remains authoritative until it closes, even if this version's ownership file is available.
      await awaitWithSignal(dependencies.wait(HOST_POLL_INTERVAL_MS, input.signal), input.signal)
      continue
    }
    const ownership = await dependencies.tryAcquireOwnership(input.paths.databasePath)
    if (ownership) {
      await ownership.release()
      input.signal?.throwIfAborted()
      return { status: 'launch' as const }
    }
    await awaitWithSignal(dependencies.wait(HOST_POLL_INTERVAL_MS, input.signal), input.signal)
  }
  if (upgradePendingError) throw upgradePendingError
  throw new LocalSessionHostUnavailableError('Timed out waiting for Local Session Host authority.')
}

/**
 * Every client that loses its Host looks for authority at once, and finds the ownership file free
 * until the Host one of them launched boots; each would launch its own Host, and all but one would
 * stop on ELOCKED. Clients in one process therefore share one launch per Host database.
 */
const sharedLaunches = makeSharedOperations<LocalSessionHostLauncherDependencies>()

export async function ensureLocalSessionHost(
  input: LocalSessionClientConnectionInput & {
    readonly takeoverTimeoutMs?: number
    /** Called once when the running Host is handing over to an update and this call waits. */
    readonly onUpgradePending?: () => void
    /** Called once this call has launched a Host process, before it waits for it to listen. */
    readonly onLaunched?: () => void
  },
  dependencies: LocalSessionHostLauncherDependencies = defaultDependencies,
) {
  const takeoverTimeoutMs = input.takeoverTimeoutMs ?? HOST_TAKEOVER_TIMEOUT_MS
  const authority = await waitForLocalSessionHostAuthority(input, takeoverTimeoutMs, dependencies)
  if (authority.status === 'connected') return authority.negotiation

  await sharedLaunches(dependencies, input.paths.databasePath, input.signal, async (signal) => {
    await dependencies.launch()
    input.onLaunched?.()
    signal.throwIfAborted()
    await waitForCompatibleHost({ ...input, signal }, takeoverTimeoutMs, dependencies)
  })
  const paths = await awaitWithSignal(dependencies.refreshPaths(input.paths), input.signal)
  return awaitWithSignal(dependencies.probe({ ...input, paths }), input.signal)
}

/**
 * Waits for the Host the boot shim launched (`boot/session-host-prelaunch.ts`) to answer, the way
 * a client waits for a Host it launched itself. Resolves false, so the caller starts the Host the
 * usual way, once that process has ended without answering: another Host owned the profile, or it
 * failed to start.
 */
export async function waitForPrelaunchedLocalSessionHost(
  input: LocalSessionClientConnectionInput & {
    readonly prelaunch: Pick<SessionHostPrelaunch, 'hasEnded'>
    readonly timeoutMs?: number
  },
  dependencies: LocalSessionHostLauncherDependencies = defaultDependencies,
) {
  let answered = false
  await waitForCondition({
    timeoutMs: input.timeoutMs ?? HOST_TAKEOVER_TIMEOUT_MS,
    dependencies,
    signal: input.signal,
    condition: async () => {
      if (input.prelaunch.hasEnded()) return true
      const paths = await awaitWithSignal(dependencies.refreshPaths(input.paths), input.signal)
      if (
        !(await awaitWithSignal(
          dependencies.canConnect(paths.endpoint, input.signal),
          input.signal,
        ))
      ) {
        return false
      }
      try {
        await awaitWithSignal(dependencies.probe({ ...input, paths }), input.signal)
        answered = true
        return true
      } catch (error) {
        if (input.signal?.aborted) throw error
        return false
      }
    },
  })
  return answered
}
