import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentCompactionStatus } from '../lib/compaction-lifecycle'
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
  cachedMessages: readonly UIMessage[],
  context: SessionHydrationContext,
) {
  const persistedMessages = sessionToUIMessages(input.session)
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
