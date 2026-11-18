import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'
import { requestDesktopNotificationPermissionOnce } from '@/features/desktop-notifications'
import { api } from '@/shared/lib/ipc'
import { MessageDeliveredRunFailed } from '../lib/message-delivery'
import { sessionModelActionError } from '../lib/session-answered-by'
import { createOptimisticUserMessage } from '../lib/useAgentChat.utils'
import { withForegroundSend } from '../state/foreground-send-store'
import { useOptimisticSteerStore } from '../state/optimistic-steer-store'
import { useRunFinishingStore } from '../state/run-finishing-store'
import { settledSessionSettingWrites } from '../state/session-setting-writes'
import {
  beginForegroundRun,
  clearRunPointers,
  normalizeError,
  offerRunCompletion,
  stopFollowingSends,
} from './useAgentChat.foreground-run'
import { updateMessagesForSession } from './useAgentChat.message-cache'
import {
  forgetIfFailedOutOfView,
  forgetIfRefusedForPiSessionFile,
  forgetRefusedFirstSend,
  type ReportWithoutRun,
  settleSendWithoutRun,
} from './useAgentChat.send-without-run'
import { createSessionSnapshotRefresh } from './useAgentChat.session-snapshot'
import type {
  AgentChatStatus,
  AgentRunActions,
  MutableValueRef,
  PendingRunWaiter,
  SetAgentChatError,
  SetAgentChatStatus,
  SetBackgroundStreaming,
  SetCompactionStatus,
  SetMessagesBySessionId,
  SetRunRenderMessages,
} from './useAgentChat.types'

interface AgentRunControlRefs {
  readonly currentSessionIdRef: MutableValueRef<SessionId | null>
  readonly statusRef: MutableValueRef<AgentChatStatus>
  readonly backgroundStreamingRef: MutableValueRef<boolean>
  readonly foregroundStreamActiveRef: MutableValueRef<boolean>
  readonly foregroundSessionIdRef: MutableValueRef<SessionId | null>
  readonly terminalRunErrorRef: MutableValueRef<Error | undefined>
  readonly backgroundReconnectSessionIdRef: MutableValueRef<SessionId | null>
  readonly deferredRefreshSessionIdRef: MutableValueRef<SessionId | null>
  readonly deferredSnapshotRefreshCountRef: MutableValueRef<number>
  readonly pendingRunWaiterRef: MutableValueRef<PendingRunWaiter | null>
  readonly messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>
  readonly sessionRef: MutableValueRef<SessionDetail | null>
}

interface AgentRunControlParams {
  readonly sessionId: SessionId | null
  readonly isFirstMessage: boolean
  readonly model: SupportedModelId | undefined
  /** The error on screen when this render's controls were created; a queued send restores it. */
  readonly error: Error | undefined
  readonly refs: AgentRunControlRefs
  readonly setMessagesBySessionId: SetMessagesBySessionId
  readonly setRunRenderMessages: SetRunRenderMessages
  readonly setFirstSendRecovery: (
    sessionId: SessionId,
    recovery: {
      readonly payload: AgentSendPayload
      readonly waggleConfig: WaggleConfig | null
      readonly model: SupportedModelId | undefined
    } | null,
  ) => void
  readonly setBackgroundStreaming: SetBackgroundStreaming
  readonly setError: SetAgentChatError
  readonly setStatus: SetAgentChatStatus
  readonly setCompactionStatus: SetCompactionStatus
  readonly addOptimisticUserMessage: (sessionId: SessionId, message: UIMessage) => void
  readonly removeOptimisticUserMessage: (sessionId: SessionId, messageId: UIMessage['id']) => void
  readonly upsertSession: (session: SessionDetail) => void
}

function resetRunUiState(params: AgentRunControlParams) {
  clearRunPointers(params.refs)
  params.setBackgroundStreaming(false)
  params.refs.backgroundStreamingRef.current = false
  params.refs.backgroundReconnectSessionIdRef.current = null
  params.setCompactionStatus(null)
  params.setStatus('ready')
}

function shouldDeferSnapshotRefresh(refs: AgentRunControlRefs) {
  return (
    refs.deferredSnapshotRefreshCountRef.current > 0 ||
    refs.statusRef.current === 'submitted' ||
    refs.statusRef.current === 'streaming' ||
    refs.backgroundStreamingRef.current
  )
}

