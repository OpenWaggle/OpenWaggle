import { matchBy } from '@diegogbrisa/ts-match'
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
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
import { activeWaggleRuns, cancelConversationRuns } from './active-agent-runs'
import { emitErrorAndFinish } from './run-handler-utils'
import { typedHandle, typedOn } from './typed-ipc'

export function registerWaggleHandlers(): void {
  typedHandle(
    'agent:send-waggle-message',
    (_event, conversationId: ConversationId, payload: AgentSendPayload, config: WaggleConfig) =>
      Effect.gen(function* () {
        const validatedPayload = decodeUnknownOrThrow(agentSendPayloadSchema, payload)
        // ─── Cancel existing same-session work ──────────────
        if (cancelConversationRuns(conversationId)) {
          clearAgentPhase(conversationId)
          clearStreamBuffer(conversationId)
        }

        const abortController = new AbortController()
        activeWaggleRuns.register(conversationId, abortController, {})

        yield* Effect.ensuring(
          Effect.gen(function* () {
            const firstAgentModel = config.agents?.[0]?.model
            if (firstAgentModel) {
              startStreamBuffer(conversationId, firstAgentModel, 'waggle')
            }

            emitTransportEvent(conversationId, {
              type: 'agent_start',
              timestamp: Date.now(),
              runId: `waggle-${conversationId}`,
            })

            const result = yield* executeWaggleRun({
              conversationId,
              payload: validatedPayload,
              config,
              signal: abortController.signal,
              onEvent: (event, meta) => {
                emitWaggleTransportEvent(conversationId, event, meta)
                if (event.type !== 'agent_end') {
                  emitTransportEvent(conversationId, event)
                }
              },
              onTurnEvent: (event) => {
                emitWaggleTurnEvent(conversationId, event)
              },
            })

            if ('assignedTitle' in result && result.assignedTitle) {
              broadcastToWindows('conversations:title-updated', {
                conversationId,
                title: result.assignedTitle,
              })
            }

            matchBy(result, 'outcome')
              .with('validation-error', (value) => {
                emitErrorAndFinish(
                  conversationId,
                  value.message,
                  value.code,
                  `waggle-${conversationId}`,
                )
              })
              .with('not-found', (value) => {
                emitErrorAndFinish(
                  conversationId,
                  value.message,
                  value.code,
                  `waggle-${conversationId}`,
                )
              })
              .with('no-project', (value) => {
                emitErrorAndFinish(
                  conversationId,
                  value.message,
                  value.code,
                  `waggle-${conversationId}`,
                )
              })
              .with('aborted', () => {
                emitTransportEvent(conversationId, {
                  type: 'agent_end',
                  timestamp: Date.now(),
                  runId: `waggle-${conversationId}`,
                  reason: 'aborted',
                })
              })
              .with('success', (value) => {
                const assistantCount = value.newMessages.filter(
                  (m) => m.role === 'assistant',
                ).length
                if (assistantCount === 0 && value.lastError) {
                  const classified = classifyAgentError(new Error(value.lastError))
                  emitErrorAndFinish(
                    conversationId,
                    classified.userMessage,
                    classified.code,
                    `waggle-${conversationId}`,
                  )
                  return
                }

                emitTransportEvent(conversationId, {
                  type: 'agent_end',
                  timestamp: Date.now(),
                  runId: `waggle-${conversationId}`,
                  reason: 'stop',
                })
              })
              .exhaustive()
          }),
          Effect.sync(() => {
            if (activeWaggleRuns.deleteIfCurrent(conversationId, abortController)) {
              clearStreamBuffer(conversationId)
              emitRunCompleted(conversationId)
            }
          }),
        )
      }),
  )

  typedOn('agent:cancel-waggle', (_event, conversationId: ConversationId) =>
    Effect.sync(() => {
      if (activeWaggleRuns.cancel(conversationId)) {
        clearAgentPhase(conversationId)
        clearStreamBuffer(conversationId)
        emitRunCompleted(conversationId)
      }
    }),
  )
}
