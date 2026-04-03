import type { HydratedAgentSendPayload } from '@shared/types/agent'
import type { Conversation } from '@shared/types/conversation'
import { choose } from '@shared/utils/decision'
import type { ProviderDefinition } from '../providers/provider-definition'
import type { SimpleChatMessage } from './message-mapper'
import { conversationToMessages, microcompactMessages } from './message-mapper'
import type { ChatContentPart } from './shared'

export function buildUserChatContent(
  provider: ProviderDefinition,
  payload: HydratedAgentSendPayload,
): string | ChatContentPart[] {
  const parts: ChatContentPart[] = []

  if (payload.text.trim()) {
    parts.push({ type: 'text', content: payload.text.trim() })
  }

  for (const attachment of payload.attachments) {
    if (attachment.source && provider.supportsAttachment(attachment.kind)) {
      const source = attachment.source
      choose(attachment.kind)
        .case('image', () => {
          parts.push({
            type: 'image',
            source,
          })
        })
        .case('pdf', () => {
          parts.push({
            type: 'document',
            source,
          })
        })
        .catchAll(() => undefined)
    }

    const extracted = attachment.extractedText.trim()
    const summary = extracted
      ? `[Attachment: ${attachment.name}]\n${extracted}`
      : `[Attachment: ${attachment.name}] (no extractable text)`
    parts.push({ type: 'text', content: summary })
  }

  if (parts.length === 0) return ''
  if (parts.length === 1 && parts[0]?.type === 'text') {
    return parts[0].content
  }
  return parts
}

export function buildFreshChatMessages(
  conversation: Conversation,
  provider: ProviderDefinition,
  payload: HydratedAgentSendPayload,
): SimpleChatMessage[] {
  const raw: SimpleChatMessage[] = [
    ...conversationToMessages(conversation.messages),
    {
      role: 'user',
      content: buildUserChatContent(provider, payload),
    },
  ]
  // Tier 1 microcompaction: strip old tool results to keep context bounded.
  // Keeps the 5 most recent tool results intact; replaces older ones with placeholders.
  return microcompactMessages(raw).messages
}
