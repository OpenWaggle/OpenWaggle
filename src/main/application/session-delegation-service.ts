import type {
  SessionControlDelegationMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import { SessionDelegationRepository } from '../ports/session-delegation-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'

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
    return response
  })
}
