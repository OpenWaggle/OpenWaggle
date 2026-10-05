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
 * The Host's own update drain lasts at most 10 seconds (DESKTOP_UPDATE_HOST_STOP_DEADLINE_MS);
 * this leaves time for it to close its sockets and exit.
 */
export const SESSION_HOST_UPDATE_RELEASE_TIMEOUT_MS = 15_000
const RELEASE_POLL_INTERVAL_MS = 200

export type SessionHostReleaseOutcome =
  | 'not-running'
  | 'stopped'
  | 'replaced'
  | 'refused'
  | 'timed-out'

type HostAnswer =
  | { readonly state: 'not-running' }
  | { readonly state: 'running'; readonly hostInstanceId: string }

export interface SessionHostReleaseDependencies {
  /** Ask the Host to stop; returns the stopping Host's instance id. */
  readonly requestStop: () => Promise<string>
  readonly probe: () => Promise<HostAnswer>
  readonly now: () => number
  readonly wait: (milliseconds: number) => Promise<void>
}

function defaultDependencies(client: {
  readonly paths: LocalSessionHostPaths
  readonly clientVersion: string
}): SessionHostReleaseDependencies {
  return {
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
      return result.response.hostInstanceId
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
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }
}

/**
 * Stop the detached Session Host before an update installs, and wait for its process to exit.
 *
 * The Host runs from the app bundle. macOS Squirrel refuses to replace the bundle while any process
 * from it is running ("App Still Running"), and the Windows installer kills it; either way an
 * update must not leave the old version's Host behind (ADR 0047). Never throws: a Host that cannot
 * be stopped must not keep the app from quitting.
 */
export async function releaseSessionHostForUpdate(
  client: { readonly paths: LocalSessionHostPaths; readonly clientVersion: string },
  options: { readonly timeoutMs?: number } = {},
  dependencies: SessionHostReleaseDependencies = defaultDependencies(client),
): Promise<SessionHostReleaseOutcome> {
  const timeoutMs = options.timeoutMs ?? SESSION_HOST_UPDATE_RELEASE_TIMEOUT_MS
  const startedAt = dependencies.now()
  let hostInstanceId: string
  try {
    hostInstanceId = await dependencies.requestStop()
  } catch (error) {
    if (isLocalSessionHostUnavailable(error)) return 'not-running'
    // An older Host refuses the desktop app's stop. Quit anyway; the installer reports the result.
    logger.warn('The Session Host did not accept the update stop', describeError(error))
    return 'refused'
  }
  while (dependencies.now() - startedAt < timeoutMs) {
    const answer = await dependencies.probe().catch((error: unknown) => {
      // A Host shutting down refuses even new connections; that is progress, not failure.
      logger.debug('Session Host probe failed while it stops', describeError(error))
      return null
    })
    if (answer?.state === 'not-running') return 'stopped'
    if (answer?.state === 'running' && answer.hostInstanceId !== hostInstanceId) return 'replaced'
    await dependencies.wait(RELEASE_POLL_INTERVAL_MS)
  }
  logger.warn('The Session Host was still running when the update quit', {
    hostInstanceId,
    timeoutMs,
  })
  return 'timed-out'
}
