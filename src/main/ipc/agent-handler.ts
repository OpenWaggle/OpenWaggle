/**
 * Agent IPC handlers — transport layer.
 *
 * Responsibilities: abort controller lifecycle, active run tracking,
 * stream buffer management, IPC event emission, cleanup.
 *
 * Business logic (model validation, conversation fetching, run execution,
 * message persistence, error classification) lives in AgentRunService.
 */
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { cleanupConversationRun } from '../agent/conversation-cleanup'
import { getPhaseForConversation } from '../agent/phase-tracker'
import { type AgentRunResult, executeAgentRun } from '../application/agent-run-service'
import { compactAgentSession, getAgentContextUsage } from '../application/agent-session-service'
import { broadcastToWindows } from '../utils/broadcast'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitTransportEvent,
  getStreamBuffer,
  listStreamBuffers,
  startStreamBuffer,
} from '../utils/stream-bridge'
import {
  activeCompactions,
  activeRuns,
  cancelAllConversationRuns,
  cancelConversationRuns,
  hasAnyActiveRun,
} from './active-agent-runs'
import { emitErrorAndFinish } from './run-handler-utils'
import { typedHandle, typedOn } from './typed-ipc'

function clearConversationTransportState(conversationId: ConversationId): void {
  clearAgentPhase(conversationId)
  clearStreamBuffer(conversationId)
  cleanupConversationRun(conversationId)
}

function emitCancelledCompletion(conversationId: ConversationId): void {
  clearConversationTransportState(conversationId)
  emitRunCompleted(conversationId)
}

function handleRunResult(conversationId: ConversationId, result: AgentRunResult): void {
  if (result.assignedTitle) {
    broadcastToWindows('conversations:title-updated', {
      conversationId,
      title: result.assignedTitle,
    })
  }

  if (result.outcome === 'error' && result.transportEmitted) {
    return
  }

  if (
    result.outcome === 'invalid-model' ||
    result.outcome === 'not-found' ||
    result.outcome === 'error'
  ) {
    emitErrorAndFinish(conversationId, result.message, result.code)
  }
}

/**
 * Pi persists runtime progress into its session file as the run proceeds, so
 * graceful shutdown no longer reconstructs partial assistant messages from
 * stream chunks.
 */
export function persistAllActiveRuns() {
  return Effect.void
}

export function registerAgentHandlers(): void {
  typedHandle(
    'agent:send-message',
    (_event, conversationId: ConversationId, payload: AgentSendPayload, model: SupportedModelId) =>
      Effect.gen(function* () {
        const validatedPayload = decodeUnknownOrThrow(agentSendPayloadSchema, payload)
        // ─── Transport: cancel existing same-session work, register new ────
        if (cancelConversationRuns(conversationId)) {
          clearConversationTransportState(conversationId)
        }

        const abortController = new AbortController()
        activeRuns.register(conversationId, abortController, {
          model,
        })

        startStreamBuffer(conversationId, model, 'classic')

        function onEventWithUsageCapture(event: AgentTransportEvent) {
          emitTransportEvent(conversationId, event)
        }

        // ─── Application: delegate to service ────────────
        const result = yield* executeAgentRun({
          conversationId,
          payload: validatedPayload,
          model,
          signal: abortController.signal,
          onEvent: onEventWithUsageCapture,
        })

        // ─── Transport: respond based on outcome ─────────
        handleRunResult(conversationId, result)

        // ─── Transport: cleanup ──────────────────────────
        if (activeRuns.deleteIfCurrent(conversationId, abortController)) {
          clearAgentPhase(conversationId)
          clearStreamBuffer(conversationId)
          emitRunCompleted(conversationId)
        }
      }),
  )

  typedOn('agent:cancel', (_event, conversationId?: ConversationId) =>
    Effect.sync(() => {
      if (conversationId) {
        if (cancelConversationRuns(conversationId)) {
          emitCancelledCompletion(conversationId)
        }
      } else {
        const cancelledConversationIds = cancelAllConversationRuns()
        for (const id of cancelledConversationIds) {
          emitCancelledCompletion(id)
        }
      }
    }),
  )

  typedHandle('agent:get-phase', (_event, conversationId: ConversationId) =>
    Effect.sync(() => getPhaseForConversation(conversationId)),
  )

  typedHandle('agent:get-background-run', (_event, conversationId: ConversationId) =>
    Effect.sync(() => getStreamBuffer(conversationId)),
  )

  typedHandle('agent:list-active-runs', () => Effect.sync(() => listStreamBuffers()))

  typedHandle(
    'agent:get-context-usage',
    (_event, conversationId: ConversationId, model: SupportedModelId) =>
      getAgentContextUsage({ conversationId, model }),
  )

  typedHandle(
    'agent:compact-session',
    (
      _event,
      conversationId: ConversationId,
      model: SupportedModelId,
      customInstructions?: string,
    ) =>
      Effect.gen(function* () {
        if (hasAnyActiveRun(conversationId)) {
          return yield* Effect.fail(
            new Error('Wait for the current run to finish before compacting.'),
          )
        }

        const abortController = new AbortController()
        activeCompactions.register(conversationId, abortController, { model })
        let delayedSuccessfulCompactionEnd: AgentTransportEvent | null = null

        return yield* compactAgentSession({
          conversationId,
          model,
          customInstructions,
          signal: abortController.signal,
          onEvent: (event) => {
            if (event.type === 'compaction_end' && !event.aborted && !event.errorMessage) {
              delayedSuccessfulCompactionEnd = event
              return
            }
            emitTransportEvent(conversationId, event)
          },
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (delayedSuccessfulCompactionEnd) {
                emitTransportEvent(conversationId, delayedSuccessfulCompactionEnd)
              }
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              activeCompactions.deleteIfCurrent(conversationId, abortController)
            }),
          ),
        )
      }),
  )

  typedHandle('agent:steer', (_event, conversationId: ConversationId) =>
    Effect.sync(() => {
      if (cancelConversationRuns(conversationId)) {
        emitCancelledCompletion(conversationId)
      }

      return { preserved: false }
    }),
  )
}
