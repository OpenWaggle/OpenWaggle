import { randomUUID } from 'node:crypto'
import { decodeUnknownOrThrow } from '@shared/schema'
import {
  agentLoopResponseInputSchema,
  toAgentLoopResponseInput,
} from '@shared/schemas/agent-loop-interaction'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { AgentLoopInteractionErrorCode } from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { getPhaseForSession } from '../agent/phase-tracker'
import { cleanupSessionRun } from '../agent/session-cleanup'
import { getAgentContextUsage } from '../application/agent-session-service'
import { dispatchLocalSessionCommand } from '../application/local-session-command-dispatcher'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  getStreamBuffer,
  listStreamBuffers,
} from '../utils/stream-bridge'
import { cancelAllSessionRuns } from './active-agent-runs'
import { typedHandle } from './typed-ipc'

function clearSessionTransportState(sessionId: SessionId) {
  clearAgentPhase(sessionId)
  clearStreamBuffer(sessionId)
  cleanupSessionRun(sessionId)
}

function emitCancelledCompletion(sessionId: SessionId) {
  clearSessionTransportState(sessionId)
  emitRunCompleted(sessionId)
}

function interruptSessionRun(sessionId: SessionId) {
  return Effect.gen(function* () {
    const statusResult = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'session-query-v2',
        request: {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: randomUUID(),
          query: { operation: 'status', sessionId },
        },
      },
    })
    if (
      statusResult.contract !== 'session-query-v2' ||
      statusResult.response.outcome.operation !== 'status' ||
      'error' in statusResult.response.outcome
    ) {
      return
    }
    if (statusResult.response.outcome.activeRunId) {
      yield* dispatchLocalSessionCommand({
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'session-control-v2',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: randomUUID(),
            idempotencyKey: randomUUID(),
            command: {
              operation: 'interrupt',
              sessionId,
              expectedRunId: statusResult.response.outcome.activeRunId,
            },
          },
        },
      })
      return
    }
    const requestId = randomUUID()
    const cancellation = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'local-compaction-cancel-v1',
        request: { requestId, sessionId },
      },
    })
    if (
      cancellation.contract !== 'local-compaction-cancel-v1' ||
      cancellation.response.requestId !== requestId ||
      cancellation.response.sessionId !== sessionId
    ) {
      return yield* Effect.fail(
        new Error('Session Host returned an invalid compaction cancellation response.'),
      )
    }
  })
}

/**
 * Pi persists runtime progress into its session file as the run proceeds, so
 * graceful shutdown no longer reconstructs partial assistant messages from
 * stream chunks.
 */
export function persistAllActiveRuns() {
  return Effect.void
}

function registerAgentRunHandlers() {
  typedHandle(
    'agent:send-message',
    (_event, sessionId: SessionId, payload: AgentSendPayload, _model: SupportedModelId) =>
      Effect.gen(function* () {
        const validatedPayload = toAgentSendPayload(
          decodeUnknownOrThrow(agentSendPayloadSchema, payload),
        )
        const result = yield* dispatchLocalSessionCommand({
          caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
          payload: {
            contract: 'session-control-v2',
            request: {
              contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
              requestId: randomUUID(),
              idempotencyKey: randomUUID(),
              command: {
                operation: 'message',
                sessionId,
                input: {
                  text: validatedPayload.text,
                  thinkingLevel: validatedPayload.thinkingLevel,
                  attachmentIds: validatedPayload.attachments.map((attachment) => attachment.id),
                },
              },
            },
          },
        })
        if (result.contract !== 'session-control-v2') {
          return yield* Effect.die(new Error('Session Control returned the wrong contract.'))
        }
        const outcome = result.response.outcome
        return outcome.effect === 'rejected'
          ? ({ outcome: 'refused', message: outcome.code, code: outcome.code } as const)
          : ({ outcome: 'delivered' } as const)
      }),
  )

  typedHandle('agent:cancel', (_event, sessionId?: SessionId) =>
    Effect.gen(function* () {
      if (!sessionId) {
        const cancelledSessionIds = cancelAllSessionRuns()
        for (const id of cancelledSessionIds) {
          emitCancelledCompletion(id)
        }
        return
      }
      yield* interruptSessionRun(sessionId)
    }),
  )
}

