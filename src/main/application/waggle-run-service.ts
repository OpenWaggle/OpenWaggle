/**
 * WaggleRunService — application-layer orchestration for waggle mode execution.
 *
 * Extracts business logic from waggle-handler.ts into Effect programs
 * that depend on hexagonal ports. The handler retains transport concerns
 * (abort controllers, active run tracking, stream buffers, IPC emission,
 * message ID stabilization, turn boundary injection).
 */
import { safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema } from '@shared/schemas/waggle'
import type { AgentSendPayload, HydratedAgentSendPayload, Message } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { AgentStreamChunk } from '@shared/types/stream'
import type { WaggleConfig, WaggleStreamMetadata, WaggleTurnEvent } from '@shared/types/waggle'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { startChatStream } from '../adapters/tanstack-chat-adapter'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import { runWaggleSequential } from '../agent/waggle-coordinator'
import { hydratePayloadAttachments, maybeTriggerTitleGeneration } from '../ipc/run-handler-utils'
import { createLogger } from '../logger'
import { ConversationRepository } from '../ports/conversation-repository'
import { runAppEffect } from '../runtime'
import { SettingsService } from '../services/settings-service'

const logger = createLogger('waggle-run-service')

// ─── Types ───────────────────────────────────────────────────

export interface WaggleRunInput {
  readonly conversationId: ConversationId
  readonly payload: AgentSendPayload
  readonly config: WaggleConfig
  readonly signal: AbortSignal
  readonly onStreamChunk: (chunk: AgentStreamChunk, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
}

export type WaggleRunResult =
  | {
      readonly outcome: 'success'
      readonly newMessages: readonly Message[]
      readonly lastError?: string
    }
  | { readonly outcome: 'aborted' }
  | { readonly outcome: 'validation-error'; readonly message: string; readonly code: string }
  | { readonly outcome: 'not-found'; readonly message: string; readonly code: string }
  | { readonly outcome: 'no-project'; readonly message: string; readonly code: string }
  | { readonly outcome: 'error'; readonly message: string; readonly code: string }

// ─── Service Functions ───────────────────────────────────────

/**
 * Validate preconditions, execute the waggle run, and persist results.
 * Returns a discriminated union describing the outcome.
 *
 * Transport callbacks (onStreamChunk, onTurnEvent) are passed through
 * to the waggle coordinator — they contain IPC-specific logic that
 * stays in the handler. onTurnComplete handles incremental persistence.
 */
export function executeWaggleRun(input: WaggleRunInput) {
  return Effect.gen(function* () {
    const { conversationId, payload, config, signal, onStreamChunk, onTurnEvent } = input

    // ─── Validate config ──────────────────────────────────
    const parseResult = safeDecodeUnknown(waggleConfigSchema, config)
    if (!parseResult.success) {
      return {
        outcome: 'validation-error' as const,
        message: 'Invalid Waggle mode configuration',
        code: 'validation-error',
      }
    }

    // ─── Fetch settings + conversation ────────────────────
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const conversationRepo = yield* ConversationRepository
    const conversation = yield* conversationRepo
      .get(conversationId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)))

    if (!conversation) {
      const errorInfo = makeErrorInfo('conversation-not-found', 'Conversation not found')
      return {
        outcome: 'not-found' as const,
        message: errorInfo.userMessage,
        code: errorInfo.code,
      }
    }

    // ─── Validate project path ────────────────────────────
    if (!conversation.projectPath) {
      return {
        outcome: 'no-project' as const,
        message: 'Please select a project folder before starting Waggle mode.',
        code: 'no-project',
      }
    }

    // ─── Title generation ─────────────────────────────────
    maybeTriggerTitleGeneration(
      conversationId,
      conversation,
      payload.text,
      settings,
      startChatStream,
    )

    // ─── Hydrate attachments ──────────────────────────────
    const hydratedPayload: HydratedAgentSendPayload = {
      ...payload,
      attachments: yield* Effect.promise(() => hydratePayloadAttachments(payload.attachments)),
    }

    // ─── Execute waggle run ───────────────────────────────
    const baseMessages = [...conversation.messages]

    const result = yield* Effect.tryPromise({
      try: () =>
        runWaggleSequential({
          conversationId,
          conversation,
          payload: hydratedPayload,
          config,
          settings,
          signal,
          chatStream: startChatStream,
          onStreamChunk,
          onTurnEvent,
          onTurnComplete: async (accumulatedMessages) => {
            await runAppEffect(
              Effect.gen(function* () {
                const repo = yield* ConversationRepository
                const latest = yield* repo
                  .get(conversationId)
                  .pipe(Effect.catchAll(() => Effect.succeed(null)))
                if (!latest) return
                yield* repo.save({
                  ...latest,
                  messages: [...baseMessages, ...accumulatedMessages],
                  waggleConfig: config,
                })
              }),
            )
          },
        }),
      catch: (err) => err,
    })

    // ─── Persist final messages ───────────────────────────
    if (result.newMessages.length > 0) {
      yield* persistWaggleMessages(conversationId, baseMessages, result.newMessages, config)
    }

    if (signal.aborted || result.newMessages.length === 0) {
      return { outcome: 'aborted' as const }
    }

    return {
      outcome: 'success' as const,
      newMessages: result.newMessages,
      lastError: result.lastError,
    }
  }).pipe(
    Effect.catchAll((err): Effect.Effect<WaggleRunResult> => {
      if (err instanceof Error && err.message === 'aborted') {
        return Effect.succeed({ outcome: 'aborted' })
      }
      return Effect.gen(function* () {
        yield* persistUserMessageOnFailure(input.conversationId, input.payload, input.config)
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

// ─── Internal Helpers ────────────────────────────────────────

function persistWaggleMessages(
  conversationId: ConversationId,
  baseMessages: readonly Message[],
  newMessages: readonly Message[],
  config: WaggleConfig,
) {
  return Effect.gen(function* () {
    const repo = yield* ConversationRepository
    const latestConversation = yield* repo
      .get(conversationId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)))
    if (!latestConversation) return
    const updatedMessages = [...baseMessages, ...newMessages]
    yield* repo.save({
      ...latestConversation,
      messages: updatedMessages,
      waggleConfig: config,
    })
  }).pipe(
    Effect.catchAll((persistError) =>
      Effect.sync(() =>
        logger.error('Failed to persist Waggle conversation', {
          conversationId,
          error: formatErrorMessage(persistError),
        }),
      ),
    ),
  )
}

function persistUserMessageOnFailure(
  conversationId: ConversationId,
  payload: AgentSendPayload,
  config: WaggleConfig,
) {
  return Effect.promise(() =>
    runAppEffect(
      Effect.gen(function* () {
        const repo = yield* ConversationRepository
        const conv = yield* repo
          .get(conversationId)
          .pipe(Effect.catchAll(() => Effect.succeed(null)))
        if (!conv) return

        const userMessage = makeMessage('user', buildPersistedUserMessageParts(payload))
        yield* repo.save({
          ...conv,
          messages: [...conv.messages, userMessage],
          waggleConfig: config,
        })
      }),
    ),
  ).pipe(
    Effect.catchAll((persistError) =>
      Effect.sync(() =>
        logger.error('Failed to persist user message after waggle run error', {
          conversationId,
          error: formatErrorMessage(persistError),
        }),
      ),
    ),
  )
}
