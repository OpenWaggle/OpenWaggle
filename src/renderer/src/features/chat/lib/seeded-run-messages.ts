import type { UIMessage } from '@shared/types/chat-ui'
import {
  type AgentCompactionStatus,
  type AgentCompactionTimelineItem,
  getTimelineCompactionStatus,
} from './compaction-lifecycle'
import {
  createSavedAnswerMatcher,
  type SavedAnswerMatcher,
  type SavedAnswerSince,
} from './saved-run-answers'

interface PlacedRunMessages {
  readonly messages: UIMessage[]
  readonly compactionStatus: AgentCompactionStatus | null
}

/**
 * The transcript of a Session opened while a Run seeded its render snapshot, and that snapshot's
 * compaction status placed in it.
 *
 * A seeded snapshot holds only the current Run's messages, streamed while no route rendered the
 * Session, and that Run starts after everything persisted. So they follow the persisted history
 * as they are: matching them to it by text put a repeated prompt ("continue") in the place of the
 * first one, above the previous Run's answers. A message the history already holds, by id or as a
 * user row at the same Session log order, is not repeated.
 *
 * The compaction status was recorded against the Run's messages alone, so its anchors and durable
 * summary counts are moved past the history; otherwise its row anchored inside older history.
 */
export function placeSeededRunMessages(input: {
  readonly persistedMessages: readonly UIMessage[]
  readonly seededMessages: readonly UIMessage[]
  readonly compactionStatus: AgentCompactionStatus | null
}): PlacedRunMessages {
  return placeRunMessages({
    persistedMessages: input.persistedMessages,
    cachedMessages: input.seededMessages,
    settledMessageIds: new Set(),
    compactionStatus: input.compactionStatus,
  })
}

/**
 * The transcript of a Session hydrated while a Run is active from a snapshot that holds a settled
 * Run, or `null` while the persisted transcript does not hold that Run yet
 * (`unsettledRunMessages`). The settled rows are left to their persisted copies and the rest, the
 * active Run's, follow them. A compaction anchored after the settled rows moves past the persisted
 * history; one anchored among them stays where it was.
 */
export function placeUnsettledRunMessages(input: {
  readonly persistedMessages: readonly UIMessage[]
  readonly cachedMessages: readonly UIMessage[]
  readonly settledMessageIds: ReadonlySet<string> | undefined
  readonly compactionStatus: AgentCompactionStatus | null
}): PlacedRunMessages | null {
  const { settledMessageIds } = input
  const kept = unsettledRunMessages(input)
  if (!settledMessageIds || kept === null) return null
  // Settled rows kept as they are (a user row not persisted yet) are placed like the active Run's.
  const keptIds = new Set(kept.map((message) => message.id))
  const leftIds = new Set([...settledMessageIds].filter((messageId) => !keptIds.has(messageId)))
  return placeRunMessages({ ...input, settledMessageIds: leftIds })
}

function placeRunMessages(input: {
  readonly persistedMessages: readonly UIMessage[]
  readonly cachedMessages: readonly UIMessage[]
  readonly settledMessageIds: ReadonlySet<string>
  readonly compactionStatus: AgentCompactionStatus | null
}): PlacedRunMessages {
  const { persistedMessages, cachedMessages, settledMessageIds } = input
  const persisted = indexPersistedMessages(persistedMessages)
  const runMessages: UIMessage[] = []
  // keptBefore[count] / settledBefore[count]: of the first `count` cached messages, how many are
  // shown after the history, and how many a settled Run left.
  const keptBefore = [0]
  const settledBefore = [0]
  let settledSummaries = 0
  for (const message of cachedMessages) {
    const settled = settledMessageIds.has(message.id)
    if (settled && message.metadata?.compactionSummary !== undefined) settledSummaries += 1
    if (!settled && !isPersisted(message, persisted)) runMessages.push(message)
    keptBefore.push(runMessages.length)
    settledBefore.push((settledBefore.at(-1) ?? 0) + (settled ? 1 : 0))
  }

  const settledTotal = settledBefore.at(-1) ?? 0
  const at = (count: number) => Math.min(Math.max(count, 0), cachedMessages.length)
  const followsSettled = (count: number) => (settledBefore[at(count)] ?? 0) >= settledTotal
  return {
    messages: [...persistedMessages, ...runMessages],
    compactionStatus: rebaseRunCompaction(input.compactionStatus, {
      messageCountAt: (count) =>
        followsSettled(count)
          ? persistedMessages.length + (keptBefore[at(count)] ?? 0)
          : Math.min(count, persistedMessages.length),
      summaryOffsetAt: (count) =>
        followsSettled(count) ? persisted.summaryCount - settledSummaries : 0,
    }),
  }
}

