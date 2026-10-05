import type { LocalHostCommandPayload, LocalHostCommandResult } from '@shared/types/local-host'
import { LOCAL_HOST_CONTRACT_VERSION } from '@shared/types/local-host'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionHostDrainOptions } from '../application/session-host-liveness'
import { LocalSessionCommandAuthorizationError } from '../errors'

const DESKTOP_APP_CALLER_ID = 'gui:local-user'

/**
 * How long the Host drains when the desktop app stops it to install an update (ADR 0047). Restart
 * to update has already let Runs finish or stopped them, so this only bounds work such as a running
 * Action, a CLI wait, or an export that would otherwise keep the old version running.
 */
export const DESKTOP_UPDATE_HOST_STOP_DEADLINE_MS = 10_000

/**
 * Only the local user may stop the Host: the CLI, or the desktop app when it installs an update.
 * Named profiles and agents may not.
 */
function hostStopOptions(caller: LocalSessionCallerIdentity): SessionHostDrainOptions {
  if (caller.profileAuthority) {
    throw new LocalSessionCommandAuthorizationError({ code: 'capability_denied' })
  }
  if (caller.callerId === DESKTOP_APP_CALLER_ID) {
    return { deadlineMs: DESKTOP_UPDATE_HOST_STOP_DEADLINE_MS }
  }
  if (caller.callerId.startsWith('local-user:')) return {}
  throw new LocalSessionCommandAuthorizationError({ code: 'capability_denied' })
}

/**
 * Stop the Session Host gracefully: it stops accepting new work at once and exits when its
 * active Runs, exports, and other owned work have finished. Connected clients such as the
 * desktop app reconnect by starting a new Host.
 */
export async function dispatchLocalHostCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalHostCommandPayload
  readonly countBlockingRuns: () => Promise<number>
  readonly requestHostStop: (options: SessionHostDrainOptions) => {
    readonly hostInstanceId: string
    readonly runningActions: number
  }
  readonly processId?: number
}): Promise<LocalHostCommandResult> {
  const options = hostStopOptions(input.caller)
  // Stop first, so no Run can be admitted between the count and the drain. The count only
  // informs the reply; failing to read it must not cancel the stop.
  const stopping = input.requestHostStop(options)
  const blockingRuns = await input.countBlockingRuns().catch(() => null)
  return {
    contract: 'local-host-v1',
    response: {
      contractVersion: LOCAL_HOST_CONTRACT_VERSION,
      operation: input.payload.request.operation,
      hostInstanceId: stopping.hostInstanceId,
      blockingRuns,
      blockingActions: stopping.runningActions,
      ...(input.caller.callerId === DESKTOP_APP_CALLER_ID && input.processId !== undefined
        ? { processId: input.processId }
        : {}),
    },
  }
}
