/**
 * AgentRunService — application-layer orchestration for agent message execution.
 *
 * Extracts business logic from agent-handler.ts into Effect programs
 * that depend on hexagonal ports. The handler retains transport concerns
 * (abort controllers, active run tracking, stream buffers, IPC emission).
 */

import { classifyErrorMessage } from '@shared/domain/error-classifier'
import type {
  AgentSendPayload,
  HydratedAgentSendPayload,
  Message,
  MessagePart,
  ToolResultPart,
} from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentStreamChunk } from '@shared/types/stream'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import type { AgentRunParams } from '../agent/agent-loop'
import { runAgent } from '../agent/agent-loop'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import type { StreamPartCollector } from '../agent/stream-part-collector'
import { approvalTraceEnabled } from '../env'
import { hydratePayloadAttachments, maybeTriggerTitleGeneration } from '../ipc/run-handler-utils'
import { createLogger } from '../logger'
import { ChatService, type ChatStreamOptions } from '../ports/chat-service'
import { ConversationRepository } from '../ports/conversation-repository'
import { PinnedContextRepository } from '../ports/pinned-context-repository'
import { ProviderService } from '../ports/provider-service'
import { SettingsService } from '../services/settings-service'

const logger = createLogger('agent-run-service')
const approvalTraceLogger = createLogger('approval-trace')

// ─── Types ───────────────────────────────────────────────────

export interface AgentRunInput {
  readonly conversationId: ConversationId
  readonly payload: AgentSendPayload
  readonly model: SupportedModelId
  readonly signal: AbortSignal
  readonly onChunk: (chunk: AgentStreamChunk) => void
  readonly onCollectorCreated?: (c: StreamPartCollector) => void
  readonly onPayloadHydrated?: (payload: HydratedAgentSendPayload) => void
  /** Called once the conversation's pre-run message count is known. */
  readonly onMessageCountResolved?: (count: number) => void
  /**
   * Called when a user-blocking tool (proposePlan / askUser) is about to
   * block for user input. Receives the collector's current snapshot of
   * message parts. Must persist conversation state so an app crash during
   * the wait does not lose messages.
   */
  readonly onCheckpointNeeded?: (parts: readonly MessagePart[]) => Promise<void>
}

export type AgentRunResult =
  | {
      readonly outcome: 'success'
      readonly newMessages: readonly Message[]
      readonly microcompactedToolResults: number
    }
  | { readonly outcome: 'aborted' }
  | { readonly outcome: 'invalid-model'; readonly message: string; readonly code: string }
  | { readonly outcome: 'not-found'; readonly message: string; readonly code: string }
  | { readonly outcome: 'error'; readonly message: string; readonly code: string }

// ─── Service Functions ───────────────────────────────────────

/**
 * Validate preconditions, execute the agent run, and persist results.
 * Returns a discriminated union describing the outcome.
 *
 * The handler reads the outcome and performs transport actions
 * (IPC emission, stream buffer, active run cleanup).
 */