function registerAgentInteractionHandlers() {
  typedHandle('agent:respond-interaction', (_event, input) =>
    Effect.gen(function* () {
      const decoded = decodeUnknownOrThrow(agentLoopResponseInputSchema, input)
      const normalized = toAgentLoopResponseInput(decoded)
      const pending = yield* dispatchLocalSessionCommand({
        caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
        payload: {
          contract: 'session-query-v2',
          request: {
            contractVersion: SESSION_QUERY_CONTRACT_VERSION,
            requestId: randomUUID(),
            query: { operation: 'requests-list', sessionId: normalized.sessionId },
          },
        },
      })
      const interaction =
        pending.contract === 'session-query-v2' &&
        pending.response.outcome.operation === 'requests-list' &&
        !('error' in pending.response.outcome)
          ? pending.response.outcome.requests.find(
              (candidate) =>
                candidate.runId === normalized.runId &&
                candidate.interactionId === normalized.interactionId &&
                candidate.kind === normalized.kind,
            )
          : undefined
      if (!interaction) {
        return {
          ok: false,
          error: {
            code: 'interaction-not-found' as const,
            message: 'No pending agent-loop interaction matches this response.',
          },
        }
      }
      const authorization =
        interaction.kind === 'confirm' && interaction.purpose === 'authorization'
      const result = yield* dispatchLocalSessionCommand({
        caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
        payload: {
          contract: 'session-control-v2',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: randomUUID(),
            idempotencyKey: randomUUID(),
            command: {
              operation: authorization ? 'approval-respond' : 'request-respond',
              sessionId: normalized.sessionId,
              runId: normalized.runId,
              interactionId: normalized.interactionId,
              kind: normalized.kind,
              response: normalized.response,
            },
          },
        },
      })
      const outcome = result.contract === 'session-control-v2' ? result.response.outcome : undefined
      if (outcome?.effect === 'interaction-resolved') {
        return {
          ok: true,
          interactionId: outcome.interactionId,
          status: outcome.status,
        } as const
      }
      const supportedCodes: readonly AgentLoopInteractionErrorCode[] = [
        'interaction-not-found',
        'interaction-mismatch',
        'invalid-response-payload',
        'custom-renderer-unavailable',
      ]
      const rejectedCode = outcome?.effect === 'rejected' ? outcome.code : 'interaction-mismatch'
      const code =
        supportedCodes.find((candidate) => candidate === rejectedCode) ?? 'interaction-mismatch'
      return { ok: false, error: { code, message: rejectedCode } } as const
    }),
  )
}

function registerAgentStateHandlers() {
  typedHandle('agent:get-phase', (_event, sessionId: SessionId) =>
    Effect.sync(() => getPhaseForSession(sessionId)),
  )

  typedHandle('agent:get-background-run', (_event, sessionId: SessionId) =>
    Effect.sync(() => getStreamBuffer(sessionId)),
  )

  typedHandle('agent:list-active-runs', () => Effect.sync(() => listStreamBuffers()))

  typedHandle('agent:get-context-usage', (_event, sessionId: SessionId, model: SupportedModelId) =>
    getAgentContextUsage({ sessionId, model }),
  )
}

function registerAgentCompactionHandlers() {
  typedHandle(
    'agent:compact-session',
    (_event, sessionId: SessionId, model: SupportedModelId, customInstructions?: string) =>
      Effect.gen(function* () {
        const requestId = randomUUID()
        const result = yield* dispatchLocalSessionCommand({
          caller: { callerId: 'gui:local-user' },
          payload: {
            contract: 'local-compaction-v1',
            request: {
              requestId,
              sessionId,
              model,
              ...(customInstructions !== undefined ? { customInstructions } : {}),
            },
          },
        })
        if (
          result.contract !== 'local-compaction-v1' ||
          result.response.requestId !== requestId ||
          result.response.sessionId !== sessionId
        ) {
          return yield* Effect.fail(
            new Error('Session Host returned an invalid compaction response.'),
          )
        }
        return result.response.result
      }),
  )
}

export function registerAgentHandlers(): void {
  registerAgentRunHandlers()
  registerAgentInteractionHandlers()
  registerAgentStateHandlers()
  registerAgentCompactionHandlers()
}
