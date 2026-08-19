import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'
import {
  MessageDeliveredRunFailed,
  MessageNotDelivered,
} from '@/features/chat/lib/message-delivery'
import { api } from '@/shared/lib/ipc'
import { createOptimisticUserMessage } from '../lib/useAgentChat.utils'
import { createPendingRunWaiter, updateMessagesForSession } from './useAgentChat.message-cache'
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
}

interface AgentRunControlParams {
  readonly sessionId: SessionId | null
  readonly model: SupportedModelId
  readonly refs: AgentRunControlRefs
  readonly setMessagesBySessionId: SetMessagesBySessionId
  readonly setRunRenderMessages: SetRunRenderMessages
  readonly setBackgroundStreaming: SetBackgroundStreaming
  readonly setError: SetAgentChatError
  readonly setStatus: SetAgentChatStatus
  readonly setCompactionStatus: SetCompactionStatus
  readonly addOptimisticUserMessage: (sessionId: SessionId, message: UIMessage) => void
  readonly upsertSession: (session: SessionDetail) => void
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function clearRunPointers(refs: AgentRunControlRefs) {
  refs.foregroundStreamActiveRef.current = false
  refs.foregroundSessionIdRef.current = null
  refs.terminalRunErrorRef.current = undefined
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

function settlePendingRun(refs: AgentRunControlRefs, nextError?: Error) {
  const pending = refs.pendingRunWaiterRef.current
  refs.pendingRunWaiterRef.current = null
  if (!pending) {
    return
  }
  if (nextError) {
    pending.reject(nextError)
    return
  }
  pending.resolve()
}

export function createAgentRunControls(params: AgentRunControlParams) {
  const { refs, sessionId } = params

  async function refreshSessionSnapshot(targetSessionId: SessionId) {
    const nextSession = await api.getSessionDetail(targetSessionId)
    if (!nextSession || refs.currentSessionIdRef.current !== targetSessionId) {
      return
    }
    params.upsertSession(nextSession)
  }

  function flushDeferredSessionSnapshot() {
    const targetSessionId = refs.deferredRefreshSessionIdRef.current
    if (!targetSessionId || shouldDeferSnapshotRefresh(refs)) {
      return
    }
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

  function startForegroundRun(targetSessionId: SessionId) {
    const { promise, waiter } = createPendingRunWaiter()
    refs.pendingRunWaiterRef.current = waiter
    refs.foregroundStreamActiveRef.current = true
    refs.foregroundSessionIdRef.current = targetSessionId
    refs.terminalRunErrorRef.current = undefined
    params.setBackgroundStreaming(false)
    params.setError(undefined)
    params.setStatus('submitted')
    return promise
  }

  async function dispatchAgentSend(payload: AgentSendPayload, waggleConfig: WaggleConfig | null) {
    if (!sessionId) {
      return
    }

    const targetSessionId = sessionId
    const runPromise = startForegroundRun(targetSessionId)
    const sendPromise = waggleConfig
      ? api.sendWaggleMessage(targetSessionId, payload, params.model, waggleConfig)
      : api.sendMessage(targetSessionId, payload, params.model)

    /*
     * Raised after the try block, never inside it. The catch below tears the run down and puts the session into
     * an error state, which is wrong for this case twice over: a cancellation is not a run failure, and the run
     * being torn down may already have been *replaced* - stopping settles the run, a queued follow-up send
     * begins immediately, and the superseded send's reply arrives after that replacement has started.
     */
    let notDelivered: MessageNotDelivered | null = null
    try {
      /*
       * The report is read, not merely awaited. Main recovers every run failure into a value rather than
       * failing the Effect, so this invoke resolves whether the turn ran or was refused - and the run promise
       * can be settled without an error by ordinary actions such as Stop. Without consulting the report, a
       * refused send reached the caller as a success and a submitted review was discarded.
       */
      const report = await sendPromise
      if (report.outcome === 'delivered') {
        await runPromise
      } else {
        // Nothing is waiting on the run any more, but its rejection must not surface unhandled.
        void runPromise.catch(() => undefined)
        notDelivered = new MessageNotDelivered(report.outcome, report.message)
      }
    } catch (runError) {
      const normalizedError = normalizeError(runError)
      if (refs.foregroundSessionIdRef.current === targetSessionId) {
        refs.pendingRunWaiterRef.current = null
        clearRunPointers(refs)
      }
      if (refs.currentSessionIdRef.current === targetSessionId) {
        params.setError(normalizedError)
        params.setStatus('error')
        refs.terminalRunErrorRef.current = normalizedError
      }
      /*
       * Distinguished, because a caller cannot tell these apart otherwise and one of them must not be
       * treated as a lost message: the run failing says nothing about whether the message arrived.
       *
       * The evidence is the agent reporting the turn started, not this invoke resolving. Main recovers every
       * run failure into a value and resolves - including a refusal raised before the message is recorded,
       * such as a session whose worktree has gone - so "the send resolved" labelled undelivered messages
       * delivered, and the caller that restores a review then discarded it. Absent that evidence the failure
       * is reported as undelivered, which is the side that keeps the user's work.
       */
      /*
       * Reaching here means the run promise rejected after the send reported delivery, so the message did
       * arrive: the report is main's own answer, taken from whether the run reached the transport, rather than
       * a guess from stream events that could not tell one send in a session from the next.
       */
      throw new MessageDeliveredRunFailed(normalizedError)
    }
    /*
     * The caller is told, so work it submitted is not lost - a review is restored - but the session is left
     * alone. Whether this is worth showing the user is the caller's decision, and a cancellation is not.
     */
    if (notDelivered) throw notDelivered
  }

  async function sendUserPayload(payload: AgentSendPayload, waggleConfig: WaggleConfig | null) {
    if (!sessionId) {
      return
    }

    const optimisticUserMessage = createOptimisticUserMessage(payload)
    params.addOptimisticUserMessage(sessionId, optimisticUserMessage)
    updateMessagesForSession(
      refs.messagesBySessionIdRef,
      params.setMessagesBySessionId,
      params.setRunRenderMessages,
      sessionId,
      (currentMessages) => [...currentMessages, optimisticUserMessage],
      { cacheRunSnapshot: true },
    )
    await dispatchAgentSend(payload, waggleConfig)
  }

  function stop() {
    if (sessionId) {
      void api.cancelAgent(sessionId).catch((cancelError: unknown) => {
        const normalizedError = normalizeError(cancelError)
        params.setError(normalizedError)
        params.setStatus('error')
        refs.terminalRunErrorRef.current = normalizedError
      })
    }
    settlePendingRun(refs)
    resetRunUiState(params)
  }

  async function steer() {
    if (sessionId) {
      await api.steerAgent(sessionId)
    }
    settlePendingRun(refs)
    resetRunUiState(params)
  }

  return {
    runActions: {
      flushDeferredSessionSnapshot,
      settlePendingRun: (nextError?: Error) => settlePendingRun(refs, nextError),
    } satisfies AgentRunActions,
    withDeferredSnapshotRefresh,
    sendUserPayload,
    stop,
    steer,
  }
}