export function executeAgentRun(input: AgentRunInput) {
  return Effect.gen(function* () {
    const { conversationId, payload, model, signal, onChunk, onCollectorCreated } = input

    // ─── Validate model ──────────────────────────────────
    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(model)
    if (!isKnown) {
      yield* persistUserMessage(conversationId, payload)
      return {
        outcome: 'invalid-model' as const,
        message: `Unknown model: ${model}`,
        code: 'invalid-model',
      }
    }

    // ─── Fetch conversation ──────────────────────────────
    const conversationRepo = yield* ConversationRepository
    const conversation = yield* conversationRepo
      .get(conversationId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)))
    if (!conversation) {
      const errorInfo = makeErrorInfo('conversation-not-found', 'Conversation not found')
      return { outcome: 'not-found' as const, message: errorInfo.userMessage, code: errorInfo.code }
    }

    // ─── Chat stream via port ─────────────────────────────
    const chatService = yield* ChatService
    const chatStream = (options: ChatStreamOptions): AsyncIterable<AgentStreamChunk> =>
      Effect.runSync(chatService.stream(options))

    const messageCountBeforeRun = conversation.messages.length
    input.onMessageCountResolved?.(messageCountBeforeRun)

    // ─── Settings + title generation ─────────────────────
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()

    maybeTriggerTitleGeneration(conversationId, conversation, payload.text, settings, chatStream)

    // ─── Hydrate attachments ─────────────────────────────
    const hydratedPayload: HydratedAgentSendPayload = {
      ...payload,
      attachments: yield* Effect.promise(() => hydratePayloadAttachments(payload.attachments)),
    }
    input.onPayloadHydrated?.(hydratedPayload)

    // ─── Read pinned content for compaction preservation ──
    const pinnedRepo = yield* PinnedContextRepository
    const pinnedItems = yield* pinnedRepo
      .list(conversationId)
      .pipe(Effect.catchAll(() => Effect.succeed([])))
    const pinnedContent = pinnedItems.map((item) => item.content)

    // ─── Execute agent run (with Layer 2 reactive retry) ──
    const runParams: AgentRunParams = {
      conversation,
      payload: hydratedPayload,
      model,
      settings,
      chatStream,
      onChunk,
      signal,
      onCollectorCreated,
      onCheckpointNeeded: input.onCheckpointNeeded,
      pinnedContent: pinnedContent.length > 0 ? pinnedContent : undefined,
    }

    let agentResult = yield* Effect.tryPromise({
      try: () => runAgent(runParams),
      catch: (err) => err,
    })

    // Layer 2: Reactive compaction — if the API rejects with context-overflow,
    // compact the conversation and retry once automatically.
    if (agentResult instanceof Error) {
      const classified = classifyErrorMessage(agentResult.message)
      if (classified.code === 'context-overflow' && !signal.aborted) {
        logger.info('Layer 2 reactive: context-overflow detected, compacting and retrying', {
          conversationId,
        })

        onChunk({
          type: 'CUSTOM',
          name: 'compaction',
          value: { stage: 'starting', tier: 'full' },
          timestamp: Date.now(),
        })

        // Re-fetch conversation (may have been modified during the failed attempt)
        const freshConv = yield* conversationRepo
          .get(conversationId)
          .pipe(Effect.catchAll(() => Effect.succeed(conversation)))

        // Retry with the fresh conversation — the agent-loop's pre-run
        // compaction will now trigger since we're closer to the limit
        agentResult = yield* Effect.tryPromise({
          try: () =>
            runAgent({
              ...runParams,
              conversation: freshConv,
            }),
          catch: (err) => err,
        })
      }
    }

    // Propagate non-retried errors
    if (agentResult instanceof Error) {
      return yield* Effect.fail(agentResult)
    }

    if (signal.aborted || agentResult.newMessages.length === 0) {
      return { outcome: 'aborted' as const }
    }

    // ─── Persist messages ────────────────────────────────
    yield* persistNewMessages(
      conversationId,
      agentResult.newMessages,
      hydratedPayload,
      messageCountBeforeRun,
    )

    return {
      outcome: 'success' as const,
      newMessages: agentResult.newMessages,
      microcompactedToolResults: agentResult.microcompactedToolResults,
    }
  }).pipe(
    Effect.catchAll((err): Effect.Effect<AgentRunResult> => {
      if (err instanceof Error && err.message === 'aborted') {
        return Effect.succeed({ outcome: 'aborted' })
      }
      return Effect.gen(function* () {
        yield* persistUserMessage(input.conversationId, input.payload)
        const classified = classifyAgentError(err)
        return {
          outcome: 'error' as const,
          message: classified.userMessage,
          code: classified.code,
        }
      })
    }),
  )
}

/**
 * Persist partial response during cancel or steer (interrupt).
 * Saves both the user message and whatever assistant content was streamed.
 */
export function persistPartialResponse(
  conversationId: ConversationId,
  originalPayload: HydratedAgentSendPayload,
  partialParts: readonly MessagePart[],
  resolvedModel: SupportedModelId,
  messageCountBeforeRun?: number,
) {
  return Effect.gen(function* () {
    const repo = yield* ConversationRepository
    const conv = yield* repo.get(conversationId).pipe(Effect.catchAll(() => Effect.succeed(null)))
    if (!conv) return false
    const userMsg = makeMessage('user', buildPersistedUserMessageParts(originalPayload))
    const newMessages: Message[] = [userMsg]
    if (partialParts.length > 0) {
      newMessages.push(makeMessage('assistant', [...partialParts], resolvedModel))
    }

    // When messageCountBeforeRun is provided and the conversation has
    // already grown (e.g. a previous checkpoint saved partial messages),
    // replace from that point instead of appending duplicates.
    const baseMessages =
      messageCountBeforeRun !== undefined && conv.messages.length > messageCountBeforeRun
        ? conv.messages.slice(0, messageCountBeforeRun)
        : conv.messages

    yield* repo.save({
      ...conv,
      messages: [...baseMessages, ...newMessages],
    })
    return true
  }).pipe(
    Effect.catchAll((err) =>
      Effect.sync(() => {
        logger.error('Failed to persist partial response', {
          conversationId,
          error: formatErrorMessage(err),
        })
        return false
      }),
    ),
  )
}

