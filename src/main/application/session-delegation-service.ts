import { SessionId } from '@shared/types/brand'
import type {
  SessionControlDelegationMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import {
  isLocalUserCallerId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import { isHiveAgentCaller } from '../ports/hive-worker-cleanup-repository'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import { SessionDelegationRepository } from '../ports/session-delegation-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import { notifyParentOfOrchestrationUpdates } from './hive-parent-wake-request'
import {
  requestHiveWorkerCleanup,
  restoreHiveWorkerAfterDelegationReview,
} from './hive-worker-cleanup-request'

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

/**
 * The parent of a Worker that just submitted a result or asked for help itself: the Delegation
 * repository recorded an orchestration update for it, which a running parent receives now and an
 * idle one through a Hive wake.
 */
function notifiedParentForWorkerChange(response: SessionControlMutationResponse) {
  const outcome = response.outcome
  if (response.replayed || outcome.effect !== 'delegation-updated') return undefined
  const notifies =
    outcome.operation === 'delegation-submit' ||
    (outcome.operation === 'delegation-state' && outcome.delegationState === 'needs_attention')
  return notifies
    ? { parentSessionId: outcome.parentSessionId, workerSessionId: outcome.workerSessionId }
    : undefined
}

/**
 * Whether this caller's change may wake the parent: the Worker's own agent, or the desktop user.
 * A CLI client profile may contribute to a Worker's Delegation without any right to start Runs
 * on its parent, so its change reaches a running parent and waits for the next Run otherwise.
 */
function mayWakeParent(callerId: string, workerSessionId: string) {
  return (
    isLocalUserCallerId(callerId) ||
    parseSessionAgentCallerId(callerId)?.sessionId === workerSessionId
  )
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
    // A reopen or revision request sends a cleanup-archived Worker back to work: show it again.
    yield* restoreHiveWorkerAfterDelegationReview({
      callerId: input.callerId,
      request: input.request,
      response,
    })
    const notified = notifiedParentForWorkerChange(response)
    if (notified) {
      yield* mayWakeParent(input.callerId, notified.workerSessionId)
        ? notifyParentOfOrchestrationUpdates(notified.parentSessionId)
        : delivery
            .deliverPendingToActiveRun({ parentSessionId: notified.parentSessionId })
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