function isPersisted(message: UIMessage, persisted: PersistedIndex) {
  if (persisted.ids.has(message.id)) return true
  const order = message.metadata?.sessionNodeCreatedOrder
  return message.role === 'user' && order !== undefined && persisted.userOrders.has(order)
}

interface RunCompactionRebase {
  readonly messageCountAt: (cachedMessageCount: number) => number
  readonly summaryOffsetAt: (cachedMessageCount: number) => number
}

function rebaseTimelineItem(
  item: AgentCompactionTimelineItem,
  rebase: RunCompactionRebase,
): AgentCompactionTimelineItem {
  const summaryOffset = rebase.summaryOffsetAt(item.messageCountAtStart)
  return {
    ...item,
    summaryCountAtStart: item.summaryCountAtStart + summaryOffset,
    ...(item.expectedSummaryCount === undefined
      ? {}
      : { expectedSummaryCount: item.expectedSummaryCount + summaryOffset }),
    messageCountAtStart: rebase.messageCountAt(item.messageCountAtStart),
  }
}

function rebaseRunCompaction(
  status: AgentCompactionStatus | null,
  rebase: RunCompactionRebase,
): AgentCompactionStatus | null {
  const timelineStatus = getTimelineCompactionStatus(status)
  if (!status || !timelineStatus) return status
  // The status's own count is the latest compaction's.
  const latestAnchor = timelineStatus.timeline.at(-1)?.messageCountAtStart ?? 0
  const rebased = {
    ...timelineStatus,
    summaryCountAtStart: timelineStatus.summaryCountAtStart + rebase.summaryOffsetAt(latestAnchor),
    timeline: timelineStatus.timeline.map((item) => rebaseTimelineItem(item, rebase)),
  }
  return status.type === 'retrying' ? { ...status, previousCompactionStatus: rebased } : rebased
}

/**
 * The cached messages without the rows a settled Run left, or `null` while the persisted transcript
 * does not hold that Run yet (no settled answer has a saved copy in its Run's span).
 *
 * A route that watched a Session go straight on to a queued Follow-up still shows the settled Run
 * under stream ids, and writes them back into the render snapshot during the next Run. Once that
 * Run is persisted under Pi entry ids those rows match nothing, so merging them showed its answers
 * twice. Each settled row is judged on its own: one persisted by id is left, and so is a user row at
 * a Session log order the persisted transcript has; a user row it does not hold yet (an optimistic
 * send queued as the Run settled) is kept. Assistant rows carry no order, so they are left only when
 * some settled user row shows its Run is persisted; otherwise every row is kept rather than lost.
 */
export function unsettledRunMessages(input: {
  readonly persistedMessages: readonly UIMessage[]
  readonly cachedMessages: readonly UIMessage[]
  readonly settledMessageIds: ReadonlySet<string> | undefined
  /**
   * The persisted transcript was fetched after those Runs settled, so it holds what they saved: a
   * Run is persisted before it settles. An assistant row needs no user row to vouch for its Run
   * then, and is left to the persisted transcript when that holds an answer of its own Run with
   * its content (not an earlier Run's with the same text), each saved answer once; without this,
   * a Run whose prompt the renderer never saw (it reloaded mid-Run) kept its answers under stream
   * ids next to their persisted copies. One it lacks (a save that failed) is kept.
   */
  readonly fetchedAfterSettlement?: boolean
}): UIMessage[] | null {
  const { persistedMessages, cachedMessages, settledMessageIds } = input
  if (!settledMessageIds || settledMessageIds.size === 0) return null
  const persisted = indexPersistedMessages(persistedMessages)
  const savedAnswers = createSavedAnswerMatcher(
    persistedMessages,
    settledRunsSince(cachedMessages, settledMessageIds, persisted),
  )
  let unknownSettledRows = 0
  let vouchingUserRows = 0
  const savedIds = new Set<string>()
  const unsettled: UIMessage[] = []
  for (const message of cachedMessages) {
    if (!settledMessageIds.has(message.id)) {
      unsettled.push(message)
      continue
    }
    const persistence = settledRowPersistence(message, persisted)
    savedAnswers.pass(message, persistence === 'persisted')
    const saved = takesSavedCopy(message, persistence, savedAnswers)
    if (saved) savedIds.add(message.id)
    if (keepsSettledRow(persistence, saved, input.fetchedAfterSettlement)) unsettled.push(message)
    if (persistence === 'vouches') vouchingUserRows += 1
    if (persistence === 'unknown') unknownSettledRows += 1
  }
  if (unknownSettledRows === 0 || vouchingUserRows > 0 || input.fetchedAfterSettlement === true) {
    return unsettled
  }
  // The transcript may not hold the Run yet: its rows stay, but not an answer or send it holds a
  // saved copy of in that Run's span, which showed twice until the Run after it settled.
  return savedIds.size === 0 ? null : cachedMessages.filter((message) => !savedIds.has(message.id))
}

