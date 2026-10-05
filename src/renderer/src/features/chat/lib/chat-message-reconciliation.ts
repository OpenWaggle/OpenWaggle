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

function messageCreatedAtMs(message: UIMessage) {
  if (!(message.createdAt instanceof Date)) return null
  const timestamp = message.createdAt.getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function mergeMissingOptimisticMessagesByTime(
  snapshotMessages: UIMessage[],
  missingOptimisticMessages: readonly UIMessage[],
) {
  const mergedMessages = [...snapshotMessages]
  for (const message of missingOptimisticMessages) {
    const createdAt = messageCreatedAtMs(message)
    const insertionIndex =
      createdAt === null
        ? -1
        : mergedMessages.findIndex((candidate) => {
            const candidateCreatedAt = messageCreatedAtMs(candidate)
            return candidateCreatedAt !== null && candidateCreatedAt > createdAt
          })
    if (insertionIndex < 0) mergedMessages.push(message)
    else mergedMessages.splice(insertionIndex, 0, message)
  }
  return mergedMessages
}

/**
 * Keeps optimistic user rows visible until the persisted session snapshot catches up.
 * Matching is text-based because optimistic and persisted IDs are intentionally different.
 * Missing rows use their client timestamp so a newer replacement snapshot cannot move an
 * older optimistic turn below the assistant reply that followed it.
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
    ? mergeMissingOptimisticMessagesByTime(snapshotMessages, missingOptimisticMessages)
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

interface SnapshotLogIdentity {
  readonly sessionNodeId?: string
  readonly sessionNodeCreatedOrder?: number
  readonly durableTextSha256?: string
  readonly liveIncorporated?: true
}

function snapshotLogIdentity(current: UIMessage, snapshot: UIMessage): SnapshotLogIdentity {
  const snapshotIsLive = snapshot.metadata?.liveIncorporated === true
  const sessionNodeId =
    snapshot.metadata?.sessionNodeId ??
    (snapshotIsLive ? current.metadata?.sessionNodeId : snapshot.id)
  const { sessionNodeCreatedOrder, durableTextSha256 } = snapshot.metadata ?? {}
  return {
    ...(sessionNodeId === undefined ? {} : { sessionNodeId }),
    ...(sessionNodeCreatedOrder === undefined ? {} : { sessionNodeCreatedOrder }),
    ...(durableTextSha256 === undefined ? {} : { durableTextSha256 }),
    // Still only live: no persisted node is known yet, so the row's id must not become one later.
    ...(snapshotIsLive && sessionNodeId === undefined ? { liveIncorporated: true } : {}),
  }
}

function hasLogIdentity(message: UIMessage, identity: SnapshotLogIdentity) {
  const metadata = message.metadata
  return (
    metadata?.sessionNodeCreatedOrder === identity.sessionNodeCreatedOrder &&
    metadata?.sessionNodeId === identity.sessionNodeId &&
    metadata?.durableTextSha256 === identity.durableTextSha256 &&
    metadata?.liveIncorporated === identity.liveIncorporated
  )
}

/**
 * Gives a row the log identity of the snapshot row it stands for. A persisted snapshot row names
 * its Session node by id; a live incorporated row has only a stream id, so it contributes its log
 * order and digest but never a node id.
 */
export function retainSnapshotMessageOrder(current: UIMessage, snapshot: UIMessage): UIMessage {
  const identity = snapshotLogIdentity(current, snapshot)
  if (hasLogIdentity(current, identity)) return current
  const { liveIncorporated: _live, sessionNodeId: _nodeId, ...metadata } = current.metadata ?? {}
  return { ...current, metadata: { ...metadata, ...identity } }
}

/**
 * The row of `candidates` (same text, in transcript order) that may stand for `message`. Two rows
 * the Session log places at different orders are different prompts, however alike their text: a
 * repeated "continue" must not take the identity of the first one. A row at the same order wins
 * over one the Host has not recorded yet (an optimistic send).
 */
function matchingUserMessageIndex(candidates: readonly UIMessage[], message: UIMessage) {
  const order = message.metadata?.sessionNodeCreatedOrder
  if (order === undefined) return candidates.length > 0 ? 0 : -1
  const sameOrderIndex = candidates.findIndex(
    (candidate) => candidate.metadata?.sessionNodeCreatedOrder === order,
  )
  if (sameOrderIndex >= 0) return sameOrderIndex
  return candidates.findIndex(
    (candidate) => candidate.metadata?.sessionNodeCreatedOrder === undefined,
  )
}

function takeMatchingUserMessage(candidates: UIMessage[], message: UIMessage) {
  const index = matchingUserMessageIndex(candidates, message)
  return index < 0 ? undefined : candidates.splice(index, 1)[0]
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

    const candidates = existingUserQueuesByText.get(text)
    const replacement = candidates ? takeMatchingUserMessage(candidates, message) : undefined
    if (!replacement) {
      return message
    }
    didReplace = true
    // Preserve the React row identity, but retain the authoritative source boundary for steering.
    return retainSnapshotMessageOrder(replacement, message)
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
