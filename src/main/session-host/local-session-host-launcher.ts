import { spawn } from 'node:child_process'
import net from 'node:net'
import { app } from 'electron'
import { env, getSafeChildEnv } from '../env'
import { probeLocalSessionHost } from './local-session-client'
import {
  type LocalSessionClientConnectionInput,
  LocalSessionHostUpgradePendingError,
} from './local-session-client-connection'
import type { SessionHostOwnership } from './session-host-ownership'
import { acquireSessionHostOwnership } from './session-host-ownership'

const HOST_START_TIMEOUT_MS = 30_000
export const HOST_TAKEOVER_TIMEOUT_MS = 15 * 60_000
const HOST_POLL_INTERVAL_MS = 50
const CONNECT_PROBE_TIMEOUT_MS = 250

export function sessionHostLaunchArguments(input: {
  readonly isPackaged: boolean
  readonly appPath: string
}) {
  return input.isPackaged ? ['session-host-internal'] : [input.appPath, 'session-host-internal']
}

/**
 * The detached Host outlives the client that starts it, so it must not retain the client's
 * arbitrary secrets or inherit Electron's Node-compatibility switch. The explicit OpenWaggle
 * values are the minimum needed to select the same data root and logging policy as the client.
 */
export function sessionHostChildEnvironment(input: {
  readonly safeEnvironment?: Readonly<Record<string, string | undefined>>
  readonly userDataRoot: string
  readonly logLevel?: 'debug' | 'info' | 'warn' | 'error'
}) {
  return {
    ...(input.safeEnvironment ?? getSafeChildEnv()),
    OPENWAGGLE_USER_DATA_DIR: input.userDataRoot,
    ...(input.logLevel ? { OPENWAGGLE_LOG_LEVEL: input.logLevel } : {}),
  }
}

export interface LocalSessionHostLauncherDependencies {
  readonly canConnect: (endpoint: string) => Promise<boolean>
  readonly probe: typeof probeLocalSessionHost
  readonly tryAcquireOwnership: (databasePath: string) => Promise<SessionHostOwnership | null>
  readonly launch: () => void
  readonly now: () => number
  readonly wait: (milliseconds: number) => Promise<void>
}

export function isLocalSessionHostUnavailable(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET'
}

function canConnect(endpoint: string) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(endpoint)
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, CONNECT_PROBE_TIMEOUT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

const defaultDependencies: LocalSessionHostLauncherDependencies = {
  canConnect,
  probe: probeLocalSessionHost,
  tryAcquireOwnership: async (databasePath) => {
    try {
      return await acquireSessionHostOwnership(databasePath, { timeoutMs: 0 })
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ELOCKED'
      ) {
        return null
      }
      throw error
    }
  },
  launch: () => {
    const child = spawn(
      process.execPath,
      sessionHostLaunchArguments({ isPackaged: app.isPackaged, appPath: app.getAppPath() }),
      {
        detached: true,
        stdio: 'ignore',
        env: sessionHostChildEnvironment({
          userDataRoot: app.getPath('userData'),
          ...(env.OPENWAGGLE_LOG_LEVEL ? { logLevel: env.OPENWAGGLE_LOG_LEVEL } : {}),
        }),
      },
    )
    child.unref()
  },
  now: Date.now,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}

async function waitForCondition(input: {
  readonly timeoutMs: number
  readonly condition: () => Promise<boolean>
  readonly dependencies: LocalSessionHostLauncherDependencies
}) {
  const deadline = input.dependencies.now() + input.timeoutMs
  while (input.dependencies.now() < deadline) {
    if (await input.condition()) return true
    await input.dependencies.wait(HOST_POLL_INTERVAL_MS)
  }
  return input.condition()
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
    condition: async () => {
      if (!(await dependencies.canConnect(input.paths.endpoint))) return false
      try {
        await dependencies.probe(input)
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
    if (await dependencies.canConnect(input.paths.endpoint)) {
      try {
        return { status: 'connected' as const, negotiation: await dependencies.probe(input) }
      } catch (error) {
        if (!(error instanceof LocalSessionHostUpgradePendingError)) throw error
        upgradePendingError = error
      }
    }
    const ownership = await dependencies.tryAcquireOwnership(input.paths.databasePath)
    if (ownership) {
      await ownership.release()
      return { status: 'launch' as const }
    }
    await dependencies.wait(HOST_POLL_INTERVAL_MS)
  }
  if (upgradePendingError) throw upgradePendingError
  throw new Error('Timed out waiting for Local Session Host authority.')
}

export async function ensureLocalSessionHost(
  input: LocalSessionClientConnectionInput & { readonly takeoverTimeoutMs?: number },
  dependencies: LocalSessionHostLauncherDependencies = defaultDependencies,
) {
  const takeoverTimeoutMs = input.takeoverTimeoutMs ?? HOST_TAKEOVER_TIMEOUT_MS
  const authority = await waitForLocalSessionHostAuthority(input, takeoverTimeoutMs, dependencies)
  if (authority.status === 'connected') return authority.negotiation

  dependencies.launch()
  await waitForCompatibleHost(input, HOST_START_TIMEOUT_MS, dependencies)
  return dependencies.probe(input)
}