// ─── Internal Helpers ────────────────────────────────────────

function persistNewMessages(
  conversationId: ConversationId,
  newMessages: readonly Message[],
  hydratedPayload: HydratedAgentSendPayload,
  messageCountGuard?: number,
) {
  return Effect.gen(function* () {
    const repo = yield* ConversationRepository
    const latestConversation = yield* repo
      .get(conversationId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)))
    if (!latestConversation) return

    // When the conversation has grown since the run started (checkpoint or
    // cancel already persisted partial messages), replace from the pre-run
    // point so the final complete messages overwrite the partial ones.
    const baseMessages =
      messageCountGuard !== undefined && latestConversation.messages.length > messageCountGuard
        ? (() => {
            logger.info('Replacing checkpointed messages with final run result', {
              conversationId,
              expected: messageCountGuard,
              actual: latestConversation.messages.length,
            })
            return latestConversation.messages.slice(0, messageCountGuard)
          })()
        : latestConversation.messages

    const updatedMessages = [...baseMessages, ...newMessages]
    yield* repo.save({ ...latestConversation, messages: updatedMessages })

    if (approvalTraceEnabled && (hydratedPayload.continuationMessages?.length ?? 0) > 0) {
      const persistedAssistantMessage = newMessages.find((m) => m.role === 'assistant')
      approvalTraceLogger.info('continuation-persisted', {
        conversationId,
        messageCount: updatedMessages.length,
        persistedToolResultCount:
          persistedAssistantMessage?.parts.filter((p) => p.type === 'tool-result').length ?? 0,
        persistedToolCallCount:
          persistedAssistantMessage?.parts.filter((p) => p.type === 'tool-call').length ?? 0,
      })
    }
  }).pipe(
    Effect.catchAll((persistError) =>
      Effect.sync(() => {
        logger.error('Failed to persist conversation', {
          conversationId,
          error: formatErrorMessage(persistError),
        })
        if (approvalTraceEnabled && (hydratedPayload.continuationMessages?.length ?? 0) > 0) {
          approvalTraceLogger.error('continuation-persist-failed', {
            conversationId,
            error: formatErrorMessage(persistError),
          })
        }
      }),
    ),
  )
}

/**
 * Persist a tool-result for an orphaned blocking tool-call after app restart.
 *
 * When the app dies while proposePlan/askUser blocks, the checkpoint saves
 * the tool-call without a result. On reload, the renderer re-renders the
 * approval UI. When the user responds, this function injects the tool-result
 * into the persisted conversation so the UI reflects the resolved state.
 */
export function persistRehydratedToolResult(
  conversationId: ConversationId,
  toolName: string,
  resultContent: string,
) {
  return Effect.gen(function* () {
    const repo = yield* ConversationRepository
    const conv = yield* repo.get(conversationId).pipe(Effect.catchAll(() => Effect.succeed(null)))
    if (!conv) return false

    // Find the last assistant message with an orphaned tool-call for toolName
    const messages = [...conv.messages]
    let updated = false
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== 'assistant') continue

      const orphanedToolCall = msg.parts.find(
        (p) =>
          p.type === 'tool-call' &&
          p.toolCall.name === toolName &&
          !msg.parts.some((r) => r.type === 'tool-result' && r.toolResult.id === p.toolCall.id),
      )

      if (!orphanedToolCall || orphanedToolCall.type !== 'tool-call') continue

      // Append the tool-result part to the message
      const toolResultPart: ToolResultPart = {
        type: 'tool-result',
        toolResult: {
          id: orphanedToolCall.toolCall.id,
          name: toolName,
          args: orphanedToolCall.toolCall.args,
          result: resultContent,
          isError: false,
          duration: 0,
        },
      }
      messages[i] = { ...msg, parts: [...msg.parts, toolResultPart] }
      updated = true
      break
    }

    if (!updated) return false
    yield* repo.save({ ...conv, messages })
    return true
  }).pipe(
    Effect.catchAll((err) =>
      Effect.sync(() => {
        logger.error('Failed to persist rehydrated tool result', {
          conversationId,
          toolName,
          error: formatErrorMessage(err),
        })
        return false
      }),
    ),
  )
}

function persistUserMessage(conversationId: ConversationId, payload: AgentSendPayload) {
  return Effect.promise(() =>
    import('../ipc/run-handler-utils').then((m) =>
      m.persistUserMessageOnFailure(conversationId, payload),
    ),
  ).pipe(
    Effect.catchAll((persistError) =>
      Effect.sync(() =>
        logger.error('Failed to persist user message after run error', {
          conversationId,
          error: formatErrorMessage(persistError),
        }),
      ),
    ),
  )
}
