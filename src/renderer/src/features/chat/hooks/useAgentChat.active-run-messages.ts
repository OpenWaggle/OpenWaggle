import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentCompactionStatus } from '../lib/compaction-lifecycle'
import { reconnectedRunScope } from '../lib/reconnect-run-scope'
import { withoutSavedRunAnswers } from '../lib/saved-run-answers'
import {
  placeSeededRunMessages,
  placeUnsettledRunMessages,
  unsettledRunMessages,
} from '../lib/seeded-run-messages'
import {
  appendMissingOptimisticUserMessages,
  mergeBackgroundReconnectMessages,
  reconcileSnapshotUserMessages,
  sessionToUIMessages,
} from '../lib/useAgentChat.utils'
import {
  getMessagesForSession,
  mergeSessionAndOptimisticMessages,
} from './useAgentChat.message-cache'
import type { SessionHydrationContext, SessionHydrationInput } from './useAgentChat.types'

/**
 * The transcript of a Session hydrated while a Run is active, and the compaction status shown in it.
 *
 * Cached messages that are only the active Run's follow the persisted history as they are: a
 * run-start seed's, or those of a snapshot that holds a settled Run once its rows are left to the
 * persisted transcript. Otherwise the cached transcript is merged into the persisted one.
 */
export function activeRunHydrationMessages(
  input: SessionHydrationInput,
  context: SessionHydrationContext,
): { readonly messages: UIMessage[]; readonly compactionStatus: AgentCompactionStatus | null } {
  const cachedMessages = input.cachedRenderMessages
  const placed = cachedMessages ? placeCachedRunMessages(input, cachedMessages, context) : null
  if (placed) {
    return {
      messages: appendMissingOptimisticUserMessages(placed.messages, input.optimisticUserMessages),
      compactionStatus: placed.compactionStatus,
    }
  }
  const persistedMessages = mergeSessionAndOptimisticMessages(
    input.session,
    input.optimisticUserMessages,
  )
  return {
    messages: cachedMessages
      ? mergeBackgroundReconnectMessages([...persistedMessages], [...cachedMessages], {
          earlierMessageIds: new Set(input.session.messages.map((message) => String(message.id))),
        })
      : reconcileSnapshotUserMessages(
          persistedMessages,
          getMessagesForSession(context.messagesBySessionIdRef, input.sessionId),
        ),
    compactionStatus: input.cachedCompactionStatus,
  }
}

function placeCachedRunMessages(
  input: SessionHydrationInput,
  shownMessages: readonly UIMessage[],
  context: SessionHydrationContext,
) {
  const persistedMessages = sessionToUIMessages(input.session)
  const cachedMessages = withoutSavedActiveRunAnswers(
    withoutSavedNoticedAnswers(shownMessages, persistedMessages, input.cachedNoticedMessageIds),
    persistedMessages,
  )
  const compactionStatus = input.cachedCompactionStatus
  if (input.cachedRenderSeeded) {
    return placeSeededRunMessages({
      persistedMessages: withUnsavedSettledRows(input, persistedMessages, context),
      seededMessages: cachedMessages,
      compactionStatus,
    })
  }
  return placeUnsettledRunMessages({
    persistedMessages,
    cachedMessages,
    settledMessageIds: input.cachedSettledMessageIds,
    compactionStatus,
  })
}

/**
 * The cached rows without the active Run's answers the persisted transcript already holds under Pi
 * entry ids: the Run ended and was saved, its end and settlement lost to this renderer (a
 * disconnect). Matched by content within that Run's span (`reconnectedRunScope`), each once.
 */
function withoutSavedActiveRunAnswers(
  cachedMessages: readonly UIMessage[],
  persistedMessages: readonly UIMessage[],
) {
  return withoutSavedRunAnswers(cachedMessages, persistedMessages, {
    shownIds: new Set(cachedMessages.map((message) => message.id)),
    ...reconnectedRunScope({ snapshot: null, persistedMessages, currentMessages: cachedMessages }),
  })
}

/**
 * The cached rows without the noticed rows (`noticedMessageIds`) the persisted transcript already
 * holds under Pi entry ids. Until the Host names the Run whose start was lost, they are the Run
 * before's, saved, or its own continuing, unsaved: the saved ones showed twice when no live prompt
 * started their Run's span (it streamed in a stall). Matched by content within that Run's span,
 * each once (`noticedRunStartOrder`); the unsaved ones have no saved copy and stay.
 */
function withoutSavedNoticedAnswers(
  cachedMessages: readonly UIMessage[],
  persistedMessages: readonly UIMessage[],
  noticedMessageIds: ReadonlySet<string> | undefined,
) {
  if (!noticedMessageIds || noticedMessageIds.size === 0) return cachedMessages
  const noticed = cachedMessages.filter((message) => noticedMessageIds.has(message.id))
  const fromOrder = noticedRunStartOrder(noticed, persistedMessages)
  if (fromOrder === undefined) return cachedMessages
  const shownIds = new Set(cachedMessages.map((message) => message.id))
  const kept = new Set(
    withoutSavedRunAnswers(noticed, persistedMessages, { shownIds, fromOrder }).map(
      (message) => message.id,
    ),
  )
  return cachedMessages.filter(
    (message) => !noticedMessageIds.has(message.id) || kept.has(message.id),
  )
}

/**
 * Where the noticed rows' Run starts: at its prompt when they hold it; otherwise at the last saved
 * prompt they do not hold (a steer the Run took after its first answers is one of its own).
 */
function noticedRunStartOrder(
  noticed: readonly UIMessage[],
  persistedMessages: readonly UIMessage[],
) {
  const first = noticed[0]
  const firstOrder = first?.role === 'user' ? first.metadata?.sessionNodeCreatedOrder : undefined
  if (firstOrder !== undefined) return firstOrder
  const noticedOrders = new Set(
    noticed.flatMap((message) => {
      const order = message.metadata?.sessionNodeCreatedOrder
      return message.role === 'user' && order !== undefined ? [order] : []
    }),
  )
  let fromOrder: number | undefined
  for (const message of persistedMessages) {
    const order = message.metadata?.sessionNodeCreatedOrder
    if (message.role !== 'user' || order === undefined || noticedOrders.has(order)) continue
    fromOrder = Math.max(fromOrder ?? order, order)
  }
  return fromOrder
}

/**
 * The persisted history with the rows of the settled Run a seed carried (`settledMessageIds`) that
 * it does not hold yet, as the transcript last showed them: the seed keeps only their ids, and a
 * detail from before that Run was saved (its refetch still on the way) would lose the whole Run.
 */
function withUnsavedSettledRows(
  input: SessionHydrationInput,
  persistedMessages: readonly UIMessage[],
  context: SessionHydrationContext,
) {
  const settledMessageIds = input.cachedSettledMessageIds
  if (!settledMessageIds || settledMessageIds.size === 0) return persistedMessages
  const settledRows = getMessagesForSession(context.messagesBySessionIdRef, input.sessionId).filter(
    (message) => settledMessageIds.has(message.id),
  )
  if (settledRows.length === 0) return persistedMessages
  const unsaved =
    unsettledRunMessages({ persistedMessages, cachedMessages: settledRows, settledMessageIds }) ??
    settledRows
  const persistedIds = new Set(persistedMessages.map((message) => message.id))
  return [...persistedMessages, ...unsaved.filter((message) => !persistedIds.has(message.id))]
}
