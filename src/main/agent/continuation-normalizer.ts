import type { ModelMessage, UIMessage } from '@tanstack/ai'

type ContinuationMessage = ModelMessage | UIMessage

function isUiSnapshotMessage(message: ContinuationMessage): message is UIMessage {
  return 'parts' in message
}

function hasModelMessageContent(message: ModelMessage): boolean {
  if (message.content === null) {
    return false
  }
  if (typeof message.content === 'string') {
    return message.content.length > 0
  }
  return message.content.length > 0
}

function extractUiTextContent(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.content)
    .join('')
}

function toModelSnapshotMessage(
  message: UIMessage,
  role: 'user' | 'assistant',
): ModelMessage & {
  readonly parts: UIMessage['parts']
  readonly id: string
  readonly createdAt?: Date
} {
  const content = extractUiTextContent(message)
  return {
    role,
    content: content.length > 0 ? content : null,
    parts: message.parts,
    id: message.id,
    createdAt: message.createdAt,
  }
}

export function normalizeContinuationInput(
  continuationMessages: readonly ContinuationMessage[],
): ModelMessage[] {
  const normalizedReversed: ModelMessage[] = []
  const seenToolCallIds = new Set<string>()
  const seenToolResultIds = new Set<string>()

  for (let messageIndex = continuationMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = continuationMessages[messageIndex]
    if (!message) {
      continue
    }

    if (isUiSnapshotMessage(message)) {
      if (message.role === 'system') {
        continue
      }

      if (message.role === 'user') {
        normalizedReversed.push(toModelSnapshotMessage(message, 'user'))
        continue
      }

      if (message.role !== 'assistant') {
        continue
      }

      const dedupedPartsReversed: Array<UIMessage['parts'][number]> = []
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = message.parts[partIndex]
        if (!part) {
          continue
        }
        if (part.type === 'tool-call') {
          if (seenToolCallIds.has(part.id)) {
            continue
          }
          seenToolCallIds.add(part.id)
          dedupedPartsReversed.push(part)
          continue
        }
        if (part.type === 'tool-result') {
          if (seenToolResultIds.has(part.toolCallId)) {
            continue
          }
          seenToolResultIds.add(part.toolCallId)
          dedupedPartsReversed.push(part)
          continue
        }
        dedupedPartsReversed.push(part)
      }

      if (dedupedPartsReversed.length === 0) {
        continue
      }

      normalizedReversed.push(
        toModelSnapshotMessage(
          {
            ...message,
            role: 'assistant',
            parts: dedupedPartsReversed.reverse(),
          },
          'assistant',
        ),
      )
      continue
    }

    if (message.role === 'tool' && message.toolCallId) {
      if (seenToolResultIds.has(message.toolCallId)) {
        continue
      }
      seenToolResultIds.add(message.toolCallId)
      normalizedReversed.push(message)
      continue
    }

    if (message.role !== 'assistant' || !message.toolCalls || message.toolCalls.length === 0) {
      normalizedReversed.push(message)
      continue
    }

    const dedupedToolCallsReversed: Array<NonNullable<ModelMessage['toolCalls']>[number]> = []
    for (let toolCallIndex = message.toolCalls.length - 1; toolCallIndex >= 0; toolCallIndex -= 1) {
      const toolCall = message.toolCalls[toolCallIndex]
      if (!toolCall) {
        continue
      }
      if (seenToolCallIds.has(toolCall.id)) {
        continue
      }
      seenToolCallIds.add(toolCall.id)
      dedupedToolCallsReversed.push(toolCall)
    }

    const dedupedToolCalls = dedupedToolCallsReversed.reverse()

    if (dedupedToolCalls.length === 0 && !hasModelMessageContent(message)) {
      continue
    }

    if (dedupedToolCalls.length === message.toolCalls.length) {
      normalizedReversed.push(message)
      continue
    }

    if (dedupedToolCalls.length > 0) {
      normalizedReversed.push({ ...message, toolCalls: dedupedToolCalls })
      continue
    }

    const { toolCalls: _toolCalls, ...messageWithoutToolCalls } = message
    normalizedReversed.push(messageWithoutToolCalls)
  }

  return normalizedReversed.reverse()
}
