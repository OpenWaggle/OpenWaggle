import type { UIMessage } from '@shared/types/chat-ui'

/*
 * Where a background reconnect places the messages only one side holds. The reconnect holds the
 * persisted transcript and the Run's stream buffer (its incorporated user messages and the answer
 * streaming now); the current transcript holds what this renderer received of the Run.
 */

/**
 * Places the messages only the current transcript holds. Each keeps its place after the shared
 * message it followed there (one before every shared message, after the transcript's start), and
 * after the earlier messages only the reconnect holds that follow that place
 * (`earlierMessageIds`): the current transcript's own messages are the active Run's, which started
 * after every persisted message, and its answers follow the user messages it incorporated before
 * its first answer. So a Run persisted while it was not watched, or a prompt missed in a stall,
 * stays above them. Appending them put a Run's earlier answers, streamed while its Session was
 * not shown, below the answer the reconnect buffer still holds. One pass over each list: a
 * transcript can hold thousands of messages and this runs on every open.
 */
export function placeCurrentOnlyMessages(input: {
  readonly mergedMessages: UIMessage[]
  readonly currentMessages: readonly UIMessage[]
  readonly reconnectMessageIds: ReadonlySet<string>
  readonly currentMessageIds: ReadonlySet<string>
  /** Messages only the reconnect holds that precede the current transcript's own; unknown if undefined. */
  readonly earlierMessageIds: ReadonlySet<string> | undefined
  readonly isRepresented: (message: UIMessage) => boolean
}): UIMessage[] {
  const { mergedMessages, currentMessages, reconnectMessageIds } = input
  const leading: UIMessage[] = []
  const followersByAnchorId = new Map<string, UIMessage[]>()
  let anchorId: string | null = null
  for (const currentMessage of currentMessages) {
    if (reconnectMessageIds.has(currentMessage.id)) {
      anchorId = currentMessage.id
      continue
    }
    if (input.isRepresented(currentMessage)) continue
    if (anchorId === null) {
      leading.push(currentMessage)
      continue
    }
    const followers = followersByAnchorId.get(anchorId)
    if (followers) followers.push(currentMessage)
    else followersByAnchorId.set(anchorId, [currentMessage])
  }
  if (leading.length === 0 && followersByAnchorId.size === 0) return mergedMessages

  const { earlierMessageIds, currentMessageIds } = input
  // Unknown earlier messages: followers stay right after their anchor, as do leading ones before
  // the first shared message, or after everything when nothing is shared.
  const isEarlierOnly = (message: UIMessage) =>
    !currentMessageIds.has(message.id) && earlierMessageIds?.has(message.id) === true
  const leadingWaitsBehind = (message: UIMessage) =>
    !currentMessageIds.has(message.id) &&
    (earlierMessageIds === undefined || earlierMessageIds.has(message.id))
  const placed: UIMessage[] = []
  let waitingLeading = leading
  let waiting: UIMessage[] = []
  for (const message of mergedMessages) {
    if (waitingLeading.length > 0 && !leadingWaitsBehind(message)) {
      placed.push(...waitingLeading)
      waitingLeading = []
    }
    if (waiting.length > 0 && !isEarlierOnly(message)) {
      placed.push(...waiting)
      waiting = []
    }
    placed.push(message)
    const followers = followersByAnchorId.get(message.id)
    if (followers) {
      waiting.push(...followers)
      followersByAnchorId.delete(message.id)
    }
  }
  placed.push(...waitingLeading, ...waiting)
  return placed
}

function userLogOrder(message: UIMessage) {
  return message.role === 'user' ? message.metadata?.sessionNodeCreatedOrder : undefined
}

/** Waiting rows to place before `message`: all of them, unless it is a user row the log has first. */
function waitersBefore(waiting: readonly UIMessage[], message: UIMessage) {
  const order = userLogOrder(message)
  if (order === undefined) return [...waiting]
  return waiting.filter((waiter) => (userLogOrder(waiter) ?? Number.POSITIVE_INFINITY) < order)
}

