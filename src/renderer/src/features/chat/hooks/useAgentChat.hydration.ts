import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'
import {
  appendMissingOptimisticUserMessages,
  appendUnpersistedAssistantTail,
  buildPartialAssistantMessage,
  mergeBackgroundReconnectMessages,
  reconcileSnapshotUserMessages,
  sessionToUIMessages,
} from '../lib/useAgentChat.utils'
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

function handleActiveRunReconnectResult(
  capturedSessionId: SessionId,
  nextMessages: UIMessage[] | null,
  context: SessionHydrationContext,
) {
  if (
    !nextMessages ||
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
    (currentMessages) => mergeBackgroundReconnectMessages(nextMessages, currentMessages),
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

  const persistedMessages = mergeSessionAndOptimisticMessages(
    input.session,
    input.optimisticUserMessages,
  )
  const nextMessages = input.cachedRenderMessages
    ? mergeBackgroundReconnectMessages([...persistedMessages], [...input.cachedRenderMessages])
    : reconcileSnapshotUserMessages(
        persistedMessages,
        getMessagesForSession(context.messagesBySessionIdRef, input.sessionId),
      )
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
  void reconnectToBackgroundRun(input.sessionId, input.session, input.optimisticUserMessages)
    .then((nextReconnectMessages) =>
      handleActiveRunReconnectResult(input.sessionId, nextReconnectMessages, context),
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
  setMessagesForSession(
    context.messagesBySessionIdRef,
    context.setMessagesBySessionId,
    context.setRunRenderMessages,
    input.sessionId,
    appendUnpersistedAssistantTail(reconciledMessages, existingMessages),
  )
  updateHydrationKeys(input.sessionId, keys, context)

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

async function reconnectToBackgroundRun(
  sessionId: SessionId,
  session: SessionDetail,
  optimisticUserMessages: readonly UIMessage[],
) {
  const latestSession = await api.getSessionDetail(sessionId)
  const snapshot = await api.getBackgroundRun(sessionId)
  const historicalMessages = mergeSessionAndOptimisticMessages(
    latestSession ?? session,
    optimisticUserMessages,
  )
  if (!snapshot) {
    return historicalMessages
  }

  const partialAssistant = buildPartialAssistantMessage(snapshot.parts, snapshot.messageId)
  return partialAssistant ? [...historicalMessages, partialAssistant] : historicalMessages
}
