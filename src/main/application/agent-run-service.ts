/**
 * AgentRunService — application-layer orchestration for agent message execution.
 *
 * Extracts business logic from agent-handler.ts into Effect programs
 * that depend on hexagonal ports. The handler retains transport concerns
 * (abort controllers, active run tracking, stream buffers, IPC emission).
 */
import type { AgentSendPayload, HydratedAgentSendPayload, Message } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentStreamChunk } from '@shared/types/stream'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { startChatStream } from '../adapters/tanstack-chat-adapter'
import { runAgent } from '../agent/agent-loop'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import type { StreamPartCollector } from '../agent/stream-part-collector'
import { approvalTraceEnabled } from '../env'
import { hydratePayloadAttachments, maybeTriggerTitleGeneration } from '../ipc/run-handler-utils'
import { createLogger } from '../logger'
import { ConversationRepository } from '../ports/conversation-repository'
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
}

export type AgentRunResult =
  | { readonly outcome: 'success'; readonly newMessages: readonly Message[] }
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

    // ─── Settings + title generation ─────────────────────
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()

    maybeTriggerTitleGeneration(
      conversationId,
      conversation,
      payload.text,
      settings,
      startChatStream,
    )

    // ─── Hydrate attachments ─────────────────────────────
    const hydratedPayload: HydratedAgentSendPayload = {
      ...payload,
      attachments: yield* Effect.promise(() => hydratePayloadAttachments(payload.attachments)),
    }

    // ─── Execute agent run ───────────────────────────────
    const agentResult = yield* Effect.tryPromise({
      try: () =>
        runAgent({
          conversation,
          payload: hydratedPayload,
          model,
          settings,
          chatStream: startChatStream,
          onChunk,
          signal,
          onCollectorCreated,
        }),
      catch: (err) => err,
    })

    if (signal.aborted || agentResult.newMessages.length === 0) {
      return { outcome: 'aborted' as const }
    }

    // ─── Persist messages ────────────────────────────────
    yield* persistNewMessages(conversationId, agentResult.newMessages, hydratedPayload)

    return { outcome: 'success' as const, newMessages: agentResult.newMessages }
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
 * Persist partial response during steer (interrupt).
 */
export function persistPartialSteerResponse(
  conversationId: ConversationId,
  originalPayload: HydratedAgentSendPayload,
  partialParts: readonly import('@shared/types/agent').MessagePart[],
  resolvedModel: SupportedModelId,
) {
  return Effect.gen(function* () {
    const repo = yield* ConversationRepository
    const conv = yield* repo.get(conversationId).pipe(Effect.catchAll(() => Effect.succeed(null)))
    if (!conv) return false
    const userMsg = makeMessage('user', buildPersistedUserMessageParts(originalPayload))
    const assistantMsg = makeMessage('assistant', [...partialParts], resolvedModel)
    yield* repo.save({
      ...conv,
      messages: [...conv.messages, userMsg, assistantMsg],
    })
    return true
  }).pipe(
    Effect.catchAll((err) =>
      Effect.sync(() => {
        logger.error('Failed to persist partial response during steer', {
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
) {
  return Effect.gen(function* () {
    const repo = yield* ConversationRepository
    const latestConversation = yield* repo
      .get(conversationId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)))
    if (!latestConversation) return

    const updatedMessages = [...latestConversation.messages, ...newMessages]
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
