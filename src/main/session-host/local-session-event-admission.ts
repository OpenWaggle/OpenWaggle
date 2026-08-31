import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import type { AuthenticatedLocalSessionCaller } from './local-session-server'

export function createLocalSessionEventAdmissionFilter(
  resolveCaller: () => AuthenticatedLocalSessionCaller | null,
) {
  return (event: SessionHostEventEnvelope) => {
    const caller = resolveCaller()
    if (!caller) return false
    const authority = caller.profileAuthority
    if (!authority) return true
    const scope = caller.baseProfileScope ?? authority.scope
    if (scope.all) return event.payload.kind !== 'semantic-discovery-readiness-changed'
    const allowedSessionIds = new Set(caller.eventAdmissionSessionIds ?? scope.sessionIds ?? [])
    for (const derived of caller.derivedSessionAuthorities ?? []) {
      allowedSessionIds.add(derived.sessionId)
    }
    if (event.payload.kind === 'semantic-discovery-readiness-changed') return false
    return allowedSessionIds.has(event.payload.sessionId)
  }
}
