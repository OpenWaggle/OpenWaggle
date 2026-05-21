import type { UIMessage } from '@shared/types/chat-ui'

/** Extract the concatenated text content from a UIMessage's text parts. */
export function getUIMessageText(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.content)
    .join('\n\n')
}

export function getNonEmptyUserMessageText(message: UIMessage) {
  if (message.role !== 'user') {
    return null
  }

  const text = getUIMessageText(message)
  return text || null
}

export function countUserMessagesByText(messages: readonly UIMessage[]) {
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

export function consumeUserMessageTextCount(countsByText: Map<string, number>, text: string) {
  const count = countsByText.get(text) ?? 0
  if (count === 0) {
    return false
  }
  countsByText.set(text, count - 1)
  return true
}
