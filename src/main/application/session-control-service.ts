import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { FollowUpId } from '@shared/types/brand'
import type {
  SessionControlFollowUpMutationRequest,
  SessionControlMessageMutationRequest,
  SessionControlMutationResponse,
  SessionControlQueueMutationRequest,
  SessionControlStartMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { applyExplicitFollowUp } from '../domain/session-control/explicit-follow-up'
import { applyAdaptiveMessage } from '../domain/session-control/message-aggregate'
import {
  applyQueueMutation,
  type SessionControlQueueMutation,
} from '../domain/session-control/queue-aggregate'
import { applyRunStart } from '../domain/session-control/run-start'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import { SessionControlRepository } from '../ports/session-control-repository'
import { clampRunAuthorizationOverride } from './session-control-run-authorization'

export interface SubmitSessionMessageInput {
  readonly callerId: string
  readonly callerAuthorizationCeiling?: AgentAuthorizationMode
  readonly hostRunCeiling?: number
  readonly request: SessionControlMessageMutationRequest
}

export interface StartSessionRunInput {
  readonly callerId: string
  readonly callerAuthorizationCeiling?: AgentAuthorizationMode
  readonly hostRunCeiling?: number
  readonly request: SessionControlStartMutationRequest
}

export interface QueueSessionFollowUpInput {
  readonly callerId: string
  readonly callerAuthorizationCeiling?: AgentAuthorizationMode
  readonly request: SessionControlFollowUpMutationRequest
}

export interface MutateSessionQueueInput {
  readonly callerId: string
  readonly callerAuthorizationCeiling?: AgentAuthorizationMode
  readonly hostRunCeiling?: number
  readonly request: SessionControlQueueMutationRequest
}

function toQueueMutation(
  command: SessionControlQueueMutationRequest['command'],
  callerId: string,
): SessionControlQueueMutation {
  return matchBy(command, 'operation')
    .with('queue-withdraw', (withdraw) => ({
      type: 'withdraw',
      followUpIds: withdraw.followUpIds.map(FollowUpId),
    }))
    .with('queue-reorder', (reorder) => ({
      type: 'reorder',
      expectedRevision: reorder.expectedQueueRevision,
      orderedFollowUpIds: reorder.orderedFollowUpIds.map(FollowUpId),
    }))
    .with('queue-pause', (pause) => ({
      type: 'pause',
      expectedRevision: pause.expectedQueueRevision,
    }))
    .with('queue-resume', (resume) => ({
      type: 'resume',
      expectedRevision: resume.expectedQueueRevision,
    }))
    .with('queue-update-authorization', (update) => ({
      type: 'update-authorization',
      followUpId: FollowUpId(update.followUpId),
      callerId,
      runAuthorizationOverride: update.runAuthorizationOverride,
    }))
    .exhaustive()
}

export function submitSessionMessage(input: SubmitSessionMessageInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const repository = yield* SessionControlRepository
    const runId = yield* identities.nextRunId
    const followUpId = yield* identities.nextFollowUpId
    const acceptedAt = yield* identities.now
    const execution = yield* repository.executeMutation({
      callerId: input.callerId,
      ...(input.hostRunCeiling ? { hostRunCeiling: input.hostRunCeiling } : {}),
      request: input.request,
      decide: (state) => {
        const result = applyAdaptiveMessage({
          state,
          identities: { runId, followUpId },
          intent: {
            ...input.request.command.input,
            ...(input.callerAuthorizationCeiling === 'ask-for-approval'
              ? { runAuthorizationOverride: 'ask-for-approval' as const }
              : {}),
            callerId: input.callerId,
            acceptedAt,
            idempotencyKey: input.request.idempotencyKey,
          },
        })
        return result.accepted
          ? result
          : {
              accepted: false,
              outcome: {
                operation: 'message',
                effect: 'rejected',
                sessionId: input.request.command.sessionId,
                code: result.code,
              },
            }
      },
    })

    return {
      contractVersion: input.request.contractVersion,
      requestId: input.request.requestId,
      idempotencyKey: input.request.idempotencyKey,
      replayed: execution.replayed,
      outcome: execution.outcome,
    } satisfies SessionControlMutationResponse
  })
}

