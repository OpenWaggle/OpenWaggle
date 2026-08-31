import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import { authorizeSessionCapabilities } from '../domain/session-control/session-capability-authorization'
import { requiredCapabilityForSessionEvent } from '../domain/session-control/session-event-capability'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import {
  authorizeTargetForCaller,
  refreshNamedProfileCaller,
  refreshNamedProfileCallerForEvent,
} from './local-session-derived-authority'

export function authorizeLocalSessionEvent(
  caller: LocalSessionCallerIdentity,
  event: SessionHostEventEnvelope,
) {
  if (!caller.profileAuthority) return Effect.succeed(true)
  return Effect.gen(function* () {
    const refreshedCaller = yield* refreshNamedProfileCallerForEvent(caller)
    const authority = refreshedCaller.profileAuthority
    if (!authority) return true
    const capability = requiredCapabilityForSessionEvent(event.payload)
    if (!authorizeSessionCapabilities(authority, [capability]).authorized) return false
    if (event.payload.kind === 'semantic-discovery-readiness-changed') return false
    const repository = yield* SessionAuthorizationTargetRepository
    const target = yield* repository.resolve(event.payload.sessionId)
    return authorizeTargetForCaller(refreshedCaller, target, [capability]).authorized
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))
}

export function authorizeLocalSessionActiveRun(
  caller: LocalSessionCallerIdentity,
  sessionId: string,
) {
  if (!caller.profileAuthority) return Effect.succeed(true)
  return Effect.gen(function* () {
    const refreshedCaller = yield* refreshNamedProfileCaller(caller)
    const authority = refreshedCaller.profileAuthority
    if (!authority) return true
    if (!authorizeSessionCapabilities(authority, ['sessions:read']).authorized) return false
    const repository = yield* SessionAuthorizationTargetRepository
    const target = yield* repository.resolve(sessionId)
    return authorizeTargetForCaller(refreshedCaller, target, ['sessions:read']).authorized
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))
}
