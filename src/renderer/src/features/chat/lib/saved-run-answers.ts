import type { UIMessage } from '@shared/types/chat-ui'

/*
 * Answers (and sends) a Run saved under Pi entry ids while this renderer shows them under stream
 * or optimistic ids: matched by role and content within the Run's span of the Session log, so an
 * earlier Run's message with the same text is never taken for one.
 */

/**
 * Matches the settled answers (and unrecorded sends), in order, with the persisted messages of
 * their own Run: one with the same role and content saved after the last settled user row before
 * it (`pass`) and after the previous match or settled row shown by its Pi id or log order, each
 * once. An earlier Run's message with the same text is before that user row. Only settled rows
 * bound it: the rows of the Run going on may sit anywhere among them. An answer with no content
 * has nothing to lose.
 */
export function createSavedAnswerMatcher(persistedMessages: readonly UIMessage[]) {
  const unmatched: Array<{ readonly id: string; readonly key: string; readonly order: number }> = []
  for (const message of persistedMessages) {
    const order = message.metadata?.sessionNodeCreatedOrder
    if (message.role !== 'system' && order !== undefined) {
      unmatched.push({ id: message.id, key: savedKey(message), order })
    }
  }
  let floor = Number.NEGATIVE_INFINITY
  return {
    /** A settled row; `byId` when it is a persisted row itself, which retires its saved copy. */
    pass(message: UIMessage, byId: boolean) {
      const order = message.metadata?.sessionNodeCreatedOrder
      if (message.role === 'user' && order !== undefined) floor = Math.max(floor, order)
      const index = unmatched.findIndex(
        (saved) =>
          (byId && saved.id === message.id) ||
          (message.role === 'user' && order !== undefined && saved.order === order),
      )
      const saved = unmatched[index]
      if (!saved) return
      floor = Math.max(floor, saved.order)
      unmatched.splice(index, 1)
    },
    take(message: UIMessage) {
      if (answerContentKey(message) === '') return true
      const key = savedKey(message)
      const index = unmatched.findIndex((saved) => saved.key === key && saved.order > floor)
      if (index < 0) return false
      floor = unmatched[index]?.order ?? floor
      unmatched.splice(index, 1)
      return true
    },
  }
}

function savedKey(message: UIMessage) {
  return `${message.role}:${answerContentKey(message)}`
}

/** An answer's text and the tool calls it made: the same streamed and persisted. */
export function answerContentKey(message: UIMessage) {
  return message.parts
    .flatMap((part) =>
      part.type === 'text' ? [part.content] : part.type === 'tool-call' ? [`tool:${part.id}`] : [],
    )
    .join('\n')
}

export type SavedAnswerMatcher = ReturnType<typeof createSavedAnswerMatcher>

export interface SavedAnswerScope {
  readonly shownIds?: ReadonlySet<string>
  /** The Run's first Session log order. */
  readonly fromOrder?: number
  /** The Run's start, by Host time, when its log order is unknown. */
  readonly fromTime?: number
}

function inRunScope(message: UIMessage, order: number | undefined, scope: SavedAnswerScope) {
  if (scope.fromOrder !== undefined && (order === undefined || order < scope.fromOrder))
    return false
  if (scope.fromTime === undefined) return true
  const createdAt = message.createdAt === undefined ? undefined : new Date(message.createdAt)
  // Only a persisted row (one with a log order) is a saved copy.
  return order !== undefined && createdAt !== undefined && createdAt.getTime() >= scope.fromTime
}

/**
 * The messages without the answers the persisted transcript already holds under Pi entry ids
 * while this renderer shows them under stream ids: a compaction in the middle of the Run, or the
 * Run's end before it settled, saved them. An answer is matched by its content among the persisted
 * answers the messages do not show by id (`shownIds`), from `fromOrder` on, each match once. One
 * after a user row at a log order the persisted transcript does not hold is kept: it came
 * later than all that transcript saved, so a saved answer with its text is an earlier Run's.
 */
export function withoutSavedRunAnswers(
  messages: readonly UIMessage[],
  persistedMessages: readonly UIMessage[],
  scope: SavedAnswerScope,
): UIMessage[] {
  const persistedIds = new Set<string>()
  const persistedUserOrders = new Set<number>()
  const savedAnswers = new Map<string, number>()
  for (const message of persistedMessages) {
    persistedIds.add(message.id)
    const order = message.metadata?.sessionNodeCreatedOrder
    if (message.role === 'user' && order !== undefined) persistedUserOrders.add(order)
    if (message.role !== 'assistant' || scope.shownIds?.has(message.id)) continue
    if (!inRunScope(message, order, scope)) continue
    const key = answerContentKey(message)
    if (key) savedAnswers.set(key, (savedAnswers.get(key) ?? 0) + 1)
  }
  if (savedAnswers.size === 0) return [...messages]
  let afterUnsavedUser = false
  return messages.filter((message) => {
    if (message.role === 'user' && !persistedIds.has(message.id)) {
      const order = message.metadata?.sessionNodeCreatedOrder
      // A send the Host has not recorded (no log order) may be saved all the same.
      afterUnsavedUser ||= order !== undefined && !persistedUserOrders.has(order)
    }
    if (message.role !== 'assistant' || persistedIds.has(message.id) || afterUnsavedUser) {
      return true
    }
    const key = answerContentKey(message)
    const count = savedAnswers.get(key) ?? 0
    if (count === 0) return true
    savedAnswers.set(key, count - 1)
    return false
  })
}
