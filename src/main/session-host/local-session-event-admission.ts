import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { authorizeSessionCapabilities } from '../domain/session-control/session-capability-authorization'
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
    const baseCapability = authorizeSessionCapabilities(authority, [capability]).authorized
    const derivedCapability = caller.derivedSessionAuthorities?.some(
      (derived) => derived.sessionId === sessionId && derived.capabilities.includes(capability),
    )
    if (!baseCapability && !derivedCapability) return false
    const scope = caller.baseProfileScope ?? authority.scope
    if (scope.all) return true
    const allowedSessionIds = new Set(caller.eventAdmissionSessionIds ?? scope.sessionIds ?? [])
    for (const derived of caller.derivedSessionAuthorities ?? []) {
      allowedSessionIds.add(derived.sessionId)
    }
    return allowedSessionIds.has(sessionId)
  }
}