/**
 * Whether the transcript holds a saved copy of a settled answer, or of a send the renderer showed
 * before the Host recorded it (it has no log order), in its Run's span. Taken whatever the row's
 * fate: a match moves the span on for the rows after it.
 */
function takesSavedCopy(
  message: UIMessage,
  persistence: ReturnType<typeof settledRowPersistence>,
  savedAnswers: SavedAnswerMatcher,
) {
  const unrecordedSend =
    persistence === 'unpersisted' && message.metadata?.sessionNodeCreatedOrder === undefined
  return (persistence === 'unknown' || unrecordedSend) && savedAnswers.take(message)
}

/**
 * Whether a settled row stays: one the persisted transcript does not hold yet, unless it is a send
 * the renderer showed before the Host recorded it and the transcript holds a prompt with its text
 * in its Run's span (`saved`; until then it may be queued); and, with a fresh transcript, an
 * answer it holds no saved copy of (a save that failed).
 */
function keepsSettledRow(
  persistence: ReturnType<typeof settledRowPersistence>,
  saved: boolean,
  fetchedAfterSettlement: boolean | undefined,
) {
  if (persistence === 'unpersisted') return !saved
  return persistence === 'unknown' && fetchedAfterSettlement === true && !saved
}

/** Where the settled Runs start in the Session log (`SavedAnswerSince`). */
function settledRunsSince(
  cachedMessages: readonly UIMessage[],
  settledMessageIds: ReadonlySet<string>,
  persisted: PersistedIndex,
): SavedAnswerSince {
  const firstSettled = cachedMessages.findIndex((message) => settledMessageIds.has(message.id))
  let afterOrder: number | undefined
  for (const message of cachedMessages.slice(0, Math.max(firstSettled, 0))) {
    const order = message.metadata?.sessionNodeCreatedOrder
    if (order !== undefined && persisted.ids.has(message.id)) afterOrder = order
  }
  const sendTimes = cachedMessages.flatMap((message) =>
    settledMessageIds.has(message.id) &&
    message.role === 'user' &&
    message.metadata?.sessionNodeCreatedOrder === undefined &&
    !persisted.ids.has(message.id)
      ? (message.createdAt?.getTime() ?? [])
      : [],
  )
  return {
    ...(afterOrder === undefined ? {} : { afterOrder }),
    ...(sendTimes.length === 0 ? {} : { createdAt: Math.min(...sendTimes) }),
  }
}

interface PersistedIndex {
  readonly ids: ReadonlySet<string>
  readonly userOrders: ReadonlySet<number>
  readonly summaryCount: number
}

function indexPersistedMessages(messages: readonly UIMessage[]): PersistedIndex {
  const ids = new Set<string>()
  const userOrders = new Set<number>()
  let summaryCount = 0
  for (const message of messages) {
    ids.add(message.id)
    const order = message.metadata?.sessionNodeCreatedOrder
    if (message.role === 'user' && order !== undefined) userOrders.add(order)
    if (message.metadata?.compactionSummary !== undefined) summaryCount += 1
  }
  return { ids, userOrders, summaryCount }
}

/**
 * How the persisted transcript holds a settled row: by id; as a user row at its Session log order,
 * which vouches its Run is persisted; not at all; or unknowably (an assistant row by another id).
 */
function settledRowPersistence(message: UIMessage, persisted: PersistedIndex) {
  if (persisted.ids.has(message.id)) return 'persisted'
  if (message.role !== 'user') return 'unknown'
  const order = message.metadata?.sessionNodeCreatedOrder
  return order !== undefined && persisted.userOrders.has(order) ? 'vouches' : 'unpersisted'
}
