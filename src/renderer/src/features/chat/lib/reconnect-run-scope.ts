import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { UIMessage } from '@shared/types/chat-ui'
import { withoutSavedRunAnswers } from './seeded-run-messages'

/*
 * The Session log span of the Run a reconnect follows. Answers are deduplicated by content only
 * within it: an earlier Run may have answered with the same text.
 */

/** The log order of the first user message the buffer's Run incorporated: where the Run starts. */
export function runStartOrderOf(snapshot: BackgroundRunSnapshot) {
  const orders = (snapshot.userMessages ?? []).map(
    (userMessage) => userMessage.sessionNodeCreatedOrder,
  )
  return orders.length > 0 ? Math.min(...orders) : undefined
}

/**
 * Where the reconnected Run starts: its buffer's first user message or, without a buffer, the
 * first user row the transcript shows under a stream id of a Run not settled. With neither, no
 * answer is in scope.
 */
export function reconnectedRunStartOrder(input: {
  readonly snapshot: BackgroundRunSnapshot | null
  readonly persistedMessages: readonly UIMessage[] | null
  readonly currentMessages: readonly UIMessage[]
  readonly settledMessageIds: ReadonlySet<string> | undefined
}) {
  const fromBuffer = input.snapshot ? runStartOrderOf(input.snapshot) : undefined
  if (fromBuffer !== undefined) return fromBuffer
  const persistedIds = new Set(input.persistedMessages?.map((message) => message.id))
  const firstUnsettled = input.currentMessages.find(
    (message) =>
      message.role === 'user' &&
      !input.settledMessageIds?.has(message.id) &&
      !persistedIds.has(message.id) &&
      message.metadata?.sessionNodeCreatedOrder !== undefined,
  )
  return firstUnsettled?.metadata?.sessionNodeCreatedOrder ?? Number.POSITIVE_INFINITY
}

/**
 * The reconnect's rows without the answer it streams when the transcript already shows that answer
 * saved under its Pi id: hydration may have loaded the saved Run while this reconnect was in flight.
 */
export function withoutShownRunAnswers(
  messages: readonly UIMessage[],
  snapshot: BackgroundRunSnapshot,
  currentMessages: readonly UIMessage[],
) {
  return withoutSavedRunAnswers(messages, currentMessages, {
    shownIds: new Set(messages.map((message) => message.id)),
    fromOrder: runStartOrderOf(snapshot) ?? Number.POSITIVE_INFINITY,
  })
}
