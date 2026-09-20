import { SessionId } from '@shared/types/brand'
import type {
  SessionAuthorizationSetMutationRequest,
  SessionControlMutationOutcome,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlOperationPendingError } from '../errors'
import { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { resolveEffectiveAuthorizationMode } from './agent-authorization-mode'
import { grantPendingAuthorizationsForSession } from './agent-loop-authorization-grants'

function response(
  request: SessionAuthorizationSetMutationRequest,
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

export function setSessionAuthorization(input: {
  readonly callerId: string
  readonly request: SessionAuthorizationSetMutationRequest
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
          operation: 'authorization-set',
          sessionId: input.request.command.sessionId,
          idempotencyKey: input.request.idempotencyKey,
        }),
      )
    }

    const sessionId = SessionId(input.request.command.sessionId)
    const repository = yield* SessionProjectionRepository
    yield* repository.setAuthorizationMode(sessionId, input.request.command.authorizationMode)
    const effectiveAuthorizationMode = yield* Effect.promise(() =>
      resolveEffectiveAuthorizationMode(sessionId),
    )
    if (effectiveAuthorizationMode === 'yolo') {
      yield* Effect.sync(() => grantPendingAuthorizationsForSession({ sessionId }))
    }
    const outcome: SessionControlMutationOutcome = {
      operation: 'authorization-set',
      effect: 'authorization-updated',
      sessionId,
      authorizationMode: input.request.command.authorizationMode,
      effectiveAuthorizationMode,
    }
    yield* journal.complete({ callerId: input.callerId, request: input.request, outcome })
    return response(input.request, false, outcome)
  })
}