/**
 * Hand a completion to the send being followed. It stays followed unless the completion was its
 * own: a completion of an earlier Run is passed back to that Run's send, and one that arrives
 * before the send knows its Run is held until it does.
 */
function settlePendingRun(refs: AgentRunControlRefs, nextError?: Error, runId?: string) {
  const pending = refs.pendingRunWaiterRef.current
  if (!pending) return 'settled' as const
  const routing = offerRunCompletion(pending, {
    ...(runId === undefined ? {} : { runId }),
    ...(nextError ? { error: nextError } : {}),
  })
  if (routing === 'settled' && refs.pendingRunWaiterRef.current === pending) {
    refs.pendingRunWaiterRef.current = null
  }
  return routing
}

export function createAgentRunControls(params: AgentRunControlParams) {
  const { refs, sessionId } = params

  const refreshSessionSnapshot = createSessionSnapshotRefresh({
    currentSessionIdRef: refs.currentSessionIdRef,
    sessionRef: refs.sessionRef,
    upsertSession: (session) => params.upsertSession(session),
  })

  function flushDeferredSessionSnapshot() {
    const targetSessionId = refs.deferredRefreshSessionIdRef.current
    if (!targetSessionId || shouldDeferSnapshotRefresh(refs)) return
    if (refs.currentSessionIdRef.current !== targetSessionId) {
      refs.deferredRefreshSessionIdRef.current = null
      return
    }

    refs.deferredRefreshSessionIdRef.current = null
    void refreshSessionSnapshot(targetSessionId)
  }

  async function withDeferredSnapshotRefresh<T>(operation: () => Promise<T>) {
    refs.deferredSnapshotRefreshCountRef.current += 1
    try {
      return await operation()
    } finally {
      refs.deferredSnapshotRefreshCountRef.current = Math.max(
        0,
        refs.deferredSnapshotRefreshCountRef.current - 1,
      )
      flushDeferredSessionSnapshot()
    }
  }

  async function dispatchAgentSend(
    payload: AgentSendPayload,
    waggleConfig: WaggleConfig | null,
    model: SupportedModelId,
    optimisticMessageId: UIMessage['id'],
  ) {
    if (!sessionId) {
      return
    }
    const targetSessionId = sessionId
    const run = beginForegroundRun(refs, params, targetSessionId)
    const sent = { refs, setters: params, targetSessionId, run, optimisticMessageId }
    // The Host reads the Session's model and thinking level at Run start: store a fresh pick first.
    await settledSessionSettingWrites(targetSessionId)
    requestDesktopNotificationPermissionOnce()
    const sendPromise = waggleConfig
      ? api.sendWaggleMessage(targetSessionId, payload, model, waggleConfig)
      : api.sendMessage(targetSessionId, payload, model)

    /*
     * Raised after the try block, never inside it. The catch below tears the run down and puts the session into
     * an error state, which is wrong for this case twice over: a cancellation is not a run failure, and the run
     * being torn down may already have been *replaced* - stopping settles the run, a queued follow-up send
     * begins immediately, and the superseded send's reply arrives after that replacement has started.
     */
    let reportWithoutRun: ReportWithoutRun
    let delivered = false
    try {
      /*
       * The report is read, not merely awaited. Main recovers every run failure into a value rather than
       * failing the Effect, so this invoke resolves whether the turn ran or was refused - and the run promise
       * can be settled without an error by ordinary actions such as Stop. Without consulting the report, a
       * refused send reached the caller as a success and a submitted review was discarded.
       */
      const report = await sendPromise
      if (report.outcome === 'delivered') {
        delivered = true
        run.bind(report.runId)
        await run.promise
        return
      }
      // Nothing is waiting on the run any more, but its rejection must not surface unhandled.
      void run.promise.catch(() => undefined)
      reportWithoutRun = { ...report, outcome: report.outcome }
    } catch (runError) {
      const normalizedError = normalizeError(runError)
      const refused = forgetIfRefusedForPiSessionFile(sent, normalizedError)
      if (refused) {
        void refreshSessionSnapshot(targetSessionId)
        throw refused
      }
      const outOfView = delivered ? undefined : forgetIfFailedOutOfView(sent, normalizedError)
      if (outOfView) throw outOfView
      const ownsForeground =
        refs.pendingRunWaiterRef.current === null || refs.pendingRunWaiterRef.current === run.waiter
      if (ownsForeground && refs.foregroundSessionIdRef.current === targetSessionId) {
        refs.pendingRunWaiterRef.current = null
        clearRunPointers(refs)
      }
      if (ownsForeground && refs.currentSessionIdRef.current === targetSessionId) {
        params.setError(normalizedError)
        params.setStatus('error')
        refs.terminalRunErrorRef.current = normalizedError
      }
      /*
       * Distinguished, because a caller cannot tell these apart otherwise and one of them must not be
       * treated as a lost message: the run failing says nothing about whether the message arrived.
       * The evidence is the agent reporting the turn started, not this invoke resolving. Main recovers
       * every run failure into a value and resolves - including a refusal raised before the message is
       * recorded, such as a session whose worktree has gone - so "the send resolved" labelled
       * undelivered messages delivered, and the caller that restores a review then discarded it.
       * Absent that evidence the failure is reported as undelivered, which keeps the user's work.
       */
      /*
       * Delivered only if main said so. This catch also covers the invoke itself rejecting - a payload the
       * schema refuses, a handler that dies - where nothing arrived at all, and treating that as delivered
       * destroyed the work a caller was holding for exactly this case.
       */
      throw delivered ? new MessageDeliveredRunFailed(normalizedError) : normalizedError
    }
    /*
     * The caller is told, so work it submitted is not lost - a review is restored - but whether this is
     * worth showing the user is its decision, and a cancellation is not.
     */
    const notDelivered = settleSendWithoutRun(sent, reportWithoutRun)
    if (notDelivered) throw notDelivered
  }

  async function sendUserPayload(payload: AgentSendPayload, waggleConfig: WaggleConfig | null) {
    if (!sessionId) {
      return
    }
    // Transcript retries and diff follow-ups bypass the composer gate; validate before the
    // optimistic turn is appended, so a refused send leaves no phantom message behind.
    const model = params.model
    const unavailable = sessionModelActionError(refs.sessionRef.current, model)
    if (unavailable || !model) {
      params.setError(unavailable ?? new Error('Select a model before sending.'))
      return
    }

    const optimisticUserMessage = createOptimisticUserMessage(payload)
    if (params.isFirstMessage) {
      params.setFirstSendRecovery(sessionId, {
        payload,
        waggleConfig,
        model,
      })
    }
    params.addOptimisticUserMessage(sessionId, optimisticUserMessage)
    updateMessagesForSession(
      refs.messagesBySessionIdRef,
      params.setMessagesBySessionId,
      params.setRunRenderMessages,
      sessionId,
      (currentMessages) => [...currentMessages, optimisticUserMessage],
      { cacheRunSnapshot: true },
    )
    try {
      await withForegroundSend(sessionId, () =>
        dispatchAgentSend(payload, waggleConfig, model, optimisticUserMessage.id),
      )
    } catch (error) {
      if (params.isFirstMessage) forgetRefusedFirstSend(sessionId, error, params)
      throw error
    }
    if (params.isFirstMessage) params.setFirstSendRecovery(sessionId, null)
  }

  function stop() {
    if (sessionId) {
      // A promotion this Stop rejects is the user's doing, not a steering failure.
      useOptimisticSteerStore.getState().noteUserStop(sessionId)
      useRunFinishingStore.getState().endStopOffer(sessionId)
      void api.cancelAgent(sessionId).catch((cancelError: unknown) => {
        const normalizedError = normalizeError(cancelError)
        params.setError(normalizedError)
        params.setStatus('error')
        refs.terminalRunErrorRef.current = normalizedError
      })
    }
    stopFollowingSends(refs)
    resetRunUiState(params)
  }

  return {
    runActions: {
      flushDeferredSessionSnapshot,
      settlePendingRun: (nextError?: Error, runId?: string) =>
        settlePendingRun(refs, nextError, runId),
    } satisfies AgentRunActions,
    withDeferredSnapshotRefresh,
    sendUserPayload,
    stop,
  }
}
