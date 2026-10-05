import { LOCAL_HOST_CONTRACT_VERSION } from '@shared/types/local-host'
import { describeError } from '../error-description'
import { createLogger } from '../logger'
import {
  executeLocalSessionCommand,
  LocalSessionHostUpgradePendingError,
  probeLocalSessionHost,
} from './local-session-client'
import { isLocalSessionHostUnavailable } from './local-session-host-launcher'
import type { LocalSessionHostPaths } from './local-session-paths'
import { refreshLocalSessionHostEndpoint } from './local-session-paths'

const logger = createLogger('session-host-release')

/**
 * The Host's update drain ends 10 seconds after the stop (DESKTOP_UPDATE_HOST_STOP_DEADLINE_MS),
 * plus up to 3 seconds for interrupted Runs to settle; this leaves time for it to exit.
 */
export const SESSION_HOST_UPDATE_RELEASE_TIMEOUT_MS = 15_000
const RELEASE_POLL_INTERVAL_MS = 200

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

function defaultDependencies(client: {
  readonly paths: LocalSessionHostPaths
  readonly clientVersion: string
}): SessionHostReleaseDependencies {
  return {
    // Bounded by the client's default 10 s response timeout; the Host answers a stop at once.
    requestStop: async () => {
      const result = await executeLocalSessionCommand({
        paths: await refreshLocalSessionHostEndpoint(client.paths),
        clientKind: 'gui',
        clientVersion: client.clientVersion,
        payload: {
          contract: 'local-host-v1',
          request: { contractVersion: LOCAL_HOST_CONTRACT_VERSION, operation: 'stop' },
        },
      })
      if (result.contract !== 'local-host-v1') {
        throw new Error('The Session Host returned an unexpected response to stop.')
      }
      const { hostInstanceId, processId } = result.response
      return processId === undefined ? { hostInstanceId } : { hostInstanceId, processId }
    },
    probe: async () => {
      try {
        const negotiation = await probeLocalSessionHost({
          paths: await refreshLocalSessionHostEndpoint(client.paths),
          clientKind: 'gui',
          clientVersion: client.clientVersion,
        })
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
  if (host.processId !== undefined) {
    return dependencies.processExists(host.processId) ? 'running' : 'stopped'
  }
  const answer = await dependencies.probe().catch((error: unknown) => {
    // A Host shutting down refuses even new connections; that is progress, not failure.
    logger.debug('Session Host probe failed while it stops', describeError(error))
    return null
  })
  if (answer?.state === 'not-running') return 'stopped'
  if (answer?.state === 'running' && answer.hostInstanceId !== host.hostInstanceId) {
    return 'replaced'
  }
  return 'running'
}

/**
 * Stop the detached Session Host before an update installs.
 *
 * The Host runs from the app bundle. macOS Squirrel refuses to replace the bundle while any process
 * from it is running ("App Still Running"), so on macOS this waits for the Host process to exit. The
 * Windows installer and the AppImage updater replace the app themselves, and a slow quit only
 * delays them, so there the stop is only requested (ADR 0047). Never throws: a Host that cannot be
 * stopped must not keep the app from quitting.
 */
export async function releaseSessionHostForUpdate(
  client: { readonly paths: LocalSessionHostPaths; readonly clientVersion: string },
  options: { readonly timeoutMs?: number } = {},
  dependencies: SessionHostReleaseDependencies = defaultDependencies(client),
): Promise<SessionHostReleaseOutcome> {
  const timeoutMs = options.timeoutMs ?? SESSION_HOST_UPDATE_RELEASE_TIMEOUT_MS
  const startedAt = dependencies.now()
  let host: StoppingHost
  try {
    host = await dependencies.requestStop()
  } catch (error) {
    if (isLocalSessionHostUnavailable(error)) return 'not-running'
    // An older Host refuses the desktop app's stop. Quit anyway; the next launch reports the result.
    logger.warn('The Session Host did not accept the update stop', describeError(error))
    return 'refused'
  }
  if (dependencies.platform !== 'darwin') return 'stop-requested'
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
