import type { AttachmentRecord, MessagePart } from '@shared/types/agent'
import type { Conversation } from '@shared/types/conversation'
import { chooseBy } from '@shared/utils/decision'
import type { StreamChunk } from '@tanstack/ai'
import type { UIMessage } from '@tanstack/ai-react'
import {
  buildPersistedToolCallLookup,
  restorePersistedToolCallPart,
} from '@/lib/persisted-tool-call-reconciliation'

// ─── MessagePart → UIMessage Parts Conversion ────────────────

const MAX_ATTACHMENT_PREVIEW_CHARS = 320

export function formatAttachmentPreview(
  attachment: Pick<AttachmentRecord, 'name' | 'extractedText' | 'origin'>,
): string {
  if (attachment.origin === 'auto-paste-text') {
    return `[Attachment] ${attachment.name}`
  }
  const preview = attachment.extractedText.trim()
  if (!preview) {
    return `[Attachment] ${attachment.name}`
  }
  const clipped =
    preview.length > MAX_ATTACHMENT_PREVIEW_CHARS
      ? `${preview.slice(0, MAX_ATTACHMENT_PREVIEW_CHARS)}...`
      : preview
  return `[Attachment] ${attachment.name}\n${clipped}`
}

/**
 * Convert a single persisted MessagePart to TanStack UIMessage parts.
 * Shared by both conversationToUIMessages (historical) and
 * buildPartialAssistantMessage (background reconnection).
 */
export function messagePartToUIParts(part: MessagePart): UIMessage['parts'] {
  return chooseBy(part, 'type')
    .case('text', (value): UIMessage['parts'] => [{ type: 'text', content: value.text }])
    .case('tool-call', (value): UIMessage['parts'] => [
      {
        type: 'tool-call',
        id: String(value.toolCall.id),
        name: value.toolCall.name,
        arguments: JSON.stringify(value.toolCall.args),
        state: value.toolCall.state ?? 'input-complete',
        approval: value.toolCall.approval,
      },
    ])
    .case('tool-result', (value): UIMessage['parts'] => [
      {
        type: 'tool-result',
        toolCallId: String(value.toolResult.id),
        content: value.toolResult.result,
        state: value.toolResult.isError ? 'error' : 'complete',
      },
    ])
    .case('attachment', (value): UIMessage['parts'] => [
      {
        type: 'text',
        content: formatAttachmentPreview(value.attachment),
      },
    ])
    .case('reasoning', (): UIMessage['parts'] => [])
    .assertComplete()
}

// ─── Conversation → UIMessage Conversion ─────────────────────

export function conversationToUIMessages(conv: Conversation): UIMessage[] {
  return conv.messages.map((msg) => ({
    id: String(msg.id),
    role: msg.role,
    parts: msg.parts.flatMap(messagePartToUIParts),
    createdAt: new Date(msg.createdAt),
  }))
}

export function restorePersistedToolCallMetadata(
  messages: UIMessage[],
  conversation: Conversation | null,
): UIMessage[] {
  const persistedToolCalls = buildPersistedToolCallLookup(conversation)
  let didChange = false

  const restoredMessages = messages.map((message) => {
    let messageChanged = false
    const restoredParts = message.parts.map((part) => {
      if (part.type !== 'tool-call') {
        return part
      }

      const restoredPart = restorePersistedToolCallPart(part, persistedToolCalls)
      if (restoredPart === part) {
        return part
      }

      didChange = true
      messageChanged = true
      return restoredPart
    })

    return messageChanged ? { ...message, parts: restoredParts } : message
  })

  return didChange ? restoredMessages : messages
}

// ─── Background Run Reconnection Helpers ─────────────────────

export function buildPartialAssistantMessage(parts: readonly MessagePart[]): UIMessage {
  const uiParts: UIMessage['parts'] = parts.flatMap(messagePartToUIParts)

  return {
    id: `bg-stream-${Date.now()}`,
    role: 'assistant',
    parts: uiParts.length > 0 ? uiParts : [{ type: 'text', content: '' }],
    createdAt: new Date(),
  }
}

// ─── Stream Delta Application ────────────────────────────────

/**
 * Apply a single stream chunk delta to the last assistant message.
 * Returns the same array reference if nothing changed, otherwise a new array.
 * Only handles text deltas — tool call/result parts arrive via TOOL_CALL_END
 * which triggers a full snapshot refresh from the main process.
 */
export function applyStreamDelta(chunk: StreamChunk, messages: UIMessage[]): UIMessage[] {
  if (chunk.type !== 'TEXT_MESSAGE_CONTENT') return messages

  const { delta } = chunk
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return messages

  const lastTextPartIndex = findLastTextPartIndex(last.parts)
  if (lastTextPartIndex === -1) {
    // No text part yet — add one
    const updatedParts = [...last.parts, { type: 'text' as const, content: delta }]
    return [...messages.slice(0, -1), { ...last, parts: updatedParts }]
  }

  const textPart = last.parts[lastTextPartIndex]
  if (textPart.type !== 'text') return messages

  const updatedParts = [...last.parts]
  updatedParts[lastTextPartIndex] = {
    type: 'text' as const,
    content: textPart.content + delta,
  }
  return [...messages.slice(0, -1), { ...last, parts: updatedParts }]
}

function findLastTextPartIndex(parts: UIMessage['parts']): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === 'text') return i
  }
  return -1
}
