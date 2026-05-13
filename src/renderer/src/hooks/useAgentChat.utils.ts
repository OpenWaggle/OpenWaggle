import { isMatching, match, matchBy } from '@diegogbrisa/ts-match'
import { TOOL_STATE_RANK } from '@shared/constants/tool-state'
import type { AgentSendPayload, AttachmentRecord, MessagePart } from '@shared/types/agent'
import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'

// ─── MessagePart → UIMessage Parts Conversion ────────────────

const MAX_ATTACHMENT_PREVIEW_CHARS = 320
let optimisticUserMessageCounter = 0

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

export function buildClientUserMessage(payload: AgentSendPayload): string {
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

/**
 * Convert a single persisted MessagePart to UIMessage parts.
 * Shared by both sessionToUIMessages (historical) and
 * buildPartialAssistantMessage (background reconnection).
 */
export function messagePartToUIParts(part: MessagePart): UIMessage['parts'] {
  return matchBy(part, 'type')
    .with('text', (value): UIMessage['parts'] => [{ type: 'text', content: value.text }])
    .with('tool-call', (value): UIMessage['parts'] => [
      {
        type: 'tool-call',
        id: String(value.toolCall.id),
        name: value.toolCall.name,
        arguments: JSON.stringify(value.toolCall.args),
        state: value.toolCall.state ?? 'input-complete',
      },
    ])
    .with('tool-result', (value): UIMessage['parts'] => [
      {
        type: 'tool-result',
        toolCallId: String(value.toolResult.id),
        content: value.toolResult.result,
        state: value.toolResult.isError ? 'error' : 'complete',
      },
    ])
    .with('attachment', (value): UIMessage['parts'] => [
      {
        type: 'text',
        content: formatAttachmentPreview(value.attachment),
      },
    ])
    .with('reasoning', (value): UIMessage['parts'] => [
      {
        type: 'thinking',
        content: value.text,
      },
    ])
    .exhaustive()
}

// ─── SessionDetail → UIMessage Conversion ─────────────────────

export function sessionToUIMessages(session: SessionDetail): UIMessage[] {
  return session.messages.map((msg) => ({
    id: String(msg.id),
    role: msg.role,
    parts: msg.parts.flatMap(messagePartToUIParts),
    createdAt: new Date(msg.createdAt),
    ...(msg.metadata?.branchSummary || msg.metadata?.compactionSummary
      ? {
          metadata: {
            ...(msg.metadata.branchSummary ? { branchSummary: msg.metadata.branchSummary } : {}),
            ...(msg.metadata.compactionSummary
              ? { compactionSummary: msg.metadata.compactionSummary }
              : {}),
          },
        }
      : {}),
  }))
}

// ─── Background Run Reconnection Helpers ─────────────────────

export function buildPartialAssistantMessage(
  parts: readonly MessagePart[],
  messageId?: string,
): UIMessage | null {
  const uiParts: UIMessage['parts'] = parts.flatMap(messagePartToUIParts)
  if (uiParts.length === 0) {
    return null
  }

  return {
    id: messageId ?? `bg-stream-${Date.now()}`,
    role: 'assistant',
    parts: uiParts,
    createdAt: new Date(),
  }
}

function isAssistantMessage(
  message: UIMessage,
): message is UIMessage & { readonly role: 'assistant' } {
  return isMatching({ role: 'assistant' }, message)
}

function mergeTextContent(snapshotContent: string, currentContent: string): string {
  return match({ snapshotContent, currentContent })
    .when(
      (value) => value.snapshotContent.includes(value.currentContent),
      (value) => value.snapshotContent,
    )
    .when(
      (value) => value.currentContent.includes(value.snapshotContent),
      (value) => value.currentContent,
    )
    .otherwise((value) => `${value.snapshotContent}${value.currentContent}`)
}

function toolStateRank(state: string): number {
  return match(state)
    .with('complete', 'error', 'output-available', () => TOOL_STATE_RANK.TERMINAL)
    .with('executing', () => TOOL_STATE_RANK.EXECUTING)
    .with('input-complete', () => TOOL_STATE_RANK.INPUT_COMPLETE)
    .with('input-streaming', () => TOOL_STATE_RANK.INPUT_STREAMING)
    .otherwise(() => TOOL_STATE_RANK.UNKNOWN)
}

function findLastTextPartIndex(parts: readonly UIMessagePart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === 'text') {
      return index
    }
  }
  return -1
}

function findLastThinkingPartIndex(parts: readonly UIMessagePart[], stepId?: string): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part?.type !== 'thinking') {
      continue
    }
    if (!stepId || part.stepId === stepId) {
      return index
    }
  }
  return -1
}

function findMergeablePartIndex(parts: readonly UIMessagePart[], part: UIMessagePart): number {
  return matchBy(part, 'type')
    .with('text', () => findLastTextPartIndex(parts))
    .with('thinking', (value) => findLastThinkingPartIndex(parts, value.stepId))
    .with('tool-call', (value) =>
      parts.findIndex((candidate) => candidate.type === 'tool-call' && candidate.id === value.id),
    )
    .with('tool-result', (value) =>
      parts.findIndex(
        (candidate) =>
          candidate.type === 'tool-result' && candidate.toolCallId === value.toolCallId,
      ),
    )
    .with('image', (value) =>
      parts.findIndex(
        (candidate) => candidate.type === 'image' && candidate.source.value === value.source.value,
      ),
    )
    .with('audio', (value) =>
      parts.findIndex(
        (candidate) => candidate.type === 'audio' && candidate.source.value === value.source.value,
      ),
    )
    .with('video', (value) =>
      parts.findIndex(
        (candidate) => candidate.type === 'video' && candidate.source.value === value.source.value,
      ),
    )
    .with('document', (value) =>
      parts.findIndex(
        (candidate) =>
          candidate.type === 'document' && candidate.source.value === value.source.value,
      ),
    )
    .exhaustive()
}

