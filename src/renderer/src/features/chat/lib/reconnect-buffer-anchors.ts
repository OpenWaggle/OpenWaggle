import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { UIMessage } from '@shared/types/chat-ui'
import { buildPartialAssistantMessage } from './chat-message-conversion'

/*
 * Where a reconnect's rows go among the rows only the current transcript shows: by the answer each
 * user message the buffer's Run incorporated followed, and by which rows come first.
 */

function leadingUserMessageIdsOf(snapshot: BackgroundRunSnapshot) {
  return (snapshot.userMessages ?? []).flatMap((userMessage) =>
    userMessage.afterAssistantMessageId === undefined ? [userMessage.messageId] : [],
  )
}

/**
 * The answer each user message the Run incorporated followed: the one the buffer was streaming.
 * A message incorporated before the Run's first answer has none; it is a leading one.
 */
export function userMessageAnchorsOf(snapshot: BackgroundRunSnapshot) {
  const anchors = new Map<string, string>()
  for (const userMessage of snapshot.userMessages ?? []) {
    if (userMessage.afterAssistantMessageId !== undefined) {
      anchors.set(userMessage.messageId, userMessage.afterAssistantMessageId)
    }
  }
  return anchors
}

/**
 * The reconnect's rows that precede every row only the current transcript shows: the persisted
 * transcript's, and the user messages the buffer's Run incorporated before its first answer. Those
 * do not precede a row of an earlier Run the reconnect does not hold (`settledMessageIds`): a Run
 * whose settlement and the next Run's start a disconnect hid, the chat still showing it live.
 * `currentMessages` leaves out the rows the persisted transcript saved: it holds those.
 */
export function earlierReconnectMessageIds(
  reconnect: {
    readonly messages: readonly UIMessage[]
    readonly persistedMessages: readonly UIMessage[] | null
    readonly snapshot: BackgroundRunSnapshot | null
  },
  currentMessages: readonly UIMessage[],
  settledMessageIds: ReadonlySet<string> | undefined,
) {
  const reconnectIds = new Set(reconnect.messages.map((message) => message.id))
  const showsEarlierRun = currentMessages.some(
    (message) => settledMessageIds?.has(message.id) === true && !reconnectIds.has(message.id),
  )
  return new Set([
    ...(reconnect.persistedMessages ?? []).map((message) => message.id),
    ...(reconnect.snapshot && !showsEarlierRun ? leadingUserMessageIdsOf(reconnect.snapshot) : []),
  ])
}

/**
 * The answer the buffer streams, dated by Host time like the answers the stream started: when it
 * started or, from an older Host, no earlier than the Run's start and the user messages it
 * incorporated before the answer. The renderer's own clock, when the reconnect lands, would date it
 * after steers Pi took later.
 */
export function partialAssistantOf(snapshot: BackgroundRunSnapshot) {
  const partial = buildPartialAssistantMessage(snapshot.parts, snapshot.messageId)
  if (!partial) return null
  const before = (snapshot.userMessages ?? []).flatMap((userMessage) =>
    userMessage.afterAssistantMessageId === snapshot.messageId ? [] : [userMessage.timestamp],
  )
  const startedAt = snapshot.messageStartedAt ?? Math.max(snapshot.startedAt, ...before)
  return { ...partial, createdAt: new Date(startedAt) }
}

/** The answers the buffer's Run finished before the one it streams, dated by when they started. */
export function earlierAnswersOf(snapshot: BackgroundRunSnapshot): UIMessage[] {
  return (snapshot.assistantMessages ?? []).flatMap((answer) => {
    const message = buildPartialAssistantMessage(answer.parts, answer.messageId)
    return message ? [{ ...message, createdAt: new Date(answer.timestamp) }] : []
  })
}
