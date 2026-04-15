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
import type { AgentStreamChunk } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { cleanupConversationRun } from '../agent/conversation-cleanup'
import { getPhaseForConversation } from '../agent/phase-tracker'
import type { StreamPartCollector } from '../agent/stream-part-collector'
import {
  type AgentRunResult,
  executeAgentRun,
  persistPartialResponse,
  persistRehydratedToolResult,
} from '../application/agent-run-service'
import { ConversationRepository } from '../ports/conversation-repository'
import { PinnedContextRepository } from '../ports/pinned-context-repository'
import { runAppEffect } from '../runtime'
import * as contextSnapshotService from '../services/context-snapshot-service'
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
  /** True after a checkpoint persisted conversation state before a blocking tool. */
  checkpointed: boolean
  /** Message count before this run started — used to replace checkpointed messages. */
  messageCountBeforeRun: number | null
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

/**
 * Finalize and persist whatever progress an active run has accumulated.
 * Called before cancelling a run so user/assistant messages are not lost.
 *
 * Uses finalizeParts({ timedOut: true }) to force synthetic error results
 * for all incomplete tool calls. Without this, orphan tool-call parts
 * (no matching tool-result) would trigger continuation loops on reload.
 *
 * When `skipCheckpointed` is true (default for before-quit), runs that
 * were already checkpointed during a blocking tool wait are skipped —
 * the checkpoint preserves clean blocking state for rehydration, which
 * is preferable to synthetic error results.
 *
 * When `skipCheckpointed` is false (used by explicit cancel), the run
 * is always persisted — the user cancelled after the blocking tool
 * resolved and the run progressed past the checkpoint.
 */
function persistRunSnapshot(
  conversationId: ConversationId,
  options?: { skipCheckpointed?: boolean },
) {
  const entry = activeRuns.get(conversationId)
  if (!entry?.metadata.payload) return Effect.void

  const skipCheckpointed = options?.skipCheckpointed ?? true
  if (skipCheckpointed && entry.metadata.checkpointed) return Effect.void

  const partialParts = entry.metadata.collector?.finalizeParts({ timedOut: true }) ?? []
  return persistPartialResponse(
    conversationId,
    entry.metadata.payload,
    partialParts,
    entry.metadata.model,
    entry.metadata.messageCountBeforeRun ?? undefined,
  )
}

/**
 * Persist all active runs that haven't been checkpointed yet.
 * Called from `before-quit` to save progress on graceful shutdown.
 * Checkpointed runs are skipped to preserve clean blocking state.
 */
export function persistAllActiveRuns() {
  return Effect.gen(function* () {
    for (const id of activeRuns.keys()) {
      yield* persistRunSnapshot(id)
    }
  })
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
          checkpointed: false,
          messageCountBeforeRun: null,
        })

        startStreamBuffer(conversationId, model, 'classic')

        // Track usage from RUN_FINISHED for context snapshot
        let lastPromptTokens: number | undefined
        function onChunkWithUsageCapture(chunk: AgentStreamChunk) {
          if (chunk.type === 'RUN_FINISHED' && chunk.usage) {
            lastPromptTokens = chunk.usage.promptTokens
          }
          emitStreamChunk(conversationId, chunk)
        }

        // ─── Application: delegate to service ────────────
        const result = yield* executeAgentRun({
          conversationId,
          payload,
          model,
          signal: abortController.signal,
          onChunk: onChunkWithUsageCapture,
          onCollectorCreated: (c) => {
            const entry = activeRuns.get(conversationId)
            if (entry) {
              entry.metadata.collector = c
              entry.metadata.model = model
            }
          },
          onPayloadHydrated: (hydrated) => {
            const entry = activeRuns.get(conversationId)
            if (entry) entry.metadata.payload = hydrated
          },
          onMessageCountResolved: (count) => {
            const entry = activeRuns.get(conversationId)
            if (entry) entry.metadata.messageCountBeforeRun = count
          },
          onCheckpointNeeded: async (parts) => {
            const entry = activeRuns.get(conversationId)
            if (!entry?.metadata.payload || entry.metadata.messageCountBeforeRun === null) return
            entry.metadata.checkpointed = true
            await runAppEffect(
              persistPartialResponse(
                conversationId,
                entry.metadata.payload,
                parts,
                entry.metadata.model,
                entry.metadata.messageCountBeforeRun,
              ),
            )
          },
        })

        // ─── Transport: respond based on outcome ─────────
        handleRunResult(conversationId, result)

        // ─── Context snapshot: push after run ────────────
        if (result.outcome === 'success' && lastPromptTokens !== undefined) {
          const repo = yield* ConversationRepository
          const conv = yield* repo
            .get(conversationId)
            .pipe(Effect.catchAll(() => Effect.succeed(null)))
          if (conv) {
            const pinRepo = yield* PinnedContextRepository
            const pinnedTokens = yield* pinRepo.getTokenEstimate(conversationId)
            const pinnedItems = yield* pinRepo.list(conversationId)
            contextSnapshotService.onRunFinished(conversationId, {
              promptTokens: lastPromptTokens,
              messages: conv.messages,
              modelId: model,
              pinnedTokens,
              pinnedItemCount: pinnedItems.length,
              pinnedMessageIds: pinnedItems
                .filter((p) => p.messageId)
                .map((p) => String(p.messageId)),
              waggleConfig: conv.waggleConfig,
              microcompactedToolResults:
                result.outcome === 'success' ? result.microcompactedToolResults : undefined,
            })
          }
        }

        // ─── Transport: cleanup ──────────────────────────
        activeRuns.delete(conversationId)
        clearAgentPhase(conversationId)
        clearStreamBuffer(conversationId)
        emitRunCompleted(conversationId)
      }),
  )

  typedOn('agent:cancel', (_event, conversationId?: ConversationId) =>
    Effect.gen(function* () {
      // Explicit cancel always persists — even if checkpointed, the run
      // may have progressed past the blocking tool (user approved the plan
      // and the agent continued working before the cancel).
      const cancelOptions = { skipCheckpointed: false }
      if (conversationId) {
        yield* persistRunSnapshot(conversationId, cancelOptions)
        activeRuns.cancel(conversationId)
        clearAgentPhase(conversationId)
        cleanupConversationRun(conversationId)
      } else {
        for (const id of activeRuns.keys()) {
          yield* persistRunSnapshot(id, cancelOptions)
        }
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
      Effect.gen(function* () {
        if (answerQuestion(conversationId, answers)) return
        // Rehydrated case: no active run — persist the tool-result
        yield* persistRehydratedToolResult(conversationId, 'askUser', JSON.stringify({ answers }))
      }),
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

      const partialParts = entry.metadata.collector.finalizeParts({ timedOut: true })
      const resolvedModel = entry.metadata.model
      const originalPayload = entry.metadata.payload

      // Application: persist partial response (pass messageCountBeforeRun so
      // checkpointed messages are replaced rather than duplicated)
      yield* persistPartialResponse(
        conversationId,
        originalPayload,
        partialParts,
        resolvedModel,
        entry.metadata.messageCountBeforeRun ?? undefined,
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
      Effect.gen(function* () {
        if (respondToPlan(conversationId, response)) return
        // Rehydrated case: no active run — persist the tool-result
        yield* persistRehydratedToolResult(conversationId, 'proposePlan', JSON.stringify(response))
      }),
  )
}