function mergeMessagePart(snapshotPart: UIMessagePart, currentPart: UIMessagePart): UIMessagePart {
  return match({ snapshotPart, currentPart })
    .with(
      { snapshotPart: { type: 'text' }, currentPart: { type: 'text' } },
      (value): UIMessagePart => ({
        type: 'text',
        content: mergeTextContent(value.snapshotPart.content, value.currentPart.content),
      }),
    )
    .with(
      { snapshotPart: { type: 'thinking' }, currentPart: { type: 'thinking' } },
      (value): UIMessagePart => {
        const stepId = value.currentPart.stepId ?? value.snapshotPart.stepId
        return {
          type: 'thinking',
          content: mergeTextContent(value.snapshotPart.content, value.currentPart.content),
          ...(stepId ? { stepId } : {}),
        }
      },
    )
    .with(
      { snapshotPart: { type: 'tool-call' }, currentPart: { type: 'tool-call' } },
      (value): UIMessagePart =>
        toolStateRank(value.currentPart.state) >= toolStateRank(value.snapshotPart.state)
          ? value.currentPart
          : value.snapshotPart,
    )
    .otherwise((value) => value.currentPart)
}

function mergeAssistantParts(
  snapshotParts: readonly UIMessagePart[],
  currentParts: readonly UIMessagePart[],
): UIMessagePart[] {
  const mergedParts = [...snapshotParts]
  for (const currentPart of currentParts) {
    const partIndex = findMergeablePartIndex(mergedParts, currentPart)
    const existingPart = partIndex >= 0 ? mergedParts[partIndex] : undefined
    if (!existingPart) {
      mergedParts.push(currentPart)
      continue
    }
    mergedParts[partIndex] = mergeMessagePart(existingPart, currentPart)
  }
  return mergedParts
}

export function mergeBackgroundReconnectMessages(
  reconnectMessages: UIMessage[],
  currentMessages: UIMessage[],
): UIMessage[] {
  const currentMessagesById = new Map(currentMessages.map((message) => [message.id, message]))
  const reconnectMessageIds = new Set(reconnectMessages.map((message) => message.id))
  const reconnectUserCountsByText = countUserMessagesByText(reconnectMessages)
  const mergedMessages = reconnectMessages.map((message) => {
    const currentMessage = currentMessagesById.get(message.id)
    return match(currentMessage)
      .with(undefined, () => message)
      .when(isAssistantMessage, (currentAssistantMessage) =>
        match(message)
          .when(
            isAssistantMessage,
            (assistantMessage): UIMessage => ({
              ...assistantMessage,
              parts: mergeAssistantParts(assistantMessage.parts, currentAssistantMessage.parts),
              createdAt: currentAssistantMessage.createdAt ?? assistantMessage.createdAt,
              metadata: currentAssistantMessage.metadata ?? assistantMessage.metadata,
            }),
          )
          .otherwise(() => currentAssistantMessage),
      )
      .otherwise((value) => value)
  })

  for (const currentMessage of currentMessages) {
    if (!reconnectMessageIds.has(currentMessage.id)) {
      const currentUserText = getNonEmptyUserMessageText(currentMessage)
      if (
        currentUserText &&
        consumeUserMessageTextCount(reconnectUserCountsByText, currentUserText)
      ) {
        continue
      }
      mergedMessages.push(currentMessage)
    }
  }

  return mergedMessages
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

function getNonEmptyUserMessageText(message: UIMessage): string | null {
  if (message.role !== 'user') {
    return null
  }

  const text = getUIMessageText(message)
  return text || null
}

function countUserMessagesByText(messages: readonly UIMessage[]): Map<string, number> {
  const countsByText = new Map<string, number>()
  for (const message of messages) {
    const text = getNonEmptyUserMessageText(message)
    if (!text) {
      continue
    }
    countsByText.set(text, (countsByText.get(text) ?? 0) + 1)
  }
  return countsByText
}

function consumeUserMessageTextCount(countsByText: Map<string, number>, text: string): boolean {
  const count = countsByText.get(text) ?? 0
  if (count === 0) {
    return false
  }
  countsByText.set(text, count - 1)
  return true
}

function findMissingOptimisticUserMessages(
  snapshotUserCountsByText: Map<string, number>,
  optimisticUserMessages: readonly UIMessage[],
): UIMessage[] {
  const missingMessages: UIMessage[] = []
  for (const message of optimisticUserMessages) {
    const text = getNonEmptyUserMessageText(message)
    if (!text || consumeUserMessageTextCount(snapshotUserCountsByText, text)) {
      continue
    }
    missingMessages.push(message)
  }
  return missingMessages
}

/**
 * When the persisted session snapshot is loaded after a stream completes,
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

  const missingOptimisticMessages = findMissingOptimisticUserMessages(
    countUserMessagesByText(snapshotMessages),
    optimisticUserMessages,
  )

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
