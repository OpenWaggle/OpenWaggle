import type { CompactionEventPart } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { PinnedItemInput } from '@shared/types/context'
import * as Effect from 'effect/Effect'
import { buildFreshChatMessages } from '../agent/agent-message-builder'
import { makeMessage } from '../agent/shared'
import { DEFAULT_CONTEXT_WINDOW_TOKENS } from '../domain/compaction/compaction-types'
import { estimateTokens } from '../domain/compaction/token-estimation'
import { wrapChatAdapter } from '../ports/chat-adapter-type'
import { ChatService } from '../ports/chat-service'
import { ContextCompactionService } from '../ports/context-compaction-service'
import { ConversationRepository } from '../ports/conversation-repository'
import { PinnedContextRepository } from '../ports/pinned-context-repository'
import * as contextSnapshotService from '../services/context-snapshot-service'
import { SettingsService } from '../services/settings-service'
import { typedHandle } from './typed-ipc'

export function registerContextHandlers(): void {
  typedHandle('context:get-baseline', () =>
    Effect.gen(function* () {
      const settings = yield* SettingsService
      const currentSettings = yield* settings.get()
      return contextSnapshotService.computeBaselineSnapshot(currentSettings.selectedModel)
    }),
  )

  typedHandle('context:get-snapshot', (_event, conversationId: ConversationId) =>
    Effect.gen(function* () {
      // Always recompute — the cached snapshot may use a stale model
      const repo = yield* ConversationRepository
      const conversation = yield* repo.get(conversationId)
      const pinRepo = yield* PinnedContextRepository
      const pinnedTokens = yield* pinRepo.getTokenEstimate(conversationId)
      const pinnedItems = yield* pinRepo.list(conversationId)

      // Always use the currently selected model from settings
      const settings = yield* SettingsService
      const currentSettings = yield* settings.get()

      return contextSnapshotService.computeAndPushSnapshot(conversationId, {
        source: 'estimate',
        messages: conversation.messages,
        modelId: currentSettings.selectedModel,
        pinnedTokens,
        pinnedItemCount: pinnedItems.length,
        pinnedMessageIds: pinnedItems.filter((p) => p.messageId).map((p) => String(p.messageId)),
        waggleConfig: conversation.waggleConfig,
      })
    }),
  )

  typedHandle('context:compact', (_event, conversationId: ConversationId, guidance?: string) =>
    Effect.gen(function* () {
      const repo = yield* ConversationRepository
      const conversation = yield* repo.get(conversationId)

      // Save guidance if provided
      if (guidance) {
        yield* repo.updateCompactionGuidance(conversationId, guidance)
      }

      // Read pinned content for preservation
      const pinRepo = yield* PinnedContextRepository
      const pinnedItems = yield* pinRepo.list(conversationId)
      const pinnedContent = pinnedItems.map((item) => item.content)

      // Use currently selected model from settings
      const settings = yield* SettingsService
      const currentSettings = yield* settings.get()
      const selectedModel = currentSettings.selectedModel
      // Resolve provider + credentials for the selected model
      const { resolveModelCredentials } = yield* Effect.promise(
        () => import('../providers/resolve-model-credentials'),
      )
      const credentials = yield* Effect.promise(() =>
        resolveModelCredentials(selectedModel, currentSettings),
      )
      if (!credentials) {
        return yield* Effect.fail(
          new Error(`Provider credentials not available for model ${String(selectedModel)}`),
        )
      }

      const contextWindow = credentials.provider.getContextWindow?.(String(selectedModel))
      const contextTokens = contextWindow?.contextTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS

      // Build messages in compaction format
      const { messages: freshMessages } = buildFreshChatMessages(
        conversation,
        credentials.provider,
        {
          text: '',
          qualityPreset: 'medium',
          attachments: [],
        },
      )

      // Get chat service for the compaction LLM call
      const chatService = yield* ChatService
      const adapter = wrapChatAdapter(
        credentials.provider.createAdapter(
          String(selectedModel),
          credentials.apiKey,
          credentials.baseUrl,
          credentials.authMethod,
        ),
      )

      // Manual compaction always runs — the user explicitly requested it.
      // The threshold check is only for automatic pre-run compaction in agent-loop.
      const compactionService = yield* ContextCompactionService

      const compacted = yield* compactionService.compact({
        messages: freshMessages,
        systemPrompt: '',
        contextWindowTokens: contextTokens,
        customInstructions: guidance ?? conversation.compactionGuidance ?? undefined,
        pinnedContent: pinnedContent.length > 0 ? pinnedContent : undefined,
        chatStream: (options) => Effect.runSync(chatService.stream(options)),
        adapter,
      })

      // Create system message with compaction event
      const compactionTimestamp = Date.now()
      const compactionEventPart: CompactionEventPart = {
        type: 'compaction-event',
        data: {
          tier: 'full',
          trigger: 'manual',
          description: `Compacted ${compacted.result.originalTokenEstimate} → ${compacted.result.compactedTokenEstimate} tokens`,
          metrics: {
            tokensBefore: compacted.result.originalTokenEstimate,
            tokensAfter: compacted.result.compactedTokenEstimate,
            messagesSummarized: compacted.result.recentMessagesPreserved,
          },
          timestamp: compactionTimestamp,
          pinnedContentSummarized: compacted.result.pinnedContentSummarized,
        },
      }
      // Mark summarized messages as compacted in the database.
      // The compaction result tells us how many recent messages were preserved;
      // all messages before that are considered summarized.
      const totalMessages = conversation.messages.length
      const preservedCount = compacted.result.recentMessagesPreserved
      const summarizedMessages = conversation.messages.slice(
        0,
        Math.max(0, totalMessages - preservedCount),
      )
      const summarizedMessageIds = summarizedMessages.map((m) => String(m.id))

      // Mark summarized messages in the database via the repository port
      yield* repo.markMessagesAsCompacted(conversationId, summarizedMessageIds)

      // Re-fetch the latest conversation (may have been modified during compaction)
      // and append the compaction event system message
      const latestConversation = yield* repo.get(conversationId)
      const systemMsg = makeMessage('system', [compactionEventPart])
      yield* repo.save({
        ...latestConversation,
        messages: [...latestConversation.messages, systemMsg],
        updatedAt: compactionTimestamp,
      })

      // Push updated snapshot
      const pinnedTokens = yield* pinRepo.getTokenEstimate(conversationId)
      const updatedPinnedItems = yield* pinRepo.list(conversationId)
      contextSnapshotService.onCompactionCompleted(conversationId, {
        messages: [...latestConversation.messages, systemMsg],
        modelId: selectedModel,
        pinnedTokens,
        pinnedItemCount: updatedPinnedItems.length,
        pinnedMessageIds: updatedPinnedItems
          .filter((p) => p.messageId)
          .map((p) => String(p.messageId)),
        waggleConfig: latestConversation.waggleConfig,
      })
    }),
  )

  typedHandle('context:pin-add', (_event, conversationId: ConversationId, item: PinnedItemInput) =>
    Effect.gen(function* () {
      const pinRepo = yield* PinnedContextRepository
      const pinned = yield* pinRepo.add(conversationId, item)

      // Push updated snapshot
      const repo = yield* ConversationRepository
      const conversation = yield* repo.get(conversationId)
      const pinnedTokens = yield* pinRepo.getTokenEstimate(conversationId)
      const pinnedItems = yield* pinRepo.list(conversationId)
      const pinSettings = yield* SettingsService
      const pinCurrentSettings = yield* pinSettings.get()
      const selectedModel = pinCurrentSettings.selectedModel

      contextSnapshotService.onPinChange(conversationId, {
        messages: conversation.messages,
        modelId: selectedModel,
        pinnedTokens,
        pinnedItemCount: pinnedItems.length,
        pinnedMessageIds: pinnedItems.filter((p) => p.messageId).map((p) => String(p.messageId)),
        waggleConfig: conversation.waggleConfig,
      })

      return pinned
    }),
  )

  typedHandle('context:pin-remove', (_event, conversationId: ConversationId, pinId: string) =>
    Effect.gen(function* () {
      const pinRepo = yield* PinnedContextRepository
      yield* pinRepo.remove(conversationId, pinId)

      // Push updated snapshot
      const repo = yield* ConversationRepository
      const conversation = yield* repo.get(conversationId)
      const pinnedTokens = yield* pinRepo.getTokenEstimate(conversationId)
      const pinnedItems = yield* pinRepo.list(conversationId)
      const pinSettings = yield* SettingsService
      const pinCurrentSettings = yield* pinSettings.get()
      const selectedModel = pinCurrentSettings.selectedModel

      contextSnapshotService.onPinChange(conversationId, {
        messages: conversation.messages,
        modelId: selectedModel,
        pinnedTokens,
        pinnedItemCount: pinnedItems.length,
        pinnedMessageIds: pinnedItems.filter((p) => p.messageId).map((p) => String(p.messageId)),
        waggleConfig: conversation.waggleConfig,
      })
    }),
  )

  typedHandle(
    'context:pin-remove-by-message',
    (_event, conversationId: ConversationId, messageId: string) =>
      Effect.gen(function* () {
        const pinRepo = yield* PinnedContextRepository
        yield* pinRepo.removeByMessageId(conversationId, messageId)

        // Push updated snapshot
        const repo = yield* ConversationRepository
        const conversation = yield* repo.get(conversationId)
        const pinSettings = yield* SettingsService
        const pinCurrentSettings = yield* pinSettings.get()
        const selectedModel = pinCurrentSettings.selectedModel
        const pinnedTokens = yield* pinRepo.getTokenEstimate(conversationId)
        const pinnedItems = yield* pinRepo.list(conversationId)

        contextSnapshotService.onPinChange(conversationId, {
          messages: conversation.messages,
          modelId: selectedModel,
          pinnedTokens,
          pinnedItemCount: pinnedItems.length,
          pinnedMessageIds: pinnedItems.filter((p) => p.messageId).map((p) => String(p.messageId)),
          waggleConfig: conversation.waggleConfig,
        })
      }),
  )

  typedHandle('context:pin-list', (_event, conversationId: ConversationId) =>
    Effect.gen(function* () {
      const pinRepo = yield* PinnedContextRepository
      return yield* pinRepo.list(conversationId)
    }),
  )

  typedHandle('context:model-compatibility', (_event, conversationId: ConversationId) =>
    Effect.gen(function* () {
      // Use cached snapshot or compute a fresh estimate from conversation
      let usedTokens = contextSnapshotService.getSnapshot(conversationId)?.usedTokens
      if (usedTokens === undefined) {
        const repo = yield* ConversationRepository
        const conv = yield* repo
          .get(conversationId)
          .pipe(Effect.catchAll(() => Effect.succeed(null)))
        if (conv) {
          // Rough estimate for compatibility classification
          usedTokens = conv.messages.reduce(
            (sum, m) =>
              sum +
              m.parts.reduce((ps, p) => ps + (p.type === 'text' ? estimateTokens(p.text) : 0), 0),
            0,
          )
        }
      }

      // Get enabled models from settings
      const settings = yield* SettingsService
      const currentSettings = yield* settings.get()

      return contextSnapshotService.computeModelCompatibility(
        usedTokens ?? 0,
        currentSettings.enabledModels,
      )
    }),
  )

  typedHandle(
    'context:update-compaction-guidance',
    (_event, conversationId: ConversationId, guidance: string | null) =>
      Effect.gen(function* () {
        const repo = yield* ConversationRepository
        yield* repo.updateCompactionGuidance(conversationId, guidance)
      }),
  )
}
