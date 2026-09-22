import type { AgentSendPayload, AttachmentRecord } from '@shared/types/agent'
import type { UIMessage } from '@shared/types/chat-ui'
import { takeAttachmentPreviewUrl } from '@/shared/lib/attachment-preview-urls'

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

function buildClientUserMessageParts(
  payload: AgentSendPayload,
): Extract<UIMessage['parts'][number], { type: 'text' }>[] {
  const text = payload.text.trim()
  return [
    ...(text ? [{ type: 'text' as const, content: text }] : []),
    ...payload.attachments.map((attachment) => ({
      type: 'text' as const,
      content: formatAttachmentPreview(attachment),
    })),
  ]
}

export function buildClientUserMessage(payload: AgentSendPayload) {
  return buildClientUserMessageParts(payload)
    .map((part) => part.content)
    .join('\n\n')
}

export function createOptimisticUserMessage(payload: AgentSendPayload): UIMessage {
  optimisticUserMessageCounter += 1
  const imageParts: UIMessage['parts'] = payload.attachments.flatMap((attachment, index) => {
    const previewUrl = takeAttachmentPreviewUrl(attachment.id)
    return attachment.kind === 'image' && previewUrl
      ? [
          {
            type: 'image' as const,
            source: { value: previewUrl },
            name: attachment.name,
            attachmentIndex: index,
          },
        ]
      : []
  })

  return {
    id: `optimistic-user-${Date.now()}-${String(optimisticUserMessageCounter)}`,
    role: 'user',
    parts: [...imageParts, ...buildClientUserMessageParts(payload)],
    createdAt: new Date(),
    ...(payload.waggle
      ? {
          metadata: {
            waggleInvocation: {
              presetId: payload.waggle.presetId,
              presetName: payload.waggle.presetName,
              source: payload.waggle.source,
            },
          },
        }
      : {}),
  }
}
