import net from 'node:net'
import path from 'node:path'
import { app } from 'electron'
import { launchHeadlessBackgroundProcess } from '../desktop-ui'
import { env, getSessionHostChildEnv } from '../env'
import { awaitWithSignal } from './await-with-signal'
import { probeLocalSessionHost } from './local-session-client'
import {
  type LocalSessionClientConnectionInput,
  LocalSessionHostUpgradePendingError,
} from './local-session-client-connection'
import { type LocalSessionHostPaths, refreshLocalSessionHostEndpoint } from './local-session-paths'
import type { SessionHostOwnership } from './session-host-ownership'
import { acquireSessionHostOwnership, isSessionHostOwnershipHeld } from './session-host-ownership'
import { makeSharedOperations } from './shared-operations'

export const HOST_TAKEOVER_TIMEOUT_MS = 15 * 60_000
const HOST_POLL_INTERVAL_MS = 50
const CONNECT_PROBE_TIMEOUT_MS = 250

export function sessionHostLaunchArguments(input: {
  readonly isPackaged: boolean
  readonly appPath: string
}) {
  return input.isPackaged ? ['session-host-internal'] : [input.appPath, 'session-host-internal']
}

export function sessionHostLaunchCommand(input: {
  readonly platform: NodeJS.Platform
  readonly isPackaged: boolean
  readonly executablePath: string
  readonly appPath: string
  readonly appImagePath?: string
  readonly parentNoSandbox?: boolean
}) {
  // Restricted Linux environments may launch the GUI with this explicit Electron switch.
  // Its detached authority needs the same policy; never disable the sandbox by default.
  const electronArguments =
    input.platform === 'linux' && input.parentNoSandbox ? ['--no-sandbox'] : []
  if (
    input.platform === 'linux' &&
    input.isPackaged &&
    input.appImagePath &&
    path.isAbsolute(input.appImagePath)
  ) {
    return { command: input.appImagePath, args: [...electronArguments, 'session-host-internal'] }
  }
  return {
    command: input.executablePath,
    args: [...electronArguments, ...sessionHostLaunchArguments(input)],
  }
}

/**
 * The detached Host outlives the client that starts it, so it must not retain the client's
 * client-scoped credentials or inherit Electron's Node-compatibility switch. Provider and shell
 * environment must survive because this process owns Pi Runs after the launching client exits.
 */
export function sessionHostChildEnvironment(input: {
  readonly safeEnvironment?: Readonly<Record<string, string | undefined>>
  readonly userDataRoot: string
  readonly logLevel?: 'debug' | 'info' | 'warn' | 'error'
}) {
  return {
    ...(input.safeEnvironment ?? getSessionHostChildEnv()),
    OPENWAGGLE_USER_DATA_DIR: input.userDataRoot,
    ...(input.logLevel ? { OPENWAGGLE_LOG_LEVEL: input.logLevel } : {}),
  }
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
    try {
      return await acquireSessionHostOwnership(databasePath, { timeoutMs: 0 })
    } catch (error) {
      if (isSessionHostOwnershipHeld(error)) return null
      throw error
    }
  },
  launch: () => {
    const launch = sessionHostLaunchCommand({
      platform: process.platform,
      isPackaged: app.isPackaged,
      executablePath: process.execPath,
      appPath: app.getAppPath(),
      parentNoSandbox: app.commandLine.hasSwitch('no-sandbox'),
      ...(env.APPIMAGE ? { appImagePath: env.APPIMAGE } : {}),
    })
    return launchHeadlessBackgroundProcess({
      ...launch,
      environment: sessionHostChildEnvironment({
        userDataRoot: app.getPath('userData'),
        ...(env.OPENWAGGLE_LOG_LEVEL ? { logLevel: env.OPENWAGGLE_LOG_LEVEL } : {}),
      }),
    })
  },
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

async function waitForCondition(input: {
  readonly timeoutMs: number
  readonly condition: () => Promise<boolean>
  readonly dependencies: LocalSessionHostLauncherDependencies
  readonly signal?: AbortSignal
}) {
  input.signal?.throwIfAborted()
  const deadline = input.dependencies.now() + input.timeoutMs
  while (input.dependencies.now() < deadline) {
    if (await awaitWithSignal(input.condition(), input.signal)) return true
    await awaitWithSignal(
      input.dependencies.wait(HOST_POLL_INTERVAL_MS, input.signal),
      input.signal,
    )
  }
  return awaitWithSignal(input.condition(), input.signal)
}

export async function waitForLocalSessionHostRelease(
  endpoint: string,
  timeoutMs = HOST_TAKEOVER_TIMEOUT_MS,
  dependencies: LocalSessionHostLauncherDependencies = defaultDependencies,
) {
  return waitForCondition({
    timeoutMs,
    condition: async () => !(await dependencies.canConnect(endpoint)),
    dependencies,
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
  throw new Error('Timed out starting the Local Session Host.')
}

async function waitForLocalSessionHostAuthority(
  input: LocalSessionClientConnectionInput,
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
  throw new Error('Timed out waiting for Local Session Host authority.')
}

/**
 * Every client that loses its Host looks for authority at once, and finds the ownership file free
 * until the Host one of them launched boots; each would launch its own Host, and all but one would
 * stop on ELOCKED. Clients in one process therefore share one launch per Host database.
 */
const sharedLaunches = makeSharedOperations<LocalSessionHostLauncherDependencies>()

export async function ensureLocalSessionHost(
  input: LocalSessionClientConnectionInput & { readonly takeoverTimeoutMs?: number },
  dependencies: LocalSessionHostLauncherDependencies = defaultDependencies,
) {
  const takeoverTimeoutMs = input.takeoverTimeoutMs ?? HOST_TAKEOVER_TIMEOUT_MS
  const authority = await waitForLocalSessionHostAuthority(input, takeoverTimeoutMs, dependencies)
  if (authority.status === 'connected') return authority.negotiation

  await sharedLaunches(dependencies, input.paths.databasePath, input.signal, async (signal) => {
    await dependencies.launch()
    signal.throwIfAborted()
    await waitForCompatibleHost({ ...input, signal }, takeoverTimeoutMs, dependencies)
  })
  const paths = await awaitWithSignal(dependencies.refreshPaths(input.paths), input.signal)
  return awaitWithSignal(dependencies.probe({ ...input, paths }), input.signal)
}
