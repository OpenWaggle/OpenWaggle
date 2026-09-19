import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import { snapshotAuthorizesSessionCapabilities } from '../domain/session-control/session-capability-authorization'
import { requiredCapabilityForSessionEvent } from '../domain/session-control/session-event-capability'

export function authorizeLocalSessionEvent(
  caller: LocalSessionCallerIdentity,
  event: SessionHostEventEnvelope,
) {
  if (!caller.profileAuthority) return Effect.succeed(true)
  if (event.payload.kind === 'semantic-discovery-readiness-changed') return Effect.succeed(false)
  const capability = requiredCapabilityForSessionEvent(event.payload)
  return Effect.succeed(
    snapshotAuthorizesSessionCapabilities(caller, event.payload.sessionId, [capability]),
  )
}

export function authorizeLocalSessionActiveRun(
  caller: LocalSessionCallerIdentity,
  sessionId: string,
) {
  return Effect.succeed(snapshotAuthorizesSessionCapabilities(caller, sessionId, ['sessions:read']))
}
