import type {
  AgentSendPayload,
  HydratedAgentSendPayload,
  PreparedAttachment,
} from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
import type { AgentStreamChunk } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import { generateTitle } from '../agent/title-generator'
import type { ChatStreamOptions } from '../ports/chat-service'
import { ConversationRepository } from '../ports/conversation-repository'
import { ProviderService } from '../ports/provider-service'
import { runAppEffect } from '../runtime'
import { broadcastToWindows } from '../utils/broadcast'
import { hydrateAttachmentSources } from './attachments-handler'

// Re-export from canonical location for handler imports
export { emitErrorAndFinish } from '../utils/stream-bridge'

/** Check whether a user payload contains text or attachments worth persisting. */
export function hasPersistableUserInput(payload: AgentSendPayload): boolean {
  return payload.text.trim().length > 0 || payload.attachments.length > 0
}

/**
 * Persist the user's message to the conversation on failure paths so that
 * refreshing the conversation doesn't show an empty state.
 *
 * When `messageCountGuard` is provided, the message is only added if the
 * conversation's current message count does not exceed the guard. This lets
 * Waggle skip persistence when `onTurnComplete` has already saved progress.
 */
export async function persistUserMessageOnFailure(
  conversationId: ConversationId,
  payload: AgentSendPayload,
  options?: { readonly messageCountGuard?: number },
): Promise<void> {
  if (!hasPersistableUserInput(payload)) {
    return
  }

  const userMessage = makeMessage('user', buildPersistedUserMessageParts(payload))

  await runAppEffect(
    Effect.gen(function* () {
      const repo = yield* ConversationRepository
      const latestConversation = yield* repo
        .get(conversationId)
        .pipe(Effect.catchAll(() => Effect.succeed(null)))
      if (!latestConversation) {
        return
      }

      if (
        options?.messageCountGuard !== undefined &&
        latestConversation.messages.length > options.messageCountGuard
      ) {
        return
      }

      yield* repo.save({
        ...latestConversation,
        messages: [...latestConversation.messages, userMessage],
      })
    }),
  )
}

/** Hydrate attachment binary sources from prepared attachment records. */
export async function hydratePayloadAttachments(
  attachments: readonly PreparedAttachment[],
): Promise<HydratedAgentSendPayload['attachments']> {
  return hydrateAttachmentSources(attachments)
}

/** Fire-and-forget LLM title generation on first message of a new thread. */
export function maybeTriggerTitleGeneration(
  conversationId: ConversationId,
  conversation: Conversation,
  text: string,
  settings: Settings,
  chatStream: (options: ChatStreamOptions) => AsyncIterable<AgentStreamChunk>,
): void {
  if (conversation.title === 'New thread' && conversation.messages.length === 0) {
    const trimmed = text.trim()
    if (trimmed) {
      void runAppEffect(
        Effect.gen(function* () {
          const providerSvc = yield* ProviderService
          const allProviders = yield* providerSvc.getAll()

          // Find the first enabled provider with an API key for title gen
          let titleAdapter: import('../ports/chat-adapter-type').ChatAdapter | null = null
          for (const provider of allProviders) {
            const config = settings.providers[provider.id]
            if (config?.enabled && config.apiKey) {
              const adapterResult = yield* providerSvc
                .createChatAdapter(
                  provider.testModel,
                  config.apiKey,
                  config.baseUrl,
                  config.authMethod,
                )
                .pipe(Effect.catchAll(() => Effect.succeed(null)))
              if (adapterResult) {
                titleAdapter = adapterResult
                break
              }
            }
          }

          yield* Effect.promise(() =>
            generateTitle({
              conversationId,
              userText: trimmed,
              chatStream,
              adapter: titleAdapter,
              persistTitle: async (id, title) => {
                await runAppEffect(
                  Effect.gen(function* () {
                    const repo = yield* ConversationRepository
                    yield* repo.updateTitle(id, title)
                  }),
                )
                broadcastToWindows('conversations:title-updated', { conversationId: id, title })
              },
            }),
          )
        }),
      ).catch(() => {
        // Fire-and-forget — title generation failure is non-critical
      })
    }
  }
}
