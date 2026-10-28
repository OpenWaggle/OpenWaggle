import type { MessagePart, PreparedAttachment } from '@shared/types/agent'
import { boundedAttachmentText } from '@shared/utils/attachment-text'

export interface PersistedUserMessagePartsPayload {
  readonly text: string
  readonly attachments: readonly PreparedAttachment[]
}

/**
 * A user message's display parts. An attachment keeps a bounded preview of its text: the Host
 * resolves an auto-paste to its whole source for the model, and the display copy must still fit the
 * prepared-attachment schema every reader of the transcript enforces.
 */
export function buildPersistedUserMessageParts(
  payload: PersistedUserMessagePartsPayload,
): MessagePart[] {
  const parts: MessagePart[] = []
  if (payload.text.trim()) {
    parts.push({ type: 'text', text: payload.text.trim() })
  }
  for (const attachment of payload.attachments) {
    const persisted: PreparedAttachment = {
      id: attachment.id,
      kind: attachment.kind,
      origin: attachment.origin,
      name: attachment.name,
      path: attachment.path,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      ...(attachment.contentSha256 ? { contentSha256: attachment.contentSha256 } : {}),
      extractedText: boundedAttachmentText(attachment.extractedText),
    }
    parts.push({ type: 'attachment', attachment: persisted })
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}
