import type { HydratedAgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import * as Effect from 'effect/Effect'
import { buildDeterministicTitle } from '../agent/title-generator'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { hydrateAttachmentSources } from '../utils/attachment-hydration'

/** Hydrate attachment binary sources from prepared attachment records. */
export async function hydratePayloadAttachments(
  attachments: readonly PreparedAttachment[],
): Promise<HydratedAgentSendPayload['attachments']> {
  return hydrateAttachmentSources(attachments)
}

/** Persist a deterministic name for a new projected session from the first user message. */
export function assignSessionTitleFromUserText(
  conversationId: ConversationId,
  conversation: Conversation,
  text: string,
) {
  return Effect.gen(function* () {
    if (conversation.title !== 'New session' || conversation.messages.length > 0) {
      return null
    }

    const trimmed = text.trim()
    if (!trimmed) {
      return null
    }

    const title = buildDeterministicTitle(trimmed)
    const repo = yield* SessionProjectionRepository
    yield* repo.updateTitle(conversationId, title)
    return title
  })
}
