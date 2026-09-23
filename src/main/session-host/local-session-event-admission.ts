import { LOCAL_SESSION_WORKTREE_LAUNCH_REVISION } from '@shared/types/local-session-protocol-revisions'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { snapshotAuthorizesSessionCapabilities } from '../domain/session-control/session-capability-authorization'
import { requiredCapabilityForSessionEvent } from '../domain/session-control/session-event-capability'
import type { AuthenticatedLocalSessionCaller } from './local-session-server'

export function createLocalSessionEventAdmissionFilter(
  resolveCaller: () => AuthenticatedLocalSessionCaller | null,
  requestedSessionIds?: readonly string[],
  negotiatedRevision?: number,
) {
  const requested =
    requestedSessionIds && requestedSessionIds.length > 0 ? new Set(requestedSessionIds) : undefined
  return (event: SessionHostEventEnvelope) => {
    const caller = resolveCaller()
    if (!caller) return false
    const authority = caller.profileAuthority
    if (
      event.payload.kind === 'session-worktree-launch' &&
      negotiatedRevision !== undefined &&
      negotiatedRevision < LOCAL_SESSION_WORKTREE_LAUNCH_REVISION
    ) {
      return false
    }
    if (event.payload.kind === 'semantic-discovery-readiness-changed') {
      return requested === undefined && !authority
    }
    const sessionId = event.payload.sessionId
    if (requested && !requested.has(sessionId)) return false
    if (!authority) return true
    const capability = requiredCapabilityForSessionEvent(event.payload)
    return snapshotAuthorizesSessionCapabilities(caller, sessionId, [capability])
  }
}
