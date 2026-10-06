import type { LocalHostCommandPayload, LocalHostCommandResult } from '@shared/types/local-host'
import { LOCAL_HOST_CONTRACT_VERSION } from '@shared/types/local-host'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionHostDrainOptions } from '../application/session-host-liveness'
import { LocalSessionCommandAuthorizationError } from '../errors'

const DESKTOP_APP_CALLER_ID = 'gui:local-user'

/**
 * How long the Host drains when it stops for an update (ADR 0047). Installing an update has
 * already let Runs finish or asked the user, so this bounds the rest: a Run still active is
 * interrupted, and a running Action, CLI wait or export ends with the Host.
 */
export const UPDATE_HOST_STOP_DEADLINE_MS = 10_000

/**
 * Only the local user may stop the Host: the CLI, and the desktop app or an installer when an
 * update installs. Named profiles and agents may not. The desktop app only stops it for updates.
 */
function hostStopOptions(
  caller: LocalSessionCallerIdentity,
  payload: LocalHostCommandPayload,
): SessionHostDrainOptions {
  if (caller.profileAuthority) {
    throw new LocalSessionCommandAuthorizationError({ code: 'capability_denied' })
  }
  const forUpdate = payload.request.purpose === 'update'
  const isDesktopApp = caller.callerId === DESKTOP_APP_CALLER_ID
  if (!isDesktopApp && !caller.callerId.startsWith('local-user:')) {
    throw new LocalSessionCommandAuthorizationError({ code: 'capability_denied' })
  }
  if (isDesktopApp && !forUpdate) {
    throw new LocalSessionCommandAuthorizationError({ code: 'capability_denied' })
  }
  return forUpdate ? { deadlineMs: UPDATE_HOST_STOP_DEADLINE_MS } : {}
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
  const options = hostStopOptions(input.caller, input.payload)
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
      ...(input.payload.request.purpose === 'update' && input.processId !== undefined
        ? { processId: input.processId }
        : {}),
    },
  }
}
