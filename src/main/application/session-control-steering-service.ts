import { matchBy } from '@diegogbrisa/ts-match'
import { RunId } from '@shared/types/brand'
import type {
  SessionControlMutationOutcome,
  SessionControlMutationResponse,
  SessionControlSteerMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import type { SessionControlFollowUp } from '../domain/session-control/message-aggregate'
import { planSteeringMessage } from '../domain/session-control/steering'
import { SessionControlOperationPendingError } from '../errors'
import { AgentSteeringService } from '../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import { releaseSessionControlAttachments } from './session-attachment-cleanup'

export interface SteerSessionRunInput {
  readonly callerId: string
  readonly request: SessionControlSteerMutationRequest
}

function response(
  request: SessionControlSteerMutationRequest,
  replayed: boolean,
  outcome: SessionControlMutationOutcome,
): SessionControlMutationResponse {
  return {
    contractVersion: request.contractVersion,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    replayed,
    outcome,
  }
}

/**
 * The Follow-up message this steer becomes if its Run stops before incorporating it: the
 * submitted intent and its caller. The Run's own execution profile applies when it is delivered.
 */
function returnableSteer(input: SteerSessionRunInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const followUpId = yield* identities.nextFollowUpId
    const acceptedAt = yield* identities.now
    const steeringInput = input.request.command.input
    return {
      id: followUpId,
      deliveryState: 'pending',
      intent: {
        text: steeringInput.text,
        attachmentIds: steeringInput.attachmentIds,
        ...(steeringInput.visualizationContext
          ? { visualizationContext: steeringInput.visualizationContext }
          : {}),
        callerId: input.callerId,
        acceptedAt,
        idempotencyKey: input.request.idempotencyKey,
      },
    } satisfies SessionControlFollowUp
  })
}

export function steerSessionRun(input: SteerSessionRunInput) {
  return Effect.gen(function* () {
    const journal = yield* SessionControlOperationJournal
    const claim = yield* journal.claim({
      callerId: input.callerId,
      request: input.request,
      decide: (state) => {
        const plan = planSteeringMessage({
          requestedRunId: RunId(input.request.command.expectedRunId),
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
        })
        return plan.accepted
          ? { accepted: true }
          : {
              accepted: false,
              outcome: {
                operation: 'steer',
                effect: 'rejected',
                sessionId: state.sessionId,
                code: plan.code,
              },
            }
      },
    })

    if (claim.status === 'completed') {
      return response(input.request, claim.replayed, claim.outcome)
    }
    if (claim.status === 'pending') {
      return yield* Effect.fail(
        new SessionControlOperationPendingError({
          operation: 'steer',
          sessionId: input.request.command.sessionId,
          idempotencyKey: input.request.idempotencyKey,
        }),
      )
    }

    const attachments = yield* SessionControlAttachmentService.pipe(
      Effect.flatMap((service) =>
        service.resolve({
          attachmentIds: input.request.command.input.attachmentIds,
          sessionId: input.request.command.sessionId,
          ownerCallerId: input.callerId,
        }),
      ),
      Effect.either,
    )
    const returnable = yield* returnableSteer(input)
    const steering =
      attachments._tag === 'Left'
        ? ({ accepted: false, code: 'attachment_resolution_failed' } as const)
        : yield* AgentSteeringService.pipe(
            Effect.flatMap((service) =>
              service.steer({
                runId: input.request.command.expectedRunId,
                text: input.request.command.input.text,
                attachments: attachments.right,
                ...(input.request.command.input.visualizationContext
                  ? { visualizationContext: input.request.command.input.visualizationContext }
                  : {}),
                delivery: { kind: 'steer', followUp: returnable },
              }),
            ),
            Effect.catchAll(() =>
              Effect.succeed({ accepted: false, code: 'steering_failed' } as const),
            ),
          )
    const outcome: SessionControlMutationOutcome = steering.accepted
      ? {
          operation: 'steer',
          effect: 'steered-run',
          receipt: steering.receipt,
          sessionId: input.request.command.sessionId,
          runId: input.request.command.expectedRunId,
          stateRevision: claim.stateRevision,
        }
      : {
          operation: 'steer',
          effect: 'rejected',
          sessionId: input.request.command.sessionId,
          code: steering.code,
        }
    yield* journal.complete({ callerId: input.callerId, request: input.request, outcome })
    // A queued steer keeps its attachments while its Run is live: if the Run stops before Pi
    // incorporates it, it returns to the Follow-up queue with them. They stay referenced by this
    // completed operation until the Run settles, then ordinary cleanup removes delivered ones.
    if (steering.accepted && steering.receipt.delivery !== 'queued') {
      yield* releaseSessionControlAttachments({
        attachmentIds: input.request.command.input.attachmentIds,
        sessionId: input.request.command.sessionId,
        ownerCallerId: input.callerId,
      })
    }
    return response(input.request, false, outcome)
  })
}
