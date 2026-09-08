import { matchBy } from '@diegogbrisa/ts-match'
import { FollowUpId, RunId } from '@shared/types/brand'
import type {
  SessionControlMutationOutcome,
  SessionControlMutationResponse,
  SessionControlPromoteMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import {
  applyAcceptedFollowUpPromotion,
  planFollowUpPromotion,
} from '../domain/session-control/follow-up-promotion'
import type { SessionControlIntentSnapshot } from '../domain/session-control/message-aggregate'
import { SessionControlOperationPendingError } from '../errors'
import { type AgentSteeringInput, AgentSteeringService } from '../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import {
  preserveOutcomeAfterAttachmentCleanup,
  releaseSessionControlAttachments,
} from './session-attachment-cleanup'
import { fenceFailedClaimedSessionOperation } from './session-control-claimed-operation-recovery'

export interface PromoteSessionFollowUpInput {
  readonly callerId: string
  readonly request: SessionControlPromoteMutationRequest
}

function releasePromotedAttachments(input: {
  readonly attachmentIds: readonly string[]
  readonly sessionId: string
  readonly ownerCallerId: string
}) {
  return releaseSessionControlAttachments(input)
}

function promotedSteeringInput(
  runId: string,
  intent: SessionControlIntentSnapshot,
  attachments: AgentSteeringInput['attachments'],
): AgentSteeringInput {
  return {
    runId,
    text: intent.text,
    attachments,
    ...(intent.visualizationContext ? { visualizationContext: intent.visualizationContext } : {}),
  }
}

function response(
  input: PromoteSessionFollowUpInput,
  replayed: boolean,
  outcome: SessionControlMutationOutcome,
): SessionControlMutationResponse {
  return {
    contractVersion: input.request.contractVersion,
    requestId: input.request.requestId,
    idempotencyKey: input.request.idempotencyKey,
    replayed,
    outcome,
  }
}

function completeClaimedPromotion(input: {
  readonly operation: PromoteSessionFollowUpInput
  readonly expectedRunId: RunId
  readonly followUpId: FollowUpId
  readonly intent: SessionControlIntentSnapshot
  readonly queueRevision: number
  readonly stateRevision: number
}) {
  return Effect.gen(function* () {
    const journal = yield* SessionControlOperationJournal
    const attachments = yield* SessionControlAttachmentService.pipe(
      Effect.flatMap((service) =>
        service.resolve({
          attachmentIds: input.intent.attachmentIds,
          sessionId: input.operation.request.command.sessionId,
          ownerCallerId: input.intent.callerId,
        }),
      ),
      Effect.either,
    )
    const steering =
      attachments._tag === 'Left'
        ? ({ accepted: false, code: 'attachment_resolution_failed' } as const)
        : yield* AgentSteeringService.pipe(
            Effect.flatMap((service) =>
              service.steer(
                promotedSteeringInput(input.expectedRunId, input.intent, attachments.right),
              ),
            ),
            Effect.catchAll(() =>
              Effect.succeed({ accepted: false, code: 'steering_failed' } as const),
            ),
          )
    const outcome: SessionControlMutationOutcome = steering.accepted
      ? {
          operation: 'promote',
          effect: 'promoted-follow-up',
          sessionId: input.operation.request.command.sessionId,
          runId: input.expectedRunId,
          followUpId: input.followUpId,
          queueRevision: input.queueRevision + 1,
          stateRevision: input.stateRevision + 1,
        }
      : {
          operation: 'promote',
          effect: 'rejected',
          sessionId: input.operation.request.command.sessionId,
          code: steering.code,
        }
    yield* journal.complete({
      callerId: input.operation.callerId,
      request: input.operation.request,
      outcome,
      ...(steering.accepted
        ? {
            finalizeState: (state) =>
              applyAcceptedFollowUpPromotion(state, input.expectedRunId, input.followUpId),
          }
        : {}),
    })
    const completedResponse = response(input.operation, false, outcome)
    return steering.accepted
      ? yield* preserveOutcomeAfterAttachmentCleanup({
          effect: Effect.succeed(completedResponse),
          cleanup: releasePromotedAttachments({
            attachmentIds: input.intent.attachmentIds,
            sessionId: input.operation.request.command.sessionId,
            ownerCallerId: input.intent.callerId,
          }),
          operation: 'promotion',
          sessionId: input.operation.request.command.sessionId,
        })
      : completedResponse
  })
}

export function promoteSessionFollowUp(input: PromoteSessionFollowUpInput) {
  return Effect.gen(function* () {
    const journal = yield* SessionControlOperationJournal
    const expectedRunId = RunId(input.request.command.expectedRunId)
    const followUpId = FollowUpId(input.request.command.followUpId)
    let intent: SessionControlIntentSnapshot | undefined
    let queueRevision = 0
    const claim = yield* journal.claim({
      callerId: input.callerId,
      request: input.request,
      decide: (state) => {
        const plan = planFollowUpPromotion({
          requestedRunId: expectedRunId,
          followUpId,
          run: matchBy(state.run, 'state')
            .with('idle', () => ({ state: 'idle' }) as const)
            .with('starting', (run) => ({
              state: 'active',
              runId: run.runId,
              acceptsSteering: false,
            }))
            .with('active', (run) => ({
              state: 'active',
              runId: run.runId,
              acceptsSteering: true,
            }))
            .with('stopping', (run) => ({ state: 'stopping', runId: run.runId }))
            .exhaustive(),
          followUpQueue: { items: state.followUpQueue.items.map((item) => item.id) },
        })
        if (!plan.accepted) {
          return {
            accepted: false,
            outcome: {
              operation: 'promote',
              effect: 'rejected',
              sessionId: state.sessionId,
              code: plan.code,
            },
          }
        }
        intent = state.followUpQueue.items.find((item) => item.id === followUpId)?.intent
        queueRevision = state.followUpQueue.revision
        return { accepted: true }
      },
    })
    if (claim.status === 'completed') return response(input, claim.replayed, claim.outcome)
    if (claim.status === 'pending') {
      return yield* Effect.fail(
        new SessionControlOperationPendingError({
          operation: 'promote',
          sessionId: input.request.command.sessionId,
          idempotencyKey: input.request.idempotencyKey,
        }),
      )
    }
    if (!intent) {
      yield* fenceFailedClaimedSessionOperation(input.request.command.sessionId)
      return yield* Effect.fail(new Error('Claimed Follow-up has no durable intent.'))
    }
    return yield* completeClaimedPromotion({
      operation: input,
      expectedRunId,
      followUpId,
      intent,
      queueRevision,
      stateRevision: claim.stateRevision,
    }).pipe(
      Effect.onError(() => fenceFailedClaimedSessionOperation(input.request.command.sessionId)),
    )
  })
}
