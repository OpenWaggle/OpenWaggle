import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { AgentStreamChunk } from '@shared/types/stream'
import type { WaggleConfig, WaggleStreamMetadata } from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import * as Effect from 'effect/Effect'
import { classifyAgentError } from '../agent/error-classifier'
import { executeWaggleRun } from '../application/waggle-run-service'
import { createLogger } from '../logger'
import { ConversationRepository } from '../ports/conversation-repository'
import { PinnedContextRepository } from '../ports/pinned-context-repository'
import { runAppEffect } from '../runtime'
import * as contextSnapshotService from '../services/context-snapshot-service'
import { SettingsService } from '../services/settings-service'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitStreamChunk,
  emitWaggleStreamChunk,
  emitWaggleTurnEvent,
  startStreamBuffer,
} from '../utils/stream-bridge'
import { ActiveRunManager } from './active-run-manager'
import { emitErrorAndFinish } from './run-handler-utils'
import { typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('waggle-handler')

const activeWaggleRuns = new ActiveRunManager<ConversationId, Record<string, never>>()
const BASE36_RADIX = 36
const RANDOM_TOKEN_START = 2

function createRunScopedMessageToken(): string {
  return `${Date.now().toString(BASE36_RADIX)}-${Math.random()
    .toString(BASE36_RADIX)
    .slice(RANDOM_TOKEN_START)}`
}

function getStableTurnMessageId(
  conversationId: ConversationId,
  runToken: string,
  turnNumber: number,
  turnMessageIds: Map<number, string>,
): string {
  const existing = turnMessageIds.get(turnNumber)
  if (existing) {
    return existing
  }

  const stableMessageId = `waggle-${String(conversationId)}-${runToken}-turn-${String(turnNumber)}`
  turnMessageIds.set(turnNumber, stableMessageId)
  return stableMessageId
}

export function registerWaggleHandlers(): void {
  typedHandle(
    'agent:send-waggle-message',
    (_event, conversationId: ConversationId, payload: AgentSendPayload, config: WaggleConfig) =>
      Effect.gen(function* () {
        // ─── Cancel existing run ────────────────────────────
        if (activeWaggleRuns.has(conversationId)) {
          activeWaggleRuns.cancel(conversationId)
          clearAgentPhase(conversationId)
        }

        const abortController = new AbortController()
        activeWaggleRuns.register(conversationId, abortController, {})

        // ─── Transport state for stream callbacks ───────────
        let lastEmittedTurn = -1
        const runScopedMessageToken = createRunScopedMessageToken()
        const turnMessageIds = new Map<number, string>()

        yield* Effect.ensuring(
          Effect.gen(function* () {
            const firstAgentModel = config.agents?.[0]?.model
            if (firstAgentModel) {
              startStreamBuffer(conversationId, firstAgentModel, 'waggle')
            }

            emitStreamChunk(conversationId, {
              type: 'RUN_STARTED',
              timestamp: Date.now(),
              runId: `waggle-${conversationId}`,
            })

            // Push snapshot with waggle config so inspector shows waggle section immediately.
            // Non-blocking: snapshot push failure must not block the waggle run.
            yield* Effect.gen(function* () {
              const repo = yield* ConversationRepository
              const conv = yield* repo
                .get(conversationId)
                .pipe(Effect.catchAll(() => Effect.succeed(null)))
              if (conv) {
                const settings = yield* SettingsService
                const currentSettings = yield* settings.get()
                const pinRepo = yield* PinnedContextRepository
                const pinnedTokens = yield* pinRepo.getTokenEstimate(conversationId)
                const pinnedItems = yield* pinRepo.list(conversationId)
                contextSnapshotService.onWaggleStateChange(conversationId, {
                  messages: conv.messages,
                  modelId: currentSettings.selectedModel,
                  pinnedTokens,
                  pinnedItemCount: pinnedItems.length,
                  pinnedMessageIds: pinnedItems
                    .filter((p) => p.messageId)
                    .map((p) => String(p.messageId)),
                  waggleConfig: config,
                })
              }
            }).pipe(
              Effect.catchAll((err) => {
                logger.warn('Waggle initial snapshot push failed', {
                  conversationId,
                  error: err instanceof Error ? err.message : String(err),
                })
                return Effect.void
              }),
              Effect.catchAllDefect((defect) => {
                logger.warn('Defect in waggle initial snapshot push', { conversationId, defect })
                return Effect.void
              }),
            )

            const result = yield* executeWaggleRun({
              conversationId,
              payload,
              config,
              signal: abortController.signal,
              onStreamChunk: (chunk: AgentStreamChunk, meta: WaggleStreamMetadata) => {
                if (
                  chunk.type === 'RUN_STARTED' ||
                  chunk.type === 'RUN_FINISHED' ||
                  chunk.type === 'RUN_ERROR'
                ) {
                  emitWaggleStreamChunk(conversationId, chunk, meta)
                  return
                }

                // Normalize all text message chunk IDs to one stable ID per turn.
                let normalizedChunk = chunk
                if (
                  chunk.type === 'TEXT_MESSAGE_START' ||
                  chunk.type === 'TEXT_MESSAGE_CONTENT' ||
                  chunk.type === 'TEXT_MESSAGE_END'
                ) {
                  const stableMessageId = getStableTurnMessageId(
                    conversationId,
                    runScopedMessageToken,
                    meta.turnNumber,
                    turnMessageIds,
                  )
                  if (chunk.messageId !== stableMessageId) {
                    normalizedChunk = { ...chunk, messageId: stableMessageId }
                  }
                }

                emitWaggleStreamChunk(conversationId, normalizedChunk, meta)

                // Emit turn boundary on first chunk of a new turn.
                if (meta.turnNumber > lastEmittedTurn) {
                  if (meta.turnNumber > 0 && !meta.isSynthesis) {
                    const boundaryId = meta.isSynthesis
                      ? 'turn-boundary-synthesis'
                      : `turn-boundary-${String(meta.turnNumber)}`
                    const boundaryMeta = JSON.stringify({
                      agentIndex: meta.agentIndex,
                      agentLabel: meta.agentLabel,
                      agentColor: meta.agentColor,
                      agentModel: meta.agentModel,
                      turnNumber: meta.turnNumber,
                      ...(meta.isSynthesis ? { isSynthesis: true } : {}),
                    })
                    emitStreamChunk(conversationId, {
                      type: 'TOOL_CALL_START',
                      timestamp: Date.now(),
                      toolCallId: boundaryId,
                      toolName: '_turnBoundary',
                    })
                    emitStreamChunk(conversationId, {
                      type: 'TOOL_CALL_ARGS',
                      timestamp: Date.now(),
                      toolCallId: boundaryId,
                      delta: boundaryMeta,
                    })
                    emitStreamChunk(conversationId, {
                      type: 'TOOL_CALL_END',
                      timestamp: Date.now(),
                      toolCallId: boundaryId,
                      toolName: '_turnBoundary',
                      result: boundaryMeta,
                      input: {},
                    })
                  }
                  lastEmittedTurn = meta.turnNumber
                }

                emitStreamChunk(conversationId, normalizedChunk)
              },
              onTurnEvent: (event) => {
                emitWaggleTurnEvent(conversationId, event)
              },
            })

            // ─── Handle outcome ───────────────────────────────
            chooseBy(result, 'outcome')
              .case('validation-error', (r) => {
                emitErrorAndFinish(conversationId, r.message, r.code, `waggle-${conversationId}`)
              })
              .case('not-found', (r) => {
                emitErrorAndFinish(conversationId, r.message, r.code, `waggle-${conversationId}`)
              })
              .case('no-project', (r) => {
                emitErrorAndFinish(conversationId, r.message, r.code, `waggle-${conversationId}`)
              })
              .case('aborted', () => {
                emitStreamChunk(conversationId, {
                  type: 'RUN_FINISHED',
                  timestamp: Date.now(),
                  runId: `waggle-${conversationId}`,
                  finishReason: 'stop',
                })
              })
              .case('error', (r) => {
                emitErrorAndFinish(conversationId, r.message, r.code, `waggle-${conversationId}`)
              })
              .case('success', (r) => {
                const assistantCount = r.newMessages.filter((m) => m.role === 'assistant').length
                if (assistantCount === 0 && r.lastError) {
                  const classified = classifyAgentError(new Error(r.lastError))
                  emitErrorAndFinish(
                    conversationId,
                    classified.userMessage,
                    classified.code,
                    `waggle-${conversationId}`,
                  )
                  return
                }

                emitStreamChunk(conversationId, {
                  type: 'RUN_FINISHED',
                  timestamp: Date.now(),
                  runId: `waggle-${conversationId}`,
                  finishReason: 'stop',
                })

                // Push updated context snapshot after waggle run
                void runAppEffect(
                  Effect.gen(function* () {
                    const repo = yield* ConversationRepository
                    const updatedConv = yield* repo
                      .get(conversationId)
                      .pipe(Effect.catchAll(() => Effect.succeed(null)))
                    if (updatedConv) {
                      const settings = yield* SettingsService
                      const currentSettings = yield* settings.get()
                      const pinRepo = yield* PinnedContextRepository
                      const pinnedTokens = yield* pinRepo.getTokenEstimate(conversationId)
                      const pinnedItems = yield* pinRepo.list(conversationId)
                      contextSnapshotService.onWaggleStateChange(conversationId, {
                        messages: updatedConv.messages,
                        modelId: currentSettings.selectedModel,
                        pinnedTokens,
                        pinnedItemCount: pinnedItems.length,
                        pinnedMessageIds: pinnedItems
                          .filter((p) => p.messageId)
                          .map((p) => String(p.messageId)),
                        waggleConfig: undefined, // Cleared after run — snapshot reverts to standard mode
                      })
                    }
                  }),
                )
              })
              .assertComplete()
          }),
          Effect.sync(() => {
            activeWaggleRuns.delete(conversationId)
            clearStreamBuffer(conversationId)
            emitRunCompleted(conversationId)
          }),
        )
      }),
  )

  typedOn('agent:cancel-waggle', (_event, conversationId: ConversationId) =>
    Effect.sync(() => {
      activeWaggleRuns.cancel(conversationId)
      clearAgentPhase(conversationId)
    }),
  )
}
