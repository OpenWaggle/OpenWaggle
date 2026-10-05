import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'
import { placeReconnectedRunMessages } from '../lib/chat-stream-user-messages'
import { acknowledgeCompactionStatus } from '../lib/compaction-lifecycle'
import { unsettledRunMessages } from '../lib/seeded-run-messages'
import {
  appendMissingOptimisticUserMessages,
  appendUnpersistedAssistantTail,
  buildPartialAssistantMessage,
  mergeBackgroundReconnectMessages,
  reconcileSnapshotUserMessages,
  sessionToUIMessages,
} from '../lib/useAgentChat.utils'
import { activeRunHydrationMessages } from './useAgentChat.active-run-messages'
import {
  buildOptimisticMessagesKey,
  buildSessionSnapshotKey,
  getMessagesForSession,
  mergeSessionAndOptimisticMessages,
  setMessagesForSession,
  updateMessagesForSession,
} from './useAgentChat.message-cache'
import type {
  SessionHydrationContext,
  SessionHydrationInput,
  SessionHydrationKeys,
} from './useAgentChat.types'

function resolvePendingForegroundRun(context: SessionHydrationContext) {
  const pending = context.pendingRunWaiterRef.current
  context.pendingRunWaiterRef.current = null
  pending?.resolve()
}

function clearForegroundRunState(context: SessionHydrationContext) {
  context.foregroundStreamActiveRef.current = false
  context.foregroundSessionIdRef.current = null
  context.terminalRunErrorRef.current = undefined
}

export function resetMissingSessionHydration(context: SessionHydrationContext) {
  if (context.foregroundStreamActiveRef.current) {
    resolvePendingForegroundRun(context)
  }
  clearForegroundRunState(context)
  // No Session renders, so none streams in the background here either; the next one hydrates anew.
  context.setBackgroundStreaming(false)
  context.backgroundStreamingRef.current = false
  context.backgroundReconnectSessionIdRef.current = null
  context.streamSignalVersionRef.current = 0
  context.lastHydratedSessionIdRef.current = null
  context.lastHydratedSnapshotKeyRef.current = null
  context.lastHydratedOptimisticKeyRef.current = null
  context.setStatus('ready')
  context.setCompactionStatus(null)
  context.setError(undefined)
}

function getSessionHydrationKeys(input: SessionHydrationInput, context: SessionHydrationContext) {
  const snapshotKey = buildSessionSnapshotKey(input.session)
  const optimisticKey = buildOptimisticMessagesKey(input.optimisticUserMessages)
  return {
    snapshotKey,
    optimisticKey,
    sessionChanged: context.lastHydratedSessionIdRef.current !== input.sessionId,
    snapshotChanged: context.lastHydratedSnapshotKeyRef.current !== snapshotKey,
    optimisticChanged: context.lastHydratedOptimisticKeyRef.current !== optimisticKey,
  }
}

function updateHydrationKeys(
  sessionId: SessionId,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
) {
  context.lastHydratedSessionIdRef.current = sessionId
  context.lastHydratedSnapshotKeyRef.current = keys.snapshotKey
  context.lastHydratedOptimisticKeyRef.current = keys.optimisticKey
}

function resetSessionChangedState(keys: SessionHydrationKeys, context: SessionHydrationContext) {
  if (!keys.sessionChanged) {
    return
  }
  context.setBackgroundStreaming(false)
  context.backgroundStreamingRef.current = false
  context.backgroundReconnectSessionIdRef.current = null
  context.compactionSummaryCountAtStartRef.current = 0
  context.setCompactionStatus(null)
}

function shouldKeepForegroundHydration(
  input: SessionHydrationInput,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
) {
  if (!context.foregroundStreamActiveRef.current) {
    return false
  }
  if (context.foregroundSessionIdRef.current !== input.sessionId) {
    resolvePendingForegroundRun(context)
    clearForegroundRunState(context)
    return false
  }
  context.lastHydratedOptimisticKeyRef.current = keys.optimisticKey
  return true
}

function shouldSkipActiveRunHydration(
  input: SessionHydrationInput,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
) {
  return (
    context.backgroundReconnectSessionIdRef.current === input.sessionId &&
    !keys.sessionChanged &&
    !keys.snapshotChanged &&
    !keys.optimisticChanged
  )
}

/**
 * Merges the reconnect into the transcript shown. The rows a settled Run left there are left to
 * the freshly fetched transcript once it holds that Run: hydration may have used an older one that
 * did not, and merging them would put the persisted copy next to them.
 */
function handleActiveRunReconnectResult(
  capturedSessionId: SessionId,
  reconnect: ReconnectedRun,
  settledMessageIds: ReadonlySet<string> | undefined,
  context: SessionHydrationContext,
) {
  const nextMessages = reconnect.messages
  if (
    context.currentSessionIdRef.current !== capturedSessionId ||
    context.backgroundReconnectSessionIdRef.current !== capturedSessionId
  ) {
    return
  }
  updateMessagesForSession(
    context.messagesBySessionIdRef,
    context.setMessagesBySessionId,
    context.setRunRenderMessages,
    capturedSessionId,
    (currentMessages) =>
      mergeBackgroundReconnectMessages(
        nextMessages,
        unsettledRunMessages({
          persistedMessages: reconnect.persistedMessages,
          cachedMessages: currentMessages,
          settledMessageIds,
        }) ?? currentMessages,
      ),
    { cacheRunSnapshot: true },
  )
}

