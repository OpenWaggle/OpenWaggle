import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'
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

    try {
      await sendPromise
      await runPromise
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
      throw normalizedError
    }
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
