import { matchBy } from '@diegogbrisa/ts-match'
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { classifyAgentError } from '../agent/error-classifier'
import { executeWaggleRun } from '../application/waggle-run-service'
import { broadcastToWindows } from '../utils/broadcast'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitTransportEvent,
  emitWaggleTransportEvent,
  emitWaggleTurnEvent,
  startStreamBuffer,
} from '../utils/stream-bridge'
import { activeWaggleRuns, cancelSessionRuns } from './active-agent-runs'
import { emitErrorAndFinish } from './run-handler-utils'
import { typedHandle, typedOn } from './typed-ipc'

export function registerWaggleHandlers(): void {
  typedHandle(
    'agent:send-waggle-message',
    (_event, sessionId: SessionId, payload: AgentSendPayload, config: WaggleConfig) =>
      Effect.gen(function* () {
        const validatedPayload = decodeUnknownOrThrow(agentSendPayloadSchema, payload)
        // ─── Cancel existing same-session work ──────────────
        if (cancelSessionRuns(sessionId)) {
          clearAgentPhase(sessionId)
          clearStreamBuffer(sessionId)
        }

        const abortController = new AbortController()
        const runId = `waggle-${sessionId}`
        activeWaggleRuns.register(sessionId, abortController, {})

        yield* Effect.ensuring(
          Effect.gen(function* () {
            const firstAgentModel = config.agents?.[0]?.model
            if (firstAgentModel) {
              startStreamBuffer(sessionId, firstAgentModel, 'waggle')
            }

            emitTransportEvent(sessionId, {
              type: 'agent_start',
              timestamp: Date.now(),
              runId,
            })

            const result = yield* executeWaggleRun({
              sessionId,
              runId,
              payload: validatedPayload,
              config,
              signal: abortController.signal,
              onEvent: (event, meta) => {
                emitWaggleTransportEvent(sessionId, event, meta)
                if (event.type !== 'agent_end') {
                  emitTransportEvent(sessionId, event)
                }
              },
              onTurnEvent: (event) => {
                emitWaggleTurnEvent(sessionId, event)
              },
              onTitleAssigned: (title) => {
                broadcastToWindows('sessions:title-updated', { sessionId, title })
              },
            })

            matchBy(result, 'outcome')
              .with('validation-error', (value) => {
                emitErrorAndFinish(sessionId, value.message, value.code, runId)
              })
              .with('not-found', (value) => {
                emitErrorAndFinish(sessionId, value.message, value.code, runId)
              })
              .with('no-project', (value) => {
                emitErrorAndFinish(sessionId, value.message, value.code, runId)
              })
              .with('aborted', () => {
                emitTransportEvent(sessionId, {
                  type: 'agent_end',
                  timestamp: Date.now(),
                  runId,
                  reason: 'aborted',
                })
              })
              .with('success', (value) => {
                const assistantCount = value.newMessages.filter(
                  (m) => m.role === 'assistant',
                ).length
                if (assistantCount === 0 && value.lastError) {
                  const classified = classifyAgentError(new Error(value.lastError))
                  emitErrorAndFinish(sessionId, classified.userMessage, classified.code, runId)
                  return
                }

                emitTransportEvent(sessionId, {
                  type: 'agent_end',
                  timestamp: Date.now(),
                  runId,
                  reason: 'stop',
                })
              })
              .exhaustive()
          }),
          Effect.sync(() => {
            if (activeWaggleRuns.deleteIfCurrent(sessionId, abortController)) {
              clearStreamBuffer(sessionId)
              emitRunCompleted(sessionId)
            }
          }),
        )
      }),
  )

  typedOn('agent:cancel-waggle', (_event, sessionId: SessionId) =>
    Effect.sync(() => {
      if (activeWaggleRuns.cancel(sessionId)) {
        clearAgentPhase(sessionId)
        clearStreamBuffer(sessionId)
        emitRunCompleted(sessionId)
      }
    }),
  )
}
