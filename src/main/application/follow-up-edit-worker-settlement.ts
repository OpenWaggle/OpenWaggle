import { SessionId } from '@shared/types/brand'
import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlRunLifecycleRepository } from '../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { requestHiveWorkerCleanup } from './hive-worker-cleanup-request'

/** Queue changes that can end the wait on an edit without starting a Run. */
const QUEUE_CHANGES = new Set<SessionControlMutationRequest['command']['operation']>([
  'queue-withdraw',
  'queue-reorder',
  'queue-pause',
  'queue-resume',
  'queue-update-authorization',
  'queue-edit-save',
  'queue-edit-cancel',
])

/**
 * A Worker whose Run completed while its next Follow-up was out for an edit has its Delegation
 * settlement deferred (ADR 0043). When a queue change ends that wait without starting a Run (the
 * held Follow-up was withdrawn, or released into a paused queue), the deferred settlement runs
 * now, with the same publication and delivery as a Run settlement, so the Delegation cannot stay
 * `working` forever. The repository decides whether the wait is over.
 */
export function settleDeferredWorkerDelegationAfterQueueChange(
  request: SessionControlMutationRequest,
  response: SessionControlMutationResponse,
) {
  if (
    response.outcome.effect === 'rejected' ||
    response.outcome.effect === 'started-run' ||
    !QUEUE_CHANGES.has(request.command.operation)
  ) {
    return Effect.void
  }
  const sessionId = SessionId(request.command.sessionId)
  return Effect.gen(function* () {
    const lifecycle = yield* SessionControlRunLifecycleRepository
    if (!lifecycle.settleDeferredWorkerDelegation) return
    const update = yield* lifecycle.settleDeferredWorkerDelegation({ sessionId })
    if (!update) return
    if (update.delegationUpdate) {
      publishSessionHostEvent({
        kind: 'session-list-changed',
        sessionId: update.delegationUpdate.parentSessionId,
        change: 'updated',
      })
    }
    if (update.orchestrationUpdate) {
      const delivery = yield* SessionOrchestrationUpdateDeliveryService
      yield* delivery.deliverPendingToActiveRun({
        parentSessionId: update.orchestrationUpdate.parentSessionId,
      })
    }
    yield* requestHiveWorkerCleanup(sessionId)
  })
}
