import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentCompactionStatus } from '../lib/compaction-lifecycle'
import { placeSeededRunMessages, placeUnsettledRunMessages } from '../lib/seeded-run-messages'
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
  const placed = cachedMessages ? placeCachedRunMessages(input, cachedMessages) : null
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
) {
  const persistedMessages = sessionToUIMessages(input.session)
  const compactionStatus = input.cachedCompactionStatus
  if (input.cachedRenderSeeded) {
    return placeSeededRunMessages({
      persistedMessages,
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