export function startSessionRun(input: StartSessionRunInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const repository = yield* SessionControlRepository
    const runId = yield* identities.nextRunId
    const acceptedAt = yield* identities.now
    const execution = yield* repository.executeMutation({
      callerId: input.callerId,
      ...(input.hostRunCeiling ? { hostRunCeiling: input.hostRunCeiling } : {}),
      request: input.request,
      decide: (state) => {
        const result = applyRunStart({
          state,
          runId,
          intent: {
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
            ...(input.request.command.interactionTimeoutMs !== undefined
              ? { interactionTimeoutMs: input.request.command.interactionTimeoutMs }
              : {}),
            callerId: input.callerId,
            acceptedAt,
            idempotencyKey: input.request.idempotencyKey,
          },
        })
        return result.accepted
          ? result
          : {
              accepted: false,
              outcome: {
                operation: 'start',
                effect: 'rejected',
                sessionId: input.request.command.sessionId,
                code: result.code,
              },
            }
      },
    })

    return {
      contractVersion: input.request.contractVersion,
      requestId: input.request.requestId,
      idempotencyKey: input.request.idempotencyKey,
      replayed: execution.replayed,
      outcome: execution.outcome,
    } satisfies SessionControlMutationResponse
  })
}

export function queueSessionFollowUp(input: QueueSessionFollowUpInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const repository = yield* SessionControlRepository
    const followUpId = yield* identities.nextFollowUpId
    const acceptedAt = yield* identities.now
    const execution = yield* repository.executeMutation({
      callerId: input.callerId,
      request: input.request,
      decide: (state) => {
        const result = applyExplicitFollowUp({
          state,
          followUpId,
          intent: {
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
          },
        })
        return result.accepted
          ? result
          : {
              accepted: false,
              outcome: {
                operation: 'follow-up',
                effect: 'rejected',
                sessionId: input.request.command.sessionId,
                code: result.code,
              },
            }
      },
    })

    return {
      contractVersion: input.request.contractVersion,
      requestId: input.request.requestId,
      idempotencyKey: input.request.idempotencyKey,
      replayed: execution.replayed,
      outcome: execution.outcome,
    } satisfies SessionControlMutationResponse
  })
}

export function mutateSessionQueue(input: MutateSessionQueueInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const repository = yield* SessionControlRepository
    const nextRunId = yield* identities.nextRunId
    const execution = yield* repository.executeMutation({
      callerId: input.callerId,
      ...(input.hostRunCeiling ? { hostRunCeiling: input.hostRunCeiling } : {}),
      request: input.request,
      decide: (state) => {
        const constrainedState =
          input.request.command.operation === 'queue-resume' &&
          input.callerAuthorizationCeiling === 'ask-for-approval' &&
          state.followUpQueue.items[0]
            ? {
                ...state,
                followUpQueue: {
                  ...state.followUpQueue,
                  items: [
                    {
                      ...state.followUpQueue.items[0],
                      intent: {
                        ...state.followUpQueue.items[0].intent,
                        runAuthorizationOverride: 'ask-for-approval' as const,
                      },
                    },
                    ...state.followUpQueue.items.slice(1),
                  ],
                },
              }
            : state
        const result = applyQueueMutation({
          state: constrainedState,
          mutation: toQueueMutation(input.request.command, input.callerId),
          nextRunId,
        })
        return result.accepted
          ? result
          : {
              accepted: false,
              outcome: {
                operation: input.request.command.operation,
                effect: 'rejected',
                sessionId: input.request.command.sessionId,
                code: result.code,
              },
            }
      },
    })

    return {
      contractVersion: input.request.contractVersion,
      requestId: input.request.requestId,
      idempotencyKey: input.request.idempotencyKey,
      replayed: execution.replayed,
      outcome: execution.outcome,
    } satisfies SessionControlMutationResponse
  })
}
