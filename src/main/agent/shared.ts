import { randomUUID } from 'node:crypto'
import type { Message, MessagePart, PreparedAttachment } from '@shared/types/agent'
import { MessageId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'

export function makeMessage(
  role: 'user' | 'assistant' | 'system',
  parts: MessagePart[],
  model?: SupportedModelId,
  metadata?: Message['metadata'],
): Message {
  return {
    id: MessageId(randomUUID()),
    role,
    parts,
    model,
    metadata,
    createdAt: Date.now(),
  }
}

export interface PersistedUserMessagePartsPayload {
  readonly text: string
  readonly attachments: readonly PreparedAttachment[]
}

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
      extractedText: attachment.extractedText,
    }
    parts.push({ type: 'attachment', attachment: persisted })
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}
