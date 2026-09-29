import type { LocalHostCommandPayload, LocalHostCommandResult } from '@shared/types/local-host'
import { LOCAL_HOST_CONTRACT_VERSION } from '@shared/types/local-host'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { LocalSessionCommandAuthorizationError } from '../errors'

/** Only the local user may stop the Host; named profiles and agents may not. */
function authorizeLocalHostCaller(caller: LocalSessionCallerIdentity) {
  if (caller.profileAuthority || !caller.callerId.startsWith('local-user:')) {
    throw new LocalSessionCommandAuthorizationError({ code: 'capability_denied' })
  }
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
  readonly requestHostStop: () => {
    readonly hostInstanceId: string
    readonly runningActions: number
  }
}): Promise<LocalHostCommandResult> {
  authorizeLocalHostCaller(input.caller)
  // Stop first, so no Run can be admitted between the count and the drain. The count only
  // informs the reply; failing to read it must not cancel the stop.
  const stopping = input.requestHostStop()
  const blockingRuns = await input.countBlockingRuns().catch(() => null)
  return {
    contract: 'local-host-v1',
    response: {
      contractVersion: LOCAL_HOST_CONTRACT_VERSION,
      operation: input.payload.request.operation,
      hostInstanceId: stopping.hostInstanceId,
      blockingRuns,
      blockingActions: stopping.runningActions,
    },
  }
}
