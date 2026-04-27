import type { AttachmentRecord, MessagePart } from '@shared/types/agent'
import type { UIMessage } from '@shared/types/chat-ui'
import type { Conversation } from '@shared/types/conversation'
import { chooseBy } from '@shared/utils/decision'

// ─── MessagePart → UIMessage Parts Conversion ────────────────

const MAX_ATTACHMENT_PREVIEW_CHARS = 320

/** Prefix used to identify attachment text parts in UIMessage rendering. */
export const ATTACHMENT_TEXT_PREFIX = '[Attachment] '

export function formatAttachmentPreview(
  attachment: Pick<AttachmentRecord, 'name' | 'extractedText' | 'origin'>,
): string {
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

/**
 * Convert a single persisted MessagePart to UIMessage parts.
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
    .case('reasoning', (value): UIMessage['parts'] => [
      {
        type: 'thinking',
        content: value.text,
      },
    ])
    .assertComplete()
}

// ─── Conversation → UIMessage Conversion ─────────────────────

export function conversationToUIMessages(conv: Conversation): UIMessage[] {
  return conv.messages.map((msg) => ({
    id: String(msg.id),
    role: msg.role,
    parts: msg.parts.flatMap(messagePartToUIParts),
    createdAt: new Date(msg.createdAt),
    ...(msg.metadata?.compactionSummary
      ? { metadata: { compactionSummary: msg.metadata.compactionSummary } }
      : {}),
  }))
}

// ─── Background Run Reconnection Helpers ─────────────────────

export function buildPartialAssistantMessage(parts: readonly MessagePart[]): UIMessage | null {
  const uiParts: UIMessage['parts'] = parts.flatMap(messagePartToUIParts)
  if (uiParts.length === 0) {
    return null
  }

  return {
    id: `bg-stream-${Date.now()}`,
    role: 'assistant',
    parts: uiParts,
    createdAt: new Date(),
  }
}

// ─── Snapshot ↔ Optimistic User Message Reconciliation ───────

/**
 * Extract the concatenated text content from a UIMessage's text parts.
 */
export function getUIMessageText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.content)
    .join('\n\n')
}

/**
 * When the persisted conversation snapshot is loaded after a stream completes,
 * user messages may appear duplicated: the local optimistic user message and
 * the persisted copy have different IDs but identical content.
 *
 * This function reconciles by replacing each persisted user message with an
 * existing in-memory user message that has the same text, preserving the
 * optimistic ID so React keeps the row stable across the snapshot refresh.
 *
 * Matching is done by normalized text content (role=user + same text).
 * Each existing message is consumed at most once (queue per text key) to
 * handle the edge case of multiple identical user messages.
 */
export function appendMissingOptimisticUserMessages(
  snapshotMessages: UIMessage[],
  optimisticUserMessages: readonly UIMessage[],
): UIMessage[] {
  if (optimisticUserMessages.length === 0) {
    return snapshotMessages
  }

  const snapshotUserCountsByText = new Map<string, number>()
  for (const message of snapshotMessages) {
    if (message.role !== 'user') {
      continue
    }
    const text = getUIMessageText(message)
    if (!text) {
      continue
    }
    snapshotUserCountsByText.set(text, (snapshotUserCountsByText.get(text) ?? 0) + 1)
  }

  const missingOptimisticMessages: UIMessage[] = []
  for (const message of optimisticUserMessages) {
    if (message.role !== 'user') {
      continue
    }
    const text = getUIMessageText(message)
    if (!text) {
      continue
    }
    const count = snapshotUserCountsByText.get(text) ?? 0
    if (count > 0) {
      snapshotUserCountsByText.set(text, count - 1)
      continue
    }
    missingOptimisticMessages.push(message)
  }

  return missingOptimisticMessages.length > 0
    ? [...snapshotMessages, ...missingOptimisticMessages]
    : snapshotMessages
}

export function reconcileSnapshotUserMessages(
  snapshotMessages: UIMessage[],
  existingMessages: UIMessage[],
): UIMessage[] {
  // Build a map of existing user messages keyed by their text content.
  // Each key maps to a queue so that if the user sent the same text twice,
  // each persisted copy matches a distinct existing copy.
  const existingUserQueuesByText = new Map<string, UIMessage[]>()
  for (const msg of existingMessages) {
    if (msg.role !== 'user') continue
    const text = getUIMessageText(msg)
    if (!text) continue
    const queue = existingUserQueuesByText.get(text)
    if (queue) {
      queue.push(msg)
    } else {
      existingUserQueuesByText.set(text, [msg])
    }
  }

  if (existingUserQueuesByText.size === 0) return snapshotMessages

  let didReplace = false
  const reconciled = snapshotMessages.map((msg) => {
    if (msg.role !== 'user') return msg
    const text = getUIMessageText(msg)
    if (!text) return msg

    const queue = existingUserQueuesByText.get(text)
    if (!queue || queue.length === 0) return msg

    const replacement = queue.shift()
    if (!replacement) return msg
    didReplace = true
    return replacement
  })

  return didReplace ? reconciled : snapshotMessages
}
