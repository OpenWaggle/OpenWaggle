import { SessionId } from '@shared/types/brand'
import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { SessionControlRunLifecycleRepository } from '../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { requestHiveWorkerCleanup } from './hive-worker-cleanup-request'

const logger = createLogger('follow-up-edit-worker-settlement')

/** Queue changes that can end the wait on an edit without starting a Run. */
const QUEUE_CHANGES = new Set<SessionControlMutationRequest['command']['operation']>([
  'queue-withdraw',
  'queue-reorder',
  'queue-pause',
  'queue-resume',
  'queue-adopt',
  'queue-edit-save',
  'queue-edit-cancel',
])

/**
 * A Worker whose Run completed while its next Follow-up was out for an edit has its Delegation
 * settlement deferred (ADR 0043). When a queue change ends that wait without starting a Run (the
 * held Follow-up was withdrawn, or released into a paused queue), the deferred settlement runs
 * now, with the same publication and delivery as a Run settlement, so the Delegation cannot stay
 * `working` forever. The repository decides whether the wait is over.
 *
 * Runs inside the Worker's command serialization, after the queue change committed, so it never
 * fails the command: a failure is logged and the settlement stays deferred for the next queue
 * change or Run. Resolves whether a Hive cleanup pass is due, which the caller requests with
 * `requestHiveWorkerCleanup` only after leaving the serialization (an inline cleanup takes the
 * Worker's serialization itself, which is not reentrant).
 */
export function settleDeferredWorkerDelegationAfterQueueChange(
  request: SessionControlMutationRequest,
  response: SessionControlMutationResponse,
): Effect.Effect<
  boolean,
  never,
  SessionControlRunLifecycleRepository | SessionOrchestrationUpdateDeliveryService
> {
  if (
    response.outcome.effect === 'rejected' ||
    response.outcome.effect === 'started-run' ||
    !QUEUE_CHANGES.has(request.command.operation)
  ) {
    return Effect.succeed(false)
  }
  const sessionId = SessionId(request.command.sessionId)
  return Effect.gen(function* () {
    const lifecycle = yield* SessionControlRunLifecycleRepository
    if (!lifecycle.settleDeferredWorkerDelegation) return false
    const update = yield* lifecycle.settleDeferredWorkerDelegation({ sessionId })
    if (!update) return false
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
    return true
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (!Cause.isInterruptedOnly(cause)) {
          logger.warn('A Worker Delegation deferred by a Follow-up edit could not settle', {
            sessionId,
            operation: request.command.operation,
            cause: Cause.pretty(cause),
          })
        }
        return false
      }),
    ),
  )
}

/** Requests the Hive cleanup pass a deferred settlement made due; never fails the command. */
export function requestCleanupAfterDeferredWorkerSettlement(sessionId: string) {
  return requestHiveWorkerCleanup(SessionId(sessionId)).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (Cause.isInterruptedOnly(cause)) return
        logger.warn('Hive cleanup after a deferred Worker settlement failed', {
          sessionId,
          cause: Cause.pretty(cause),
        })
      }),
    ),
  )
}
