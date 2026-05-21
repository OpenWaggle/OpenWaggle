import type { UIMessage } from '@shared/types/chat-ui'

type MessagePart = UIMessage['parts'][number]

export function isRenderableTextPart(
  part: MessagePart,
): part is Extract<MessagePart, { type: 'text' }> {
  return part.type === 'text' && part.content.trim().length > 0
}

export function getLastRenderableTextPartIndex(parts: UIMessage['parts']): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isRenderableTextPart(parts[index])) {
      return index
    }
  }
  return -1
}

export function countToolCallParts(parts: UIMessage['parts']): number {
  let toolCallCount = 0
  for (const part of parts) {
    if (part.type === 'tool-call') {
      toolCallCount += 1
    }
  }
  return toolCallCount
}

export function hasRenderableTextPartBeforeIndex(
  parts: UIMessage['parts'],
  index: number,
): boolean {
  if (index <= 0) {
    return false
  }
  for (let currentIndex = 0; currentIndex < index; currentIndex += 1) {
    if (isRenderableTextPart(parts[currentIndex])) {
      return true
    }
  }
  return false
}
