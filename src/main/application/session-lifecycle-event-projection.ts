import type { SessionLifecycleResponse } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { refreshLocalSessionProfileAdmissions } from '../session-host/local-session-profile-invalidation'
import { publishSessionHostEvent } from '../session-host/session-host-events'

export function publishLifecycleResponse(response: SessionLifecycleResponse) {
  if (response.replayed || response.outcome.effect === 'rejected') return
  publishSessionHostEvent({
    kind: 'session-list-changed',
    sessionId: response.outcome.sessionId,
    change: 'created',
  })
  publishSessionHostEvent({
    kind: 'session-state-changed',
    sessionId: response.outcome.sessionId,
    stateRevision:
      response.outcome.effect === 'created-root' || response.outcome.effect === 'forked-session'
        ? 0
        : 1,
    operation: response.outcome.operation,
  })
}

export function refreshAdmissionBeforeStartedLifecycleProjection(
  response: SessionLifecycleResponse,
) {
  if (
    response.replayed ||
    (response.outcome.effect !== 'launched-root' && response.outcome.effect !== 'spawned-worker')
  ) {
    return Effect.void
  }
  return Effect.promise(() => refreshLocalSessionProfileAdmissions())
}

export function refreshAdmissionBeforeIdleLifecycleProjection(response: SessionLifecycleResponse) {
  if (
    response.replayed ||
    (response.outcome.effect !== 'created-root' && response.outcome.effect !== 'forked-session')
  ) {
    return Effect.void
  }
  return Effect.promise(() => refreshLocalSessionProfileAdmissions())
}
