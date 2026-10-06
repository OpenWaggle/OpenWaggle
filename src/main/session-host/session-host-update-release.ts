import { LOCAL_HOST_CONTRACT_VERSION } from '@shared/types/local-host'
import { SESSION_HOST_DRAIN_DEADLINE_SETTLE_MS } from '../application/session-host-liveness'
import { describeError } from '../error-description'
import { createLogger } from '../logger'
import { UPDATE_HOST_STOP_DEADLINE_MS } from './local-host-command'
import {
  executeLocalSessionCommand,
  LocalSessionHostUpgradePendingError,
  probeLocalSessionHost,
} from './local-session-client'
import { LocalSessionClientProtocolError } from './local-session-client-protocol-error'
import { isLocalSessionHostUnavailable } from './local-session-host-launcher'
import { refreshLocalSessionHostEndpoint } from './local-session-paths'

const logger = createLogger('session-host-release')

/** Time the Host takes from the end of its drain to exiting: flushes, runtime dispose, logs. */
const SESSION_HOST_EXIT_BUDGET_MS = 7_000
/** The Host's whole update stop: its drain deadline, the Run settle, and its exit. */
export const SESSION_HOST_UPDATE_RELEASE_TIMEOUT_MS =
  UPDATE_HOST_STOP_DEADLINE_MS + SESSION_HOST_DRAIN_DEADLINE_SETTLE_MS + SESSION_HOST_EXIT_BUDGET_MS
const RELEASE_POLL_INTERVAL_MS = 200
/** A Host that is exiting can take the full connect timeout to refuse; the release cannot. */
const PROBE_TIMEOUT_MS = 1_000

export type SessionHostReleaseOutcome =
  | 'not-running'
  | 'stopped'
  | 'stop-requested'
  | 'replaced'
  | 'refused'
  | 'timed-out'

type HostAnswer =
  | { readonly state: 'not-running' }
  | { readonly state: 'running'; readonly hostInstanceId: string }

interface StoppingHost {
  readonly hostInstanceId: string
  readonly processId?: number
}

export interface SessionHostReleaseDependencies {
  /** Ask the Host to stop; returns the stopping Host and, from a current Host, its process id. */
  readonly requestStop: () => Promise<StoppingHost>
  readonly probe: () => Promise<HostAnswer>
  readonly processExists: (processId: number) => boolean
  readonly now: () => number
  readonly wait: (milliseconds: number) => Promise<void>
  readonly platform: NodeJS.Platform
}

function processExists(processId: number) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'EPERM'
  }
}

function withProbeTimeout<T>(probe: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('The Session Host did not answer the probe in time.')),
      PROBE_TIMEOUT_MS,
    )
  })
  return Promise.race([probe, timeout]).finally(() => clearTimeout(timer))
}

/** Who asks: the desktop app, or the CLI that `openwaggle update` and the install script run. */
export type SessionHostReleaseClient = Omit<
  Parameters<typeof executeLocalSessionCommand>[0],
  'payload'
>

async function sendStop(client: SessionHostReleaseClient, forUpdate: boolean) {
  const result = await executeLocalSessionCommand({
    ...client,
    paths: await refreshLocalSessionHostEndpoint(client.paths),
    payload: {
      contract: 'local-host-v1',
      request: {
        contractVersion: LOCAL_HOST_CONTRACT_VERSION,
        operation: 'stop',
        ...(forUpdate ? { purpose: 'update' as const } : {}),
      },
    },
  })
  if (result.contract !== 'local-host-v1') {
    throw new Error('The Session Host returned an unexpected response to stop.')
  }
  const { hostInstanceId, processId } = result.response
  return processId === undefined ? { hostInstanceId } : { hostInstanceId, processId }
}

/** How a Host that predates `purpose` answers it: its exact decoder fails the command. */
function isRejectedUpdatePurpose(error: unknown): error is LocalSessionClientProtocolError {
  return error instanceof LocalSessionClientProtocolError && error.code === 'command_failed'
}

