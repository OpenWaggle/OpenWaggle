import type {
  AgentSendPayload,
  HydratedAgentSendPayload,
  PreparedAttachment,
} from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import { generateTitle } from '../agent/title-generator'
import { withConversationLock } from '../store/conversation-lock'
import { getConversation, saveConversation } from '../store/conversations'
import { emitStreamChunk } from '../utils/stream-bridge'
import { hydrateAttachmentSources } from './attachments-handler'

/** Emit RUN_ERROR + RUN_FINISHED pair for early-exit error paths. */
export function emitErrorAndFinish(
  conversationId: ConversationId,
  message: string,
  code: string,
  runId = '',
): void {
  emitStreamChunk(conversationId, {
    type: 'RUN_ERROR',
    timestamp: Date.now(),
    error: { message, code },
  })
  emitStreamChunk(conversationId, {
    type: 'RUN_FINISHED',
    timestamp: Date.now(),
    runId,
    finishReason: 'stop',
  })
}

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

  await withConversationLock(conversationId, async () => {
    const latestConversation = await getConversation(conversationId)
    if (!latestConversation) {
      return
    }

    if (
      options?.messageCountGuard !== undefined &&
      latestConversation.messages.length > options.messageCountGuard
    ) {
      return
    }

    await saveConversation({
      ...latestConversation,
      messages: [...latestConversation.messages, userMessage],
    })
  })
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
): void {
  if (conversation.title === 'New thread' && conversation.messages.length === 0) {
    const trimmed = text.trim()
    if (trimmed) {
      void generateTitle(conversationId, trimmed, settings)
    }
  }
}
