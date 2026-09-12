import { SessionId } from '@shared/types/brand'
import type {
  SessionControlMutationOutcome,
  SessionControlMutationResponse,
  SessionInteractionResponseMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlOperationPendingError } from '../errors'
import { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import { submitAgentLoopInteractionResponse } from './agent-loop-interaction-broker'

function response(
  request: SessionInteractionResponseMutationRequest,
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

export function respondToSessionInteraction(input: {
  readonly callerId: string
  readonly request: SessionInteractionResponseMutationRequest
}) {
  return Effect.gen(function* () {
    const journal = yield* SessionControlOperationJournal
    const claim = yield* journal.claim({
      callerId: input.callerId,
      request: input.request,
      decide: () => ({ accepted: true }),
    })
    if (claim.status === 'completed') {
      return response(input.request, claim.replayed, claim.outcome)
    }
    if (claim.status === 'pending') {
      return yield* Effect.fail(
        new SessionControlOperationPendingError({
          operation: input.request.command.operation,
          sessionId: input.request.command.sessionId,
          idempotencyKey: input.request.idempotencyKey,
        }),
      )
    }

    const command = input.request.command
    const submission = submitAgentLoopInteractionResponse(
      {
        sessionId: SessionId(command.sessionId),
        runId: command.runId,
        interactionId: command.interactionId,
        kind: command.kind,
        response: command.response,
      },
      command.operation === 'approval-respond' ? 'approval' : 'response',
    )
    const outcome: SessionControlMutationOutcome = submission.ok
      ? {
          operation: command.operation,
          effect: 'interaction-resolved',
          sessionId: command.sessionId,
          runId: command.runId,
          interactionId: submission.interactionId,
          status: submission.status,
        }
      : {
          operation: command.operation,
          effect: 'rejected',
          sessionId: command.sessionId,
          code: submission.error.code,
        }
    yield* journal.complete({ callerId: input.callerId, request: input.request, outcome })
    return response(input.request, false, outcome)
  })
}
