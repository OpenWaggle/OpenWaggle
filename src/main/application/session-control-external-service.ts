import { matchBy } from '@diegogbrisa/ts-match'
import { RunId } from '@shared/types/brand'
import type {
  SessionControlInterruptDescendantsMutationRequest,
  SessionControlInterruptMutationRequest,
  SessionControlMutationOutcome,
  SessionControlMutationResponse,
  SessionControlSteerMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import {
  applyRunInterruption,
  releaseRejectedRunInterruption,
} from '../domain/session-control/run-interruption'
import { planSteeringMessage } from '../domain/session-control/steering'
import { SessionControlOperationPendingError } from '../errors'
import { AgentRunInterruptionService } from '../ports/agent-run-interruption-service'
import { AgentSteeringService } from '../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import { SessionDescendantRunRepository } from '../ports/session-descendant-run-repository'

export interface SteerSessionRunInput {
  readonly callerId: string
  readonly request: SessionControlSteerMutationRequest
}

export interface InterruptSessionRunInput {
  readonly callerId: string
  readonly request: SessionControlInterruptMutationRequest
}

function response(
  request:
    | SessionControlSteerMutationRequest
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
  readonly request: SessionControlInterruptDescendantsMutationRequest
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
          operation: 'interrupt-descendants',
          sessionId: input.request.command.sessionId,
          idempotencyKey: input.request.idempotencyKey,
        }),
      )
    }

    const descendants = yield* SessionDescendantRunRepository.pipe(
      Effect.flatMap((repository) =>
        repository.listActive({ ancestorSessionId: input.request.command.sessionId }),
      ),
    )
    const interrupted: Array<{
      readonly sessionId: string
      readonly runId: string
      readonly stateRevision: number
    }> = []
    for (const descendant of descendants) {
      const child = yield* interruptSessionRun({
        callerId: input.callerId,
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
      })
      if (child.outcome.effect === 'interruption-requested') {
        interrupted.push({
          sessionId: descendant.sessionId,
          runId: descendant.runId,
          stateRevision: child.outcome.stateRevision,
        })
      }
    }
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
    const steering =
      attachments._tag === 'Left'
        ? ({ accepted: false, code: 'attachment_resolution_failed' } as const)
        : yield* AgentSteeringService.pipe(
            Effect.flatMap((service) =>
              service.steer({
                runId: input.request.command.expectedRunId,
                text: input.request.command.input.text,
                attachments: attachments.right,
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
    if (steering.accepted) {
      yield* SessionControlAttachmentService.pipe(
        Effect.flatMap((service) =>
          service.release({
            attachmentIds: input.request.command.input.attachmentIds,
            sessionId: input.request.command.sessionId,
            ownerCallerId: input.callerId,
          }),
        ),
      )
    }
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

    const interruption = yield* AgentRunInterruptionService.pipe(
      Effect.flatMap((service) =>
        service.interrupt({
          sessionId: input.request.command.sessionId,
          runId: input.request.command.expectedRunId,
        }),
      ),
    )
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
