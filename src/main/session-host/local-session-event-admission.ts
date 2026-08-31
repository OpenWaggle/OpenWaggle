import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { snapshotAuthorizesSessionCapabilities } from '../domain/session-control/session-capability-authorization'
import { requiredCapabilityForSessionEvent } from '../domain/session-control/session-event-capability'
import type { AuthenticatedLocalSessionCaller } from './local-session-server'

export function createLocalSessionEventAdmissionFilter(
  resolveCaller: () => AuthenticatedLocalSessionCaller | null,
) {
  return (event: SessionHostEventEnvelope) => {
    const caller = resolveCaller()
    if (!caller) return false
    const authority = caller.profileAuthority
    if (!authority) return true
    if (event.payload.kind === 'semantic-discovery-readiness-changed') return false
    const sessionId = event.payload.sessionId
    const capability = requiredCapabilityForSessionEvent(event.payload)
    return snapshotAuthorizesSessionCapabilities(caller, sessionId, [capability])
  }
}