/**
 * Moves each user message only the reconnect holds after what it followed in the log
 * (the answer the Run was streaming then), when the transcript shows it, and after the user messages the log
 * has between them (an earlier steer after the same answer). The reconnect places such a message
 * right after the persisted history, which lacks the Run's earlier answers; the current transcript
 * has them but missed the message itself (events lost while the Host event stream stalled), so
 * placing it after the shared row before it put a steer below the answers Pi wrote after it.
 * Messages the current transcript holds keep its order.
 */
export function placeAnchoredReconnectMessages(
  messages: readonly UIMessage[],
  anchors: ReadonlyMap<string, string>,
  currentMessageIds: ReadonlySet<string>,
): UIMessage[] {
  if (anchors.size === 0) return [...messages]
  const shownIds = new Set(messages.map((message) => message.id))
  const anchorIds = new Map([...anchors].filter(([, anchorId]) => shownIds.has(anchorId)))
  const unanchoredIds = new Set(
    [...anchors.keys()].filter((messageId) => !anchorIds.has(messageId)),
  )
  const anchored = placeAnchoredMessages(messages, anchorIds, currentMessageIds)
  return placeUnanchoredReconnectMessages(anchored, unanchoredIds, currentMessageIds)
}

function placeAnchoredMessages(
  messages: readonly UIMessage[],
  anchorIds: ReadonlyMap<string, string>,
  currentMessageIds: ReadonlySet<string>,
) {
  const followersByAnchorId = new Map<string, UIMessage[]>()
  const moved = new Set<UIMessage>()
  for (const message of messages) {
    const anchorId = anchorIds.get(message.id)
    if (anchorId === undefined || message.role !== 'user' || currentMessageIds.has(message.id)) {
      continue
    }
    moved.add(message)
    const followers = followersByAnchorId.get(anchorId)
    if (followers) followers.push(message)
    else followersByAnchorId.set(anchorId, [message])
  }
  if (moved.size === 0) return [...messages]
  const placed: UIMessage[] = []
  let waiting: UIMessage[] = []
  const place = (message: UIMessage) => {
    placed.push(message)
    // A moved message can be another one's anchor.
    waiting.push(...(followersByAnchorId.get(message.id) ?? []))
  }
  for (const message of messages) {
    if (moved.has(message)) continue
    while (waiting.length > 0) {
      const before = waitersBefore(waiting, message)
      if (before.length === 0) break
      waiting = waiting.filter((waiter) => !before.includes(waiter))
      for (const waiter of before) place(waiter)
    }
    place(message)
  }
  while (waiting.length > 0) {
    const next = waiting
    waiting = []
    for (const waiter of next) place(waiter)
  }
  return placed
}

function createdAtMs(message: UIMessage) {
  const time = message.createdAt instanceof Date ? message.createdAt.getTime() : Number.NaN
  return Number.isFinite(time) ? time : null
}

/**
 * Moves each user message only the reconnect holds whose anchor the transcript does not show (the
 * answer it followed was lost in the same stall) above the first answer only the transcript holds
 * that the renderer received after the Run incorporated the message. The renderer receives an
 * answer after the Host started it, on the same machine's clock, so such an answer came later.
 */
function placeUnanchoredReconnectMessages(
  messages: readonly UIMessage[],
  unanchoredIds: ReadonlySet<string>,
  currentMessageIds: ReadonlySet<string>,
): UIMessage[] {
  const placed = [...messages]
  for (const messageId of unanchoredIds) {
    const index = placed.findIndex((message) => message.id === messageId)
    const message = placed[index]
    const incorporatedAt = message ? createdAtMs(message) : null
    if (!message || incorporatedAt === null || currentMessageIds.has(messageId)) continue
    const target = placed.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex < index &&
        candidate.role === 'assistant' &&
        currentMessageIds.has(candidate.id) &&
        (createdAtMs(candidate) ?? Number.NEGATIVE_INFINITY) > incorporatedAt,
    )
    if (target < 0) continue
    placed.splice(index, 1)
    placed.splice(target, 0, message)
  }
  return placed
}
