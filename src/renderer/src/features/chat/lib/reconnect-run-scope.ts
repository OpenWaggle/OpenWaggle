import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { UIMessage } from '@shared/types/chat-ui'
import { type SavedAnswerScope, withoutSavedRunAnswers } from './saved-run-answers'

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
 * The span of the buffer's Run: from its first user message or, when the buffer retains none (an
 * older Host, a message over its size cap), from its start by Host time.
 */
export function runScopeOf(snapshot: BackgroundRunSnapshot): SavedAnswerScope {
  const fromOrder = runStartOrderOf(snapshot)
  return fromOrder === undefined ? { fromTime: snapshot.startedAt } : { fromOrder }
}

/**
 * The span of the reconnected Run: from the buffer read before the detail when its Run settled
 * before the second read (the transcript may never have shown its start: it started in a stall;
 * the next Run's buffer, if any, starts later); its buffer's (`runScopeOf`); or, without any
 * buffer, from the first user row the transcript shows under
 * a stream or optimistic id. A prompt keeps such an id once reconciled with its saved copy, so a
 * row at a saved log order is an earlier Run's when that Run's answers follow it under Pi entry
 * ids, before the next such row; the reconnected Run's own saved prompt is followed by its answers
 * under stream ids. Whether a row is settled does not tell: a route-owned snapshot judges every row
 * it holds at a Run's start as settled, the starting Run's own prompt among them. With no row
 * left, no answer is in scope. With a buffer, an earlier Run the transcript still shows live (a
 * stall hid its end) is in scope too: the span starts at the earlier of the two.
 */
export function reconnectedRunScope(input: {
  readonly snapshot: BackgroundRunSnapshot | null
  readonly settledBuffer?: BackgroundRunSnapshot
  readonly persistedMessages: readonly UIMessage[] | null
  readonly currentMessages: readonly UIMessage[]
}): SavedAnswerScope {
  const buffered = input.settledBuffer ?? input.snapshot
  if (!buffered) return transcriptRunScope(input)
  // A Run before it the transcript still shows live (a stall hid its end) is in scope too.
  const scope = runScopeOf(buffered)
  if (scope.fromOrder === undefined) return scope
  const transcriptFrom = transcriptRunScope(input).fromOrder ?? Number.POSITIVE_INFINITY
  return { fromOrder: Math.min(scope.fromOrder, transcriptFrom) }
}

/** The span of a reconnected Run without a buffer: see `reconnectedRunScope`. */
function transcriptRunScope(input: {
  readonly persistedMessages: readonly UIMessage[] | null
  readonly currentMessages: readonly UIMessage[]
}): SavedAnswerScope {
  const persistedIds = new Set<string>()
  const persistedUserOrders = new Set<number>()
  for (const message of input.persistedMessages ?? []) {
    persistedIds.add(message.id)
    const order = message.metadata?.sessionNodeCreatedOrder
    if (message.role === 'user' && order !== undefined) persistedUserOrders.add(order)
  }
  const { currentMessages } = input
  const isRunStart = (message: UIMessage) =>
    message.role === 'user' &&
    message.metadata?.sessionNodeCreatedOrder !== undefined &&
    !persistedIds.has(message.id)
  const answeredUnderPiIds = (index: number) => {
    for (const later of currentMessages.slice(index + 1)) {
      if (isRunStart(later)) return false
      if (later.role === 'assistant' && persistedIds.has(later.id)) return true
    }
    return false
  }
  const start = currentMessages.find((message, index) => {
    if (!isRunStart(message)) return false
    const order = message.metadata?.sessionNodeCreatedOrder ?? -1
    return !persistedUserOrders.has(order) || !answeredUnderPiIds(index)
  })
  const fromOrder = start?.metadata?.sessionNodeCreatedOrder
  return { fromOrder: fromOrder ?? afterLastSavedRow(currentMessages, persistedIds) }
}

/**
 * Where a Run starts whose prompt the transcript never showed live (a stall lost it): after the
 * last row it shows under its Pi id before the Run's first answer under a stream id. With no such
 * answer, nothing is in scope.
 */
function afterLastSavedRow(
  currentMessages: readonly UIMessage[],
  persistedIds: ReadonlySet<string>,
) {
  let lastSavedOrder: number | undefined
  for (const message of currentMessages) {
    const saved = persistedIds.has(message.id)
    if (!saved && message.role === 'assistant') {
      return lastSavedOrder === undefined ? Number.POSITIVE_INFINITY : lastSavedOrder + 1
    }
    const order = message.metadata?.sessionNodeCreatedOrder
    if (saved && order !== undefined) lastSavedOrder = Math.max(lastSavedOrder ?? order, order)
  }
  return Number.POSITIVE_INFINITY
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
    ...runScopeOf(snapshot),
  })
}