function handleActiveRunReconnectError(
  capturedSessionId: SessionId,
  reconnectError: unknown,
  context: SessionHydrationContext,
) {
  if (context.currentSessionIdRef.current !== capturedSessionId) {
    return
  }
  context.setError(
    reconnectError instanceof Error ? reconnectError : new Error(String(reconnectError)),
  )
  context.setStatus('error')
  context.setBackgroundStreaming(false)
  context.backgroundStreamingRef.current = false
}

function hydrateActiveRunSession(
  input: SessionHydrationInput,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
) {
  if (shouldSkipActiveRunHydration(input, keys, context)) {
    return
  }

  const { messages: nextMessages, compactionStatus } = activeRunHydrationMessages(input, context)
  setMessagesForSession(
    context.messagesBySessionIdRef,
    context.setMessagesBySessionId,
    context.setRunRenderMessages,
    input.sessionId,
    nextMessages,
    { cacheRunSnapshot: true },
  )
  updateHydrationKeys(input.sessionId, keys, context)
  context.backgroundStreamingRef.current = true
  context.backgroundReconnectSessionIdRef.current = input.sessionId
  context.setBackgroundStreaming(true)
  context.setStatus('streaming')
  const durableSummaryIds = nextMessages.flatMap((message) =>
    message.metadata?.compactionSummary === undefined ? [] : [message.id],
  )
  const acknowledgedStatus = acknowledgeCompactionStatus(compactionStatus, durableSummaryIds)
  if (acknowledgedStatus && acknowledgedStatus.type !== 'retrying') {
    context.compactionSummaryCountAtStartRef.current = acknowledgedStatus.summaryCountAtStart
  }
  context.setCompactionStatus(acknowledgedStatus)
  context.setRunCompactionStatus(input.sessionId, acknowledgedStatus)
  void reconnectToBackgroundRun(input.sessionId, input.session, input.optimisticUserMessages)
    .then((reconnect) =>
      handleActiveRunReconnectResult(
        input.sessionId,
        reconnect,
        input.cachedSettledMessageIds,
        context,
      ),
    )
    .catch((reconnectError: unknown) =>
      handleActiveRunReconnectError(input.sessionId, reconnectError, context),
    )
}

function hydrateIdleSession(
  input: SessionHydrationInput,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
) {
  context.setBackgroundStreaming(false)
  context.backgroundStreamingRef.current = false
  context.backgroundReconnectSessionIdRef.current = null

  if (!keys.sessionChanged && !keys.snapshotChanged && !keys.optimisticChanged) {
    return
  }

  const snapshotMessages = appendMissingOptimisticUserMessages(
    sessionToUIMessages(input.session),
    input.optimisticUserMessages,
  )
  const existingMessages = getMessagesForSession(context.messagesBySessionIdRef, input.sessionId)
  const reconciledMessages = reconcileSnapshotUserMessages(snapshotMessages, existingMessages)
  const nextMessages = appendUnpersistedAssistantTail(reconciledMessages, existingMessages)
  setMessagesForSession(
    context.messagesBySessionIdRef,
    context.setMessagesBySessionId,
    context.setRunRenderMessages,
    input.sessionId,
    nextMessages,
  )
  updateHydrationKeys(input.sessionId, keys, context)

  const durableSummaryIds = nextMessages.flatMap((message) =>
    message.metadata?.compactionSummary === undefined ? [] : [message.id],
  )
  const acknowledgedStatus = acknowledgeCompactionStatus(
    input.cachedCompactionStatus,
    durableSummaryIds,
  )
  context.setCompactionStatus(acknowledgedStatus)
  context.setRunCompactionStatus(input.sessionId, acknowledgedStatus)

  if (keys.sessionChanged) {
    context.setStatus('ready')
    context.setError(undefined)
  }
}

export function hydrateSessionMessages(
  input: SessionHydrationInput,
  context: SessionHydrationContext,
) {
  const keys = getSessionHydrationKeys(input, context)
  if (shouldKeepForegroundHydration(input, keys, context)) {
    return
  }
  resetSessionChangedState(keys, context)
  if (input.hasActiveRun) {
    hydrateActiveRunSession(input, keys, context)
    return
  }
  hydrateIdleSession(input, keys, context)
}

interface ReconnectedRun {
  /** The fetched transcript with the Run's reconnect buffer placed in it. */
  readonly messages: UIMessage[]
  /** The fetched persisted transcript alone. */
  readonly persistedMessages: readonly UIMessage[]
}

async function reconnectToBackgroundRun(
  sessionId: SessionId,
  session: SessionDetail,
  optimisticUserMessages: readonly UIMessage[],
): Promise<ReconnectedRun> {
  const latestSession = (await api.getSessionDetail(sessionId)) ?? session
  const snapshot = await api.getBackgroundRun(sessionId)
  const historicalMessages = mergeSessionAndOptimisticMessages(
    latestSession,
    optimisticUserMessages,
  )
  const persistedMessages = sessionToUIMessages(latestSession)
  if (!snapshot) return { messages: historicalMessages, persistedMessages }

  const partialAssistant = buildPartialAssistantMessage(snapshot.parts, snapshot.messageId)
  return {
    messages: placeReconnectedRunMessages(historicalMessages, snapshot, partialAssistant),
    persistedMessages,
  }
}
