import type { SessionId } from '@shared/types/brand'
import { acknowledgeCompactionStatus } from '../lib/compaction-lifecycle'
import {
  appendMissingOptimisticUserMessages,
  appendUnpersistedAssistantTail,
  reconcileSnapshotUserMessages,
  sessionToUIMessages,
} from '../lib/useAgentChat.utils'
import { activeRunHydrationMessages } from './useAgentChat.active-run-messages'
import {
  buildOptimisticMessagesKey,
  buildSessionSnapshotKey,
  getMessagesForSession,
  setMessagesForSession,
} from './useAgentChat.message-cache'
import { reconnectActiveRun } from './useAgentChat.reconnect'
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

function getSessionHydrationKeys(
  input: SessionHydrationInput,
  context: SessionHydrationContext,
  resynced: boolean,
) {
  const snapshotKey = buildSessionSnapshotKey(input.session)
  const optimisticKey = buildOptimisticMessagesKey(input.optimisticUserMessages)
  return {
    snapshotKey,
    optimisticKey,
    sessionChanged: context.lastHydratedSessionIdRef.current !== input.sessionId,
    // After a resync the transcript may lack events, so it is rebuilt even from the same detail.
    snapshotChanged: resynced || context.lastHydratedSnapshotKeyRef.current !== snapshotKey,
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
  reconnectActiveRun(input, context, 'background')
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
  const resynced = context.lastHydratedResyncRevisionRef.current !== input.resyncRevision
  context.lastHydratedResyncRevisionRef.current = input.resyncRevision
  // Only a Run can have lost events to recover: an idle Session rebuilt from a detail that may
  // not hold its just-finished Run yet would drop that Run's rows until the refetch landed.
  const keys = getSessionHydrationKeys(input, context, resynced && input.hasActiveRun)
  if (shouldKeepForegroundHydration(input, keys, context)) {
    // The Run this renderer follows keeps streaming into its transcript; only what it missed is
    // merged in from the reconnect buffer. Once the send's own Run settled (the Session went on to
    // the next Run, perhaps in a stall the resync relayed), the transcript may lack what Runs saved
    // meanwhile: it is read again too.
    if (resynced) {
      const sendSettled = context.pendingRunWaiterRef.current === null
      reconnectActiveRun(input, context, 'foreground', sendSettled)
    }
    return
  }
  resetSessionChangedState(keys, context)
  if (input.hasActiveRun) {
    hydrateActiveRunSession(input, keys, context)
    return
  }
  hydrateIdleSession(input, keys, context)
}
