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
import {
  requestedRunStartSettings,
  toSessionControlIntentMessage,
} from './session-control-message-input'
import { withCallerCeiling } from './session-control-run-authorization'

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
  readonly hostRunCeiling?: number
  readonly request: SessionControlFollowUpMutationRequest
}

export interface MutateSessionQueueInput {
  readonly callerId: string
  readonly callerAuthorizationCeiling?: AgentAuthorizationMode
  readonly hostRunCeiling?: number
  readonly request: SessionControlQueueMutationRequest
  /** False while the Host drains: the change applies without starting the Run it would deliver. */
  readonly queueDeliveryAdmitted?: boolean
}

function toQueueMutation(
  command: SessionControlQueueMutationRequest['command'],
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
            ...toSessionControlIntentMessage(input.request.command.input),
            callerId: input.callerId,
            acceptedAt,
            idempotencyKey: input.request.idempotencyKey,
          },
          runSettings: requestedRunStartSettings(
            input.request.command.input,
            input.request.command.runAuthorizationOverride,
          ),
        })
        return result.accepted
          ? {
              ...result,
              state: withCallerCeiling(state, result.state, input.callerAuthorizationCeiling),
            }
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
          runSettings: requestedRunStartSettings(
            input.request.command.input,
            input.request.command.runAuthorizationOverride,
          ),
          intent: {
            ...toSessionControlIntentMessage(input.request.command.input),
            ...(input.request.command.interactionTimeoutMs !== undefined
              ? { interactionTimeoutMs: input.request.command.interactionTimeoutMs }
              : {}),
            callerId: input.callerId,
            acceptedAt,
            idempotencyKey: input.request.idempotencyKey,
          },
        })
        return result.accepted
          ? {
              ...result,
              state: withCallerCeiling(state, result.state, input.callerAuthorizationCeiling),
            }
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
    const runId = yield* identities.nextRunId
    const followUpId = yield* identities.nextFollowUpId
    const acceptedAt = yield* identities.now
    const execution = yield* repository.executeMutation({
      callerId: input.callerId,
      ...(input.hostRunCeiling ? { hostRunCeiling: input.hostRunCeiling } : {}),
      request: input.request,
      decide: (state) => {
        const result = applyExplicitFollowUp({
          state,
          runId,
          followUpId,
          intent: {
            ...toSessionControlIntentMessage(input.request.command.input),
            callerId: input.callerId,
            acceptedAt,
            idempotencyKey: input.request.idempotencyKey,
          },
        })
        return result.accepted
          ? {
              ...result,
              state: withCallerCeiling(state, result.state, input.callerAuthorizationCeiling),
            }
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
      // A withdrawn, reordered, or re-authorized held item can leave an idle queue runnable.
      ...(input.queueDeliveryAdmitted === false ? {} : { nextRunId }),
      decide: (state) => {
        const result = applyQueueMutation({
          state,
          mutation: toQueueMutation(input.request.command),
          nextRunId,
        })
        return result.accepted
          ? {
              ...result,
              state: withCallerCeiling(state, result.state, input.callerAuthorizationCeiling),
            }
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
