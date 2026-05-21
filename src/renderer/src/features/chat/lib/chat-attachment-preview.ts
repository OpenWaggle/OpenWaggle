import type { AgentSendPayload, AttachmentRecord } from '@shared/types/agent'
import type { UIMessage } from '@shared/types/chat-ui'

const MAX_ATTACHMENT_PREVIEW_CHARS = 320
let optimisticUserMessageCounter = 0

/** Prefix used to identify attachment text parts in UIMessage rendering. */
export const ATTACHMENT_TEXT_PREFIX = '[Attachment] '

export function formatAttachmentPreview(
  attachment: Pick<AttachmentRecord, 'name' | 'extractedText' | 'origin'>,
) {
  if (attachment.origin === 'auto-paste-text') {
    return `${ATTACHMENT_TEXT_PREFIX}${attachment.name}`
  }
  const preview = attachment.extractedText.trim()
  if (!preview) {
    return `${ATTACHMENT_TEXT_PREFIX}${attachment.name}`
  }
  const clipped =
    preview.length > MAX_ATTACHMENT_PREVIEW_CHARS
      ? `${preview.slice(0, MAX_ATTACHMENT_PREVIEW_CHARS)}...`
      : preview
  return `${ATTACHMENT_TEXT_PREFIX}${attachment.name}\n${clipped}`
}

export function buildClientUserMessage(payload: AgentSendPayload) {
  const chunks: string[] = []
  const text = payload.text.trim()
  if (text) {
    chunks.push(text)
  }
  for (const attachment of payload.attachments) {
    chunks.push(formatAttachmentPreview(attachment))
  }
  return chunks.join('\n\n')
}

export function createOptimisticUserMessage(payload: AgentSendPayload): UIMessage {
  optimisticUserMessageCounter += 1

  return {
    id: `optimistic-user-${Date.now()}-${String(optimisticUserMessageCounter)}`,
    role: 'user',
    parts: [
      {
        type: 'text',
        content: buildClientUserMessage(payload),
      },
    ],
    createdAt: new Date(),
  }
}
