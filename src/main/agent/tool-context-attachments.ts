import type { HydratedAgentSendPayload } from '@shared/types/agent'
import type { Conversation } from '@shared/types/conversation'

export interface ToolContextAttachment {
  readonly name: string
  readonly extractedText: string
}

function mapPayloadAttachmentsToToolContext(
  payload: HydratedAgentSendPayload,
): readonly ToolContextAttachment[] {
  return payload.attachments.map((attachment) => ({
    name: attachment.name,
    extractedText: attachment.extractedText,
  }))
}

function findLatestUserAttachments(conversation: Conversation): readonly ToolContextAttachment[] {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (!message || message.role !== 'user') {
      continue
    }

    const attachments = message.parts
      .filter((part) => part.type === 'attachment')
      .map((part) => ({
        name: part.attachment.name,
        extractedText: part.attachment.extractedText,
      }))

    if (attachments.length > 0) {
      return attachments
    }
  }

  return []
}

export function resolveToolContextAttachments(
  conversation: Conversation,
  payload: HydratedAgentSendPayload,
): readonly ToolContextAttachment[] {
  const currentPayloadAttachments = mapPayloadAttachmentsToToolContext(payload)
  if (currentPayloadAttachments.length > 0) {
    return currentPayloadAttachments
  }

  return findLatestUserAttachments(conversation)
}
