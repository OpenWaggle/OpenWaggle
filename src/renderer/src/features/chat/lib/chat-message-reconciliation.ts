import type { UIMessage } from '@shared/types/chat-ui'
import {
  consumeUserMessageTextCount,
  countUserMessagesByText,
  getNonEmptyUserMessageText,
  getUIMessageText,
} from './chat-message-text'

function findMissingOptimisticUserMessages(
  snapshotUserCountsByText: Map<string, number>,
  optimisticUserMessages: readonly UIMessage[],
) {
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
 * Keeps optimistic user rows visible until the persisted session snapshot catches up.
 * Matching is text-based because optimistic and persisted IDs are intentionally different.
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

function buildExistingUserQueuesByText(existingMessages: readonly UIMessage[]) {
  const existingUserQueuesByText = new Map<string, UIMessage[]>()
  for (const message of existingMessages) {
    if (message.role !== 'user') {
      continue
    }
    const text = getUIMessageText(message)
    if (!text) {
      continue
    }
    const queue = existingUserQueuesByText.get(text)
    if (queue) {
      queue.push(message)
    } else {
      existingUserQueuesByText.set(text, [message])
    }
  }
  return existingUserQueuesByText
}

/**
 * Replaces persisted user rows with matching in-memory optimistic rows so React row
 * identity remains stable across the post-run snapshot refresh.
 */
export function reconcileSnapshotUserMessages(
  snapshotMessages: UIMessage[],
  existingMessages: UIMessage[],
): UIMessage[] {
  const existingUserQueuesByText = buildExistingUserQueuesByText(existingMessages)
  if (existingUserQueuesByText.size === 0) {
    return snapshotMessages
  }

  let didReplace = false
  const reconciled = snapshotMessages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    const text = getUIMessageText(message)
    if (!text) {
      return message
    }

    const replacement = existingUserQueuesByText.get(text)?.shift()
    if (!replacement) {
      return message
    }
    didReplace = true
    return replacement
  })

  return didReplace ? reconciled : snapshotMessages
}

function messagesRepresentSameTurn(snapshotMessage: UIMessage, existingMessage: UIMessage) {
  if (snapshotMessage.id === existingMessage.id) {
    return true
  }
  if (snapshotMessage.role !== 'user' || existingMessage.role !== 'user') {
    return false
  }

  const snapshotText = getUIMessageText(snapshotMessage)
  return snapshotText.length > 0 && snapshotText === getUIMessageText(existingMessage)
}

function findAlignedSnapshotEndIndex(
  snapshotMessages: readonly UIMessage[],
  existingMessages: readonly UIMessage[],
) {
  let existingIndex = -1
  for (const snapshotMessage of snapshotMessages) {
    const nextIndex = existingMessages.findIndex(
      (existingMessage, index) =>
        index > existingIndex && messagesRepresentSameTurn(snapshotMessage, existingMessage),
    )
    if (nextIndex < 0) {
      return null
    }
    existingIndex = nextIndex
  }
  return existingIndex
}

export function appendUnpersistedAssistantTail(
  snapshotMessages: UIMessage[],
  existingMessages: readonly UIMessage[],
): UIMessage[] {
  if (snapshotMessages.length === 0 || existingMessages.length <= snapshotMessages.length) {
    return snapshotMessages
  }

  const alignedEndIndex = findAlignedSnapshotEndIndex(snapshotMessages, existingMessages)
  if (alignedEndIndex === null || alignedEndIndex >= existingMessages.length - 1) {
    return snapshotMessages
  }

  const snapshotMessageIds = new Set(snapshotMessages.map((message) => message.id))
  const tail = existingMessages
    .slice(alignedEndIndex + 1)
    .filter((message) => message.role === 'assistant' && !snapshotMessageIds.has(message.id))

  return tail.length > 0 ? [...snapshotMessages, ...tail] : snapshotMessages
}
