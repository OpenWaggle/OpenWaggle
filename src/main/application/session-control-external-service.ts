import { RunId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type {
  SessionControlInterruptDescendantsMutationRequest,
  SessionControlInterruptMutationRequest,
  SessionControlMutationOutcome,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import {
  applyRunInterruption,
  releaseRejectedRunInterruption,
} from '../domain/session-control/run-interruption'
import { SessionControlOperationPendingError } from '../errors'
import { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import { SessionDescendantRunRepository } from '../ports/session-descendant-run-repository'
import { authorizeDescendantInterruptionSnapshot } from './session-control-descendant-authorization'
import {
  interruptRunWithBoundedSettlement,
  requestRunInterruption,
} from './session-control-interruption-settlement'

const DESCENDANT_INTERRUPTION_CONCURRENCY = 8

export interface InterruptSessionRunInput {
  readonly callerId: string
  readonly request: SessionControlInterruptMutationRequest
  readonly requestOnly?: boolean
}

function response(
  request:
    | SessionControlInterruptMutationRequest
    | SessionControlInterruptDescendantsMutationRequest,
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

export function interruptSessionDescendants(input: {
  readonly callerId: string
  readonly caller?: LocalSessionCallerIdentity
  readonly request: SessionControlInterruptDescendantsMutationRequest
}) {
  return Effect.gen(function* () {
    const descendants = yield* SessionDescendantRunRepository.pipe(
      Effect.flatMap((repository) =>
        repository.listActive({ ancestorSessionId: input.request.command.sessionId }),
      ),
    )
    yield* authorizeDescendantInterruptionSnapshot({
      ...(input.caller ? { caller: input.caller } : {}),
      ancestorSessionId: input.request.command.sessionId,
      descendants,
    })
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
          operation: 'interrupt-descendants',
          sessionId: input.request.command.sessionId,
          idempotencyKey: input.request.idempotencyKey,
        }),
      )
    }

    const children = yield* Effect.forEach(
      descendants,
      (descendant) =>
        interruptSessionRun({
          callerId: input.callerId,
          requestOnly: true,
          request: {
            contractVersion: input.request.contractVersion,
            requestId: `${input.request.requestId}:${descendant.sessionId}`,
            idempotencyKey: `${input.request.idempotencyKey}:descendant:${descendant.runId}`,
            command: {
              operation: 'interrupt',
              sessionId: descendant.sessionId,
              expectedRunId: descendant.runId,
            },
          },
        }),
      { concurrency: DESCENDANT_INTERRUPTION_CONCURRENCY },
    )
    const interrupted = children.flatMap((child) =>
      child.outcome.effect === 'interruption-requested'
        ? [
            {
              sessionId: child.outcome.sessionId,
              runId: child.outcome.runId,
              stateRevision: child.outcome.stateRevision,
            },
          ]
        : [],
    )
    const outcome: SessionControlMutationOutcome = {
      operation: 'interrupt-descendants',
      effect: 'descendant-interruptions-requested',
      sessionId: input.request.command.sessionId,
      interrupted,
      stateRevision: claim.stateRevision,
    }
    yield* journal.complete({ callerId: input.callerId, request: input.request, outcome })
    return response(input.request, false, outcome)
  })
}

export function interruptSessionRun(input: InterruptSessionRunInput) {
  return Effect.gen(function* () {
    const journal = yield* SessionControlOperationJournal
    const expectedRunId = RunId(input.request.command.expectedRunId)
    const claim = yield* journal.claim({
      callerId: input.callerId,
      request: input.request,
      decide: (state) => {
        const result = applyRunInterruption({ state, expectedRunId })
        return result.accepted
          ? { accepted: true, state: result.state }
          : {
              accepted: false,
              outcome: {
                operation: 'interrupt',
                effect: 'rejected',
                sessionId: state.sessionId,
                code: result.code,
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
          operation: 'interrupt',
          sessionId: input.request.command.sessionId,
          idempotencyKey: input.request.idempotencyKey,
        }),
      )
    }

    const target = {
      sessionId: input.request.command.sessionId,
      runId: input.request.command.expectedRunId,
    }
    const interruption = yield* input.requestOnly
      ? requestRunInterruption(target)
      : interruptRunWithBoundedSettlement(target)
    const outcome: SessionControlMutationOutcome = interruption.accepted
      ? {
          operation: 'interrupt',
          effect: 'interruption-requested',
          sessionId: input.request.command.sessionId,
          runId: input.request.command.expectedRunId,
          stateRevision: claim.stateRevision,
        }
      : {
          operation: 'interrupt',
          effect: 'rejected',
          sessionId: input.request.command.sessionId,
          code: interruption.code,
        }
    yield* journal.complete({
      callerId: input.callerId,
      request: input.request,
      outcome,
      ...(interruption.accepted
        ? {}
        : {
            finalizeState: (state) => releaseRejectedRunInterruption(state, expectedRunId),
          }),
    })
    return response(input.request, false, outcome)
  })
}
