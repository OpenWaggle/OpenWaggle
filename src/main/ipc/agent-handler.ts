/**
 * Agent IPC handlers — transport layer.
 *
 * Responsibilities: abort controller lifecycle, active run tracking,
 * stream buffer management, IPC event emission, cleanup.
 *
 * Business logic (model validation, conversation fetching, run execution,
 * message persistence, error classification) lives in AgentRunService.
 */
import type { AgentSendPayload, HydratedAgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import * as Effect from 'effect/Effect'
import { cleanupConversationRun } from '../agent/conversation-cleanup'
import { getPhaseForConversation } from '../agent/phase-tracker'
import type { StreamPartCollector } from '../agent/stream-part-collector'
import {
  type AgentRunResult,
  executeAgentRun,
  persistPartialSteerResponse,
} from '../application/agent-run-service'
import { pushContext } from '../tools/context-injection-buffer'
import { respondToPlan } from '../tools/plan-manager'
import { answerQuestion } from '../tools/question-manager'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitStreamChunk,
  getStreamBuffer,
  listStreamBuffers,
  startStreamBuffer,
} from '../utils/stream-bridge'
import { ActiveRunManager } from './active-run-manager'
import { emitErrorAndFinish } from './run-handler-utils'
import { typedHandle, typedOn } from './typed-ipc'

interface AgentRunMetadata {
  collector: StreamPartCollector | null
  model: SupportedModelId
  payload: HydratedAgentSendPayload | null
}

const activeRuns = new ActiveRunManager<ConversationId, AgentRunMetadata>()

function handleRunResult(conversationId: ConversationId, result: AgentRunResult): void {
  if (
    result.outcome === 'invalid-model' ||
    result.outcome === 'not-found' ||
    result.outcome === 'error'
  ) {
    emitErrorAndFinish(conversationId, result.message, result.code)
  }
}

export function registerAgentHandlers(): void {
  typedHandle(
    'agent:send-message',
    (_event, conversationId: ConversationId, payload: AgentSendPayload, model: SupportedModelId) =>
      Effect.gen(function* () {
        // ─── Transport: cancel existing, register new ────
        if (activeRuns.has(conversationId)) {
          activeRuns.cancel(conversationId)
          clearAgentPhase(conversationId)
        }
        cleanupConversationRun(conversationId)

        const abortController = new AbortController()
        activeRuns.register(conversationId, abortController, {
          collector: null,
          model,
          payload: null,
        })

        startStreamBuffer(conversationId, model, 'classic')

        // ─── Application: delegate to service ────────────
        const result = yield* executeAgentRun({
          conversationId,
          payload,
          model,
          signal: abortController.signal,
          onChunk: (chunk) => emitStreamChunk(conversationId, chunk),
          onCollectorCreated: (c) => {
            const entry = activeRuns.get(conversationId)
            if (entry) {
              entry.metadata.collector = c
              entry.metadata.model = model
            }
          },
        })

        // ─── Transport: respond based on outcome ─────────
        handleRunResult(conversationId, result)

        // ─── Transport: cleanup ──────────────────────────
        activeRuns.delete(conversationId)
        clearAgentPhase(conversationId)
        clearStreamBuffer(conversationId)
        emitRunCompleted(conversationId)
      }),
  )

  typedOn('agent:cancel', (_event, conversationId?: ConversationId) =>
    Effect.sync(() => {
      if (conversationId) {
        activeRuns.cancel(conversationId)
        clearAgentPhase(conversationId)
        cleanupConversationRun(conversationId)
      } else {
        const allKeys = [...activeRuns.keys()]
        activeRuns.cancelAll()
        for (const id of allKeys) {
          clearAgentPhase(id)
          cleanupConversationRun(id)
        }
      }
    }),
  )

  typedOn('agent:inject-context', (_event, conversationId: ConversationId, text: string) =>
    Effect.sync(() => pushContext(conversationId, text)),
  )

  typedHandle('agent:get-phase', (_event, conversationId: ConversationId) =>
    Effect.sync(() => getPhaseForConversation(conversationId)),
  )

  typedHandle('agent:get-background-run', (_event, conversationId: ConversationId) =>
    Effect.sync(() => getStreamBuffer(conversationId)),
  )

  typedHandle('agent:list-active-runs', () => Effect.sync(() => listStreamBuffers()))

  typedHandle(
    'agent:answer-question',
    (_event, conversationId: ConversationId, answers: QuestionAnswer[]) =>
      Effect.sync(() => answerQuestion(conversationId, answers)),
  )

  typedHandle('agent:steer', (_event, conversationId: ConversationId) =>
    Effect.gen(function* () {
      const entry = activeRuns.get(conversationId)
      if (!entry) return { preserved: false }

      if (!entry.metadata.collector || !entry.metadata.payload) {
        activeRuns.cancel(conversationId)
        clearAgentPhase(conversationId)
        cleanupConversationRun(conversationId)
        return { preserved: false }
      }

      const partialParts = entry.metadata.collector.finalizeParts()
      const resolvedModel = entry.metadata.model
      const originalPayload = entry.metadata.payload

      // Application: persist partial response
      yield* persistPartialSteerResponse(
        conversationId,
        originalPayload,
        partialParts,
        resolvedModel,
      )

      // Transport: cancel and cleanup
      activeRuns.cancel(conversationId)
      clearAgentPhase(conversationId)
      cleanupConversationRun(conversationId)

      return { preserved: true }
    }),
  )

  typedHandle(
    'agent:respond-to-plan',
    (_event, conversationId: ConversationId, response: PlanResponse) =>
      Effect.sync(() => respondToPlan(conversationId, response)),
  )
}
