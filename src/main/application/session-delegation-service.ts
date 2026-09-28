import { SessionId } from '@shared/types/brand'
import type {
  SessionControlDelegationMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { isHiveAgentCaller } from '../ports/hive-worker-cleanup-repository'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import { SessionDelegationRepository } from '../ports/session-delegation-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import { requestHiveWorkerCleanup } from './hive-worker-cleanup-request'

function specificationUpdateWorker(response: SessionControlMutationResponse) {
  const outcome = response.outcome
  if (
    outcome.effect === 'delegation-dependencies-updated' ||
    outcome.effect === 'delegation-specification-amended'
  ) {
    return outcome.workerSessionId
  }
  return outcome.effect === 'delegation-updated' && outcome.specificationChanged
    ? outcome.workerSessionId
    : undefined
}

/**
 * The parent Session of a Delegation an agent just accepted or cancelled. A user's review is
 * interaction, so it never triggers cleanup (and the eligibility query keeps that Worker).
 */
function cleanupParentForTerminalDelegation(
  callerId: string,
  response: SessionControlMutationResponse,
) {
  const outcome = response.outcome
  if (!isHiveAgentCaller(callerId)) return undefined
  if (response.replayed || outcome.effect !== 'delegation-updated') return undefined
  return outcome.delegationState === 'accepted' || outcome.delegationState === 'cancelled'
    ? outcome.parentSessionId
    : undefined
}

export function executeSessionDelegationMutation(input: {
  readonly callerId: string
  readonly request: SessionControlDelegationMutationRequest
}) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const repository = yield* SessionDelegationRepository
    const delivery = yield* SessionOrchestrationUpdateDeliveryService
    const response = (yield* repository.execute({
      callerId: input.callerId,
      request: input.request,
      now: yield* identities.now,
    })) satisfies SessionControlMutationResponse
    const workerSessionId = specificationUpdateWorker(response)
    if (workerSessionId && !response.replayed) {
      yield* delivery
        .deliverPendingSpecificationsToActiveRun({ workerSessionId })
        .pipe(Effect.catchAll(() => Effect.succeed(false)))
    }
    const parentSessionId = cleanupParentForTerminalDelegation(input.callerId, response)
    if (parentSessionId) {
      // Hive cleanup trigger: the parent agent accepted or cancelled a Worker's Delegation. A
      // pass for the parent examines that Worker as one of its direct Workers, and the parent
      // itself as a Worker: a nested parent may have waited only for this Delegation to finish.
      yield* requestHiveWorkerCleanup(SessionId(parentSessionId))
    }
    return response
  })
}