export function defaultReleaseDependencies(
  client: SessionHostReleaseClient,
): SessionHostReleaseDependencies {
  return {
    // Bounded by the client's default 10 s response timeout; the Host answers a stop at once.
    requestStop: async () => {
      try {
        return await sendStop(client, true)
      } catch (error) {
        // An older Host already hands over once its Runs end; waiting for it is the stop.
        if (error instanceof LocalSessionHostUpgradePendingError) {
          return { hostInstanceId: error.hostInstanceId }
        }
        if (!isRejectedUpdatePurpose(error)) throw error
        // A Host older than update stops rejects the purpose; the CLI can still stop it plainly,
        // without the deadline. The desktop app's plain stop is refused, as before.
        logger.debug('The Session Host refused an update stop; asking for a plain stop', {
          message: error.message,
        })
        return await sendStop(client, false)
      }
    },
    probe: async () => {
      try {
        const negotiation = await withProbeTimeout(
          probeLocalSessionHost({
            ...client,
            paths: await refreshLocalSessionHostEndpoint(client.paths),
          }),
        )
        return { state: 'running', hostInstanceId: negotiation.hostInstanceId }
      } catch (error) {
        // An older Host handing over is still a running process from this app bundle.
        if (error instanceof LocalSessionHostUpgradePendingError) {
          return { state: 'running', hostInstanceId: error.hostInstanceId }
        }
        if (isLocalSessionHostUnavailable(error)) return { state: 'not-running' }
        throw error
      }
    },
    processExists,
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    platform: process.platform,
  }
}

/** Whether the stopping Host is gone. The process itself is the proof; its socket closes first. */
async function hostHasExited(host: StoppingHost, dependencies: SessionHostReleaseDependencies) {
  if (host.processId !== undefined && dependencies.processExists(host.processId)) return 'running'
  const answer = await dependencies.probe().catch((error: unknown) => {
    // A Host shutting down refuses even new connections; that is progress, not failure.
    logger.debug('Session Host probe failed while it stops', describeError(error))
    return null
  })
  if (answer?.state === 'running' && answer.hostInstanceId !== host.hostInstanceId) {
    return 'replaced'
  }
  // With a process id, its exit is the proof; the probe above only names a replacement Host.
  if (host.processId !== undefined || answer?.state === 'not-running') return 'stopped'
  return 'running'
}

/**
 * Stop the detached Session Host before an update installs.
 *
 * The Host runs from the app bundle. macOS Squirrel refuses to replace the bundle while any process
 * from it is running ("App Still Running"), so the desktop app waits for the Host process to exit on
 * macOS. On Windows and Linux the desktop app only requests the stop: their installers replace the
 * app themselves, and a slow quit only delays them. `openwaggle update` and the install script
 * install only after this returns, so they always wait (`waitForExit`, ADR 0047). Never throws: a
 * Host that cannot be stopped must not keep the app from quitting.
 */
export async function releaseSessionHostForUpdate(
  client: SessionHostReleaseClient,
  options: { readonly timeoutMs?: number; readonly waitForExit?: boolean } = {},
  dependencies: SessionHostReleaseDependencies = defaultReleaseDependencies(client),
): Promise<SessionHostReleaseOutcome> {
  const timeoutMs = options.timeoutMs ?? SESSION_HOST_UPDATE_RELEASE_TIMEOUT_MS
  const startedAt = dependencies.now()
  let host: StoppingHost
  try {
    host = await dependencies.requestStop()
  } catch (error) {
    if (isLocalSessionHostUnavailable(error)) return 'not-running'
    // An older Host refuses the desktop app's stop, and a stuck one may not answer. Quit anyway;
    // the next launch reports the result.
    logger.warn('The Session Host did not accept or answer the update stop', describeError(error))
    return 'refused'
  }
  if (!(options.waitForExit ?? dependencies.platform === 'darwin')) return 'stop-requested'
  while (dependencies.now() - startedAt < timeoutMs) {
    const state = await hostHasExited(host, dependencies)
    if (state !== 'running') return state
    await dependencies.wait(RELEASE_POLL_INTERVAL_MS)
  }
  logger.warn('The Session Host was still running when the update quit', {
    hostInstanceId: host.hostInstanceId,
    timeoutMs,
  })
  return 'timed-out'
}
