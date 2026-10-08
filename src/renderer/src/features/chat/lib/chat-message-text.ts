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

function createdAtMs(message: UIMessage) {
  const time = message.createdAt instanceof Date ? message.createdAt.getTime() : Number.NaN
  return Number.isFinite(time) ? time : null
}

/**
 * The sent messages (optimistic rows) a saved transcript holds: each matched, in order, with a
 * saved user message of its text created at or after it was sent, each saved message once. The
 * Host saves a send after the renderer sent it, so an older one with the same text ("continue",
 * above a compaction marker) is an earlier send, not this one. A message without a time matches
 * any.
 */
export function savedSendIds(saved: readonly UIMessage[], sent: readonly UIMessage[]) {
  const savedByText = new Map<string, Array<number | null>>()
  for (const message of saved) {
    const text = getNonEmptyUserMessageText(message)
    if (text) savedByText.set(text, [...(savedByText.get(text) ?? []), createdAtMs(message)])
  }
  const matched = new Set<UIMessage['id']>()
  for (const message of sent) {
    const text = getNonEmptyUserMessageText(message)
    const times = text ? savedByText.get(text) : undefined
    if (!times) continue
    const sentAt = createdAtMs(message)
    const index = times.findIndex((time) => sentAt === null || time === null || time >= sentAt)
    if (index < 0) continue
    times.splice(index, 1)
    matched.add(message.id)
  }
  return matched
}
