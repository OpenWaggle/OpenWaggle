import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { RunId } from '@shared/types/brand'
import type {
  SessionControlMutationOutcome,
  SessionControlMutationResponse,
  SessionControlReplaceMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import {
  applyRunInterruption,
  releaseRejectedRunInterruption,
} from '../domain/session-control/run-interruption'
import { startClaimedReplacement } from '../domain/session-control/run-replacement'
import { SessionControlOperationPendingError } from '../errors'
import { AgentRunInterruptionService } from '../ports/agent-run-interruption-service'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import { clampRunAuthorizationOverride } from './session-control-run-authorization'

export interface ReplaceSessionRunInput {
  readonly callerId: string
  readonly callerAuthorizationCeiling?: AgentAuthorizationMode
  readonly request: SessionControlReplaceMutationRequest
}

function response(
  input: ReplaceSessionRunInput,
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

export function replaceSessionRun(input: ReplaceSessionRunInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const journal = yield* SessionControlOperationJournal
    const interruptedRunId = RunId(input.request.command.expectedRunId)
    const replacementRunId = yield* identities.nextRunId
    const acceptedAt = yield* identities.now
    const replacementIntent = {
      ...input.request.command.input,
      ...(clampRunAuthorizationOverride(
        input.request.command.runAuthorizationOverride,
        input.callerAuthorizationCeiling,
      )
        ? {
            runAuthorizationOverride: clampRunAuthorizationOverride(
              input.request.command.runAuthorizationOverride,
              input.callerAuthorizationCeiling,
            ),
          }
        : {}),
      callerId: input.callerId,
      acceptedAt,
      idempotencyKey: input.request.idempotencyKey,
    }
    const claim = yield* journal.claim({
      callerId: input.callerId,
      request: input.request,
      decide: (state) => {
        const interruption = applyRunInterruption({
          state,
          expectedRunId: interruptedRunId,
        })
        return interruption.accepted
          ? { accepted: true, state: interruption.state }
          : {
              accepted: false,
              outcome: {
                operation: 'replace',
                effect: 'rejected',
                sessionId: state.sessionId,
                code: interruption.code,
              },
            }
      },
    })

    if (claim.status === 'completed') return response(input, claim.replayed, claim.outcome)
    if (claim.status === 'pending') {
      return yield* Effect.fail(
        new SessionControlOperationPendingError({
          operation: 'replace',
          sessionId: input.request.command.sessionId,
          idempotencyKey: input.request.idempotencyKey,
        }),
      )
    }

    const interruption = yield* AgentRunInterruptionService.pipe(
      Effect.flatMap((service) =>
        service.interrupt({
          sessionId: input.request.command.sessionId,
          runId: interruptedRunId,
        }),
      ),
    )
    const outcome: SessionControlMutationOutcome = interruption.accepted
      ? {
          operation: 'replace',
          effect: 'replaced-run',
          sessionId: input.request.command.sessionId,
          interruptedRunId,
          runId: replacementRunId,
          stateRevision: claim.stateRevision + 1,
        }
      : {
          operation: 'replace',
          effect: 'rejected',
          sessionId: input.request.command.sessionId,
          code: interruption.code,
        }
    yield* journal.complete({
      callerId: input.callerId,
      request: input.request,
      outcome,
      finalizeState: interruption.accepted
        ? (state) =>
            startClaimedReplacement(state, interruptedRunId, replacementRunId, replacementIntent)
        : (state) => releaseRejectedRunInterruption(state, interruptedRunId),
    })
    return response(input, false, outcome)
  })
}
