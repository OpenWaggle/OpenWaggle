import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { useEffect, useRef, useState } from 'react'
import { clearLastAgentErrorInfo, setLastAgentErrorInfo } from '@/lib/agent-error-store'
import { applyAgentTransportEvent } from '@/lib/chat-stream-state'
import { api } from '@/lib/ipc'
import { useBackgroundRunStore } from '@/stores/background-run-store'
import { useChatStore } from '@/stores/chat-store'
import {
  selectOptimisticUserMessages,
  useOptimisticUserMessageStore,
} from '@/stores/optimistic-user-message-store'
import {
  appendMissingOptimisticUserMessages,
  buildPartialAssistantMessage,
  formatAttachmentPreview,
  reconcileSnapshotUserMessages,
  sessionToUIMessages,
} from './useAgentChat.utils'
import { useOptimisticSteeredTurn } from './useOptimisticSteeredTurn'

export type AgentChatStatus =
  | 'ready'
  | 'submitted'
  | 'streaming'
  | 'compacting'
  | 'retrying'
  | 'error'

export type AgentCompactionStatus =
  | { readonly type: 'compacting'; readonly reason: 'manual' | 'threshold' | 'overflow' }
  | {
      readonly type: 'retrying'
      readonly attempt: number
      readonly maxAttempts: number
      readonly delayMs: number
      readonly errorMessage: string
    }

interface AgentChatReturn {
  messages: UIMessage[]
  sendMessage: (payload: AgentSendPayload) => Promise<void>
  sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
  isLoading: boolean
  status: AgentChatStatus
  stop: () => void
  steer: () => Promise<void>
  error: Error | undefined
  withDeferredSnapshotRefresh: <T>(operation: () => Promise<T>) => Promise<T>
  previewSteeredUserTurn: (payload: AgentSendPayload) => () => void
  backgroundStreaming: boolean
  streamSignalVersion: number
  compactionStatus: AgentCompactionStatus | null
}

interface PendingRunWaiter {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

interface AgentRunActions {
  readonly flushDeferredSessionSnapshot: () => void
  readonly settlePendingRun: (nextError?: Error) => void
}

function createPendingRunWaiter(): {
  readonly promise: Promise<void>
  readonly waiter: PendingRunWaiter
} {
  let resolveRun = () => {}
  let rejectRun = (_error: Error) => {}
  const promise = new Promise<void>((resolve, reject) => {
    resolveRun = resolve
    rejectRun = reject
  })
  return {
    promise,
    waiter: {
      resolve: resolveRun,
      reject: rejectRun,
    },
  }
}

function buildSessionSnapshotKey(session: SessionDetail): string {
  const lastMessage = session.messages[session.messages.length - 1]
  return `${String(session.updatedAt)}:${String(session.messages.length)}:${lastMessage ? String(lastMessage.id) : 'none'}`
}

function buildOptimisticMessagesKey(messages: readonly UIMessage[]): string {
  return messages.map((message) => message.id).join(':')
}

function mergeSessionAndOptimisticMessages(
  session: SessionDetail,
  optimisticUserMessages: readonly UIMessage[],
): UIMessage[] {
  return appendMissingOptimisticUserMessages(sessionToUIMessages(session), optimisticUserMessages)
}

export function useAgentChat(
  sessionId: SessionId | null,
  session: SessionDetail | null,
  model: SupportedModelId,
  _thinkingLevel: ThinkingLevel,
): AgentChatReturn {
  const upsertSession = useChatStore((state) => state.upsertSession)
  const hasActiveRun = useBackgroundRunStore((state) => state.hasActiveRun)
  const optimisticUserMessages = useOptimisticUserMessageStore(
    selectOptimisticUserMessages(sessionId),
  )
  const addOptimisticUserMessage = useOptimisticUserMessageStore((state) => state.add)
  const removeMatchedOptimisticUserMessages = useOptimisticUserMessageStore(
    (state) => state.removeMatched,
  )
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [status, setStatus] = useState<AgentChatStatus>('ready')
  const [error, setError] = useState<Error | undefined>(undefined)
  const [backgroundStreaming, setBackgroundStreaming] = useState(false)
  const [compactionStatus, setCompactionStatus] = useState<AgentCompactionStatus | null>(null)

  const isLoading =
    status === 'submitted' ||
    status === 'streaming' ||
    status === 'compacting' ||
    status === 'retrying' ||
    backgroundStreaming
  const isSessionIdle = !isLoading

  const currentSessionIdRef = useRef(sessionId)
  currentSessionIdRef.current = sessionId
  const statusRef = useRef(status)
  statusRef.current = status
  const backgroundStreamingRef = useRef(backgroundStreaming)
  backgroundStreamingRef.current = backgroundStreaming
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const foregroundStreamActiveRef = useRef(false)
  const foregroundSessionIdRef = useRef<SessionId | null>(null)
  const terminalRunErrorRef = useRef<Error | undefined>(undefined)
  const backgroundReconnectSessionIdRef = useRef<SessionId | null>(null)
  const streamSignalVersionRef = useRef(0)
  const deferredRefreshSessionIdRef = useRef<SessionId | null>(null)
  const deferredSnapshotRefreshCountRef = useRef(0)
  const lastHydratedSessionIdRef = useRef<SessionId | null>(null)
  const lastHydratedSnapshotKeyRef = useRef<string | null>(null)
  const lastHydratedOptimisticKeyRef = useRef<string | null>(null)
  const pendingRunWaiterRef = useRef<PendingRunWaiter | null>(null)
  const agentRunActionsRef = useRef<AgentRunActions | null>(null)

  const { visibleMessages, previewSteeredUserTurn } = useOptimisticSteeredTurn(
    messages,
    sessionId,
    isSessionIdle,
    buildClientUserMessage,
    messagesRef,
  )

  async function refreshSessionSnapshot(targetSessionId: SessionId): Promise<void> {
    const nextSession = await api.getSessionDetail(targetSessionId)
    if (!nextSession || currentSessionIdRef.current !== targetSessionId) {
      return
    }
    upsertSession(nextSession)
  }

  function flushDeferredSessionSnapshot(): void {
    if (deferredSnapshotRefreshCountRef.current > 0) {
      return
    }

    const targetSessionId = deferredRefreshSessionIdRef.current
    if (!targetSessionId) {
      return
    }
    if (currentSessionIdRef.current !== targetSessionId) {
      deferredRefreshSessionIdRef.current = null
      return
    }
    if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
      return
    }
    if (backgroundStreamingRef.current) {
      return
    }

    deferredRefreshSessionIdRef.current = null
    void refreshSessionSnapshot(targetSessionId)
  }

  async function withDeferredSnapshotRefresh<T>(operation: () => Promise<T>): Promise<T> {
    deferredSnapshotRefreshCountRef.current += 1
    try {
      return await operation()
    } finally {
      deferredSnapshotRefreshCountRef.current = Math.max(
        0,
        deferredSnapshotRefreshCountRef.current - 1,
      )
      flushDeferredSessionSnapshot()
    }
  }

  function settlePendingRun(nextError?: Error): void {
    const pending = pendingRunWaiterRef.current
    pendingRunWaiterRef.current = null
    if (!pending) {
      return
    }
    if (nextError) {
      pending.reject(nextError)
      return
    }
    pending.resolve()
  }

  function startForegroundRun(targetSessionId: SessionId): Promise<void> {
    const { promise, waiter } = createPendingRunWaiter()
    pendingRunWaiterRef.current = waiter
    foregroundStreamActiveRef.current = true
    foregroundSessionIdRef.current = targetSessionId
    terminalRunErrorRef.current = undefined
    setBackgroundStreaming(false)
    setError(undefined)
    setStatus('submitted')
    return promise
  }

  async function dispatchAgentSend(
    payload: AgentSendPayload,
    waggleConfig: WaggleConfig | null,
  ): Promise<void> {
    if (!sessionId) {
      return
    }

    const runPromise = startForegroundRun(sessionId)
    const sendPromise = waggleConfig
      ? api.sendWaggleMessage(sessionId, payload, waggleConfig)
      : api.sendMessage(sessionId, payload, model)

    try {
      await sendPromise
      await runPromise
    } catch (runError) {
      const normalizedError = runError instanceof Error ? runError : new Error(String(runError))
      setError(normalizedError)
      setStatus('error')
      foregroundStreamActiveRef.current = false
      foregroundSessionIdRef.current = null
      terminalRunErrorRef.current = normalizedError
      throw normalizedError
    }
  }

  async function sendUserPayload(
    payload: AgentSendPayload,
    waggleConfig: WaggleConfig | null,
  ): Promise<void> {
    const optimisticUserMessage = createOptimisticUserMessage(payload)
    if (sessionId) {
      addOptimisticUserMessage(sessionId, optimisticUserMessage)
    }
    setMessages((currentMessages) => [...currentMessages, optimisticUserMessage])
    await dispatchAgentSend(payload, waggleConfig)
  }

  agentRunActionsRef.current = {
    flushDeferredSessionSnapshot,
    settlePendingRun,
  }

  useEffect(() => {
    if (!sessionId || !session) {
      foregroundStreamActiveRef.current = false
      foregroundSessionIdRef.current = null
      terminalRunErrorRef.current = undefined
      streamSignalVersionRef.current = 0
      lastHydratedSessionIdRef.current = null
      lastHydratedSnapshotKeyRef.current = null
      lastHydratedOptimisticKeyRef.current = null
      pendingRunWaiterRef.current = null
      setMessages([])
      setStatus('ready')
      setCompactionStatus(null)
      setError(undefined)
      return
    }

    const snapshotKey = buildSessionSnapshotKey(session)
    const optimisticKey = buildOptimisticMessagesKey(optimisticUserMessages)

    if (foregroundStreamActiveRef.current) {
      if (foregroundSessionIdRef.current === sessionId) {
        lastHydratedOptimisticKeyRef.current = optimisticKey
        return
      }
      const pending = pendingRunWaiterRef.current
      pendingRunWaiterRef.current = null
      pending?.reject(new Error('SessionDetail changed before the run completed.'))
      foregroundStreamActiveRef.current = false
      foregroundSessionIdRef.current = null
      terminalRunErrorRef.current = undefined
    }

    const sessionChanged = lastHydratedSessionIdRef.current !== sessionId
    if (sessionChanged) {
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectSessionIdRef.current = null
      setCompactionStatus(null)
    }
    const snapshotChanged = lastHydratedSnapshotKeyRef.current !== snapshotKey
    const optimisticChanged = lastHydratedOptimisticKeyRef.current !== optimisticKey

    if (hasActiveRun(sessionId)) {
      if (
        backgroundReconnectSessionIdRef.current === sessionId &&
        !sessionChanged &&
        !snapshotChanged &&
        !optimisticChanged
      ) {
        return
      }

      const capturedSessionId = sessionId
      const startingStreamVersion = streamSignalVersionRef.current
      const snapshotMessages = mergeSessionAndOptimisticMessages(session, optimisticUserMessages)
      setMessages(reconcileSnapshotUserMessages(snapshotMessages, messagesRef.current))
      lastHydratedSessionIdRef.current = capturedSessionId
      lastHydratedSnapshotKeyRef.current = snapshotKey
      lastHydratedOptimisticKeyRef.current = optimisticKey
      backgroundStreamingRef.current = true
      backgroundReconnectSessionIdRef.current = capturedSessionId
      setBackgroundStreaming(true)
      setStatus('streaming')
      void reconnectToBackgroundRun(capturedSessionId, session, optimisticUserMessages)
        .then((nextMessages) => {
          if (
            !nextMessages ||
            currentSessionIdRef.current !== capturedSessionId ||
            backgroundReconnectSessionIdRef.current !== capturedSessionId ||
            streamSignalVersionRef.current !== startingStreamVersion
          ) {
            return
          }
          setMessages(nextMessages)
        })
        .catch((reconnectError: unknown) => {
          if (currentSessionIdRef.current !== capturedSessionId) {
            return
          }
          setError(
            reconnectError instanceof Error ? reconnectError : new Error(String(reconnectError)),
          )
          setStatus('error')
          setBackgroundStreaming(false)
          backgroundStreamingRef.current = false
        })
      return
    }

    setBackgroundStreaming(false)
    backgroundStreamingRef.current = false
    backgroundReconnectSessionIdRef.current = null

    if (!sessionChanged && !snapshotChanged && !optimisticChanged) {
      return
    }

    const persistedSnapshotMessages = sessionToUIMessages(session)
    const snapshotMessages = appendMissingOptimisticUserMessages(
      persistedSnapshotMessages,
      optimisticUserMessages,
    )
    setMessages(reconcileSnapshotUserMessages(snapshotMessages, messagesRef.current))
    lastHydratedSessionIdRef.current = sessionId
    lastHydratedSnapshotKeyRef.current = snapshotKey
    lastHydratedOptimisticKeyRef.current = optimisticKey

    if (sessionChanged) {
      setStatus('ready')
      setError(undefined)
    }
  }, [sessionId, session, hasActiveRun, optimisticUserMessages])

  useEffect(() => {
    if (!sessionId || !session || !isSessionIdle) {
      return
    }

    removeMatchedOptimisticUserMessages(sessionId, sessionToUIMessages(session))
  }, [sessionId, session, isSessionIdle, removeMatchedOptimisticUserMessages])

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const unsubscribeStream = api.onAgentEvent((payload) => {
      if (payload.sessionId !== sessionId) {
        return
      }

      if (payload.event.type === 'agent_start') {
        streamSignalVersionRef.current += 1
        clearLastAgentErrorInfo(sessionId)
        setError(undefined)
        setStatus('streaming')
        if (!foregroundStreamActiveRef.current) {
          backgroundStreamingRef.current = true
          backgroundReconnectSessionIdRef.current = sessionId
          setBackgroundStreaming(true)
        }
      }

      if (payload.event.type === 'compaction_start') {
        streamSignalVersionRef.current += 1
        setError(undefined)
        setStatus('compacting')
        setCompactionStatus({ type: 'compacting', reason: payload.event.reason })
      }

      if (payload.event.type === 'compaction_end') {
        streamSignalVersionRef.current += 1
        setCompactionStatus(null)
        const hasCompactionError = payload.event.errorMessage && !payload.event.aborted
        if (hasCompactionError) {
          const nextError = new Error(payload.event.errorMessage)
          setError(nextError)
          setStatus('error')
        }
        if (
          !hasCompactionError &&
          !foregroundStreamActiveRef.current &&
          !backgroundStreamingRef.current
        ) {
          setStatus('ready')
        }
      }

      if (payload.event.type === 'auto_retry_start') {
        streamSignalVersionRef.current += 1
        setStatus('retrying')
        setCompactionStatus({
          type: 'retrying',
          attempt: payload.event.attempt,
          maxAttempts: payload.event.maxAttempts,
          delayMs: payload.event.delayMs,
          errorMessage: payload.event.errorMessage,
        })
      }

      if (payload.event.type === 'auto_retry_end') {
        streamSignalVersionRef.current += 1
        setCompactionStatus(null)
        const hasRetryError = !payload.event.success && payload.event.finalError
        if (hasRetryError) {
          const nextError = new Error(payload.event.finalError)
          setError(nextError)
          setStatus('error')
        }
        if (
          !hasRetryError &&
          !foregroundStreamActiveRef.current &&
          !backgroundStreamingRef.current
        ) {
          setStatus('ready')
        }
      }

      if (
        payload.event.type === 'agent_end' &&
        payload.event.reason === 'error' &&
        payload.event.error
      ) {
        streamSignalVersionRef.current += 1
        const nextError = new Error(payload.event.error.message)
        terminalRunErrorRef.current = nextError
        setLastAgentErrorInfo(sessionId, payload.event.error)
        setError(nextError)
        setStatus('error')
      }

      if (foregroundStreamActiveRef.current || backgroundStreamingRef.current) {
        streamSignalVersionRef.current += 1
        setMessages((currentMessages) => applyAgentTransportEvent(currentMessages, payload.event))
      }
    })

    const unsubscribeCompleted = api.onRunCompleted((payload) => {
      if (payload.sessionId !== sessionId) {
        return
      }

      const terminalError = terminalRunErrorRef.current
      foregroundStreamActiveRef.current = false
      foregroundSessionIdRef.current = null
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectSessionIdRef.current = null
      setCompactionStatus(null)
      if (!terminalError) {
        setStatus('ready')
      }
      agentRunActionsRef.current?.settlePendingRun(terminalError)
      terminalRunErrorRef.current = undefined
      deferredRefreshSessionIdRef.current = sessionId
      if (
        deferredSnapshotRefreshCountRef.current > 0 ||
        statusRef.current === 'submitted' ||
        statusRef.current === 'streaming' ||
        backgroundStreamingRef.current
      ) {
        return
      }
      agentRunActionsRef.current?.flushDeferredSessionSnapshot()
    })

    return () => {
      unsubscribeStream()
      unsubscribeCompleted()
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) {
      return
    }
    if (!isSessionIdle) {
      return
    }
    if (deferredRefreshSessionIdRef.current !== sessionId) {
      return
    }
    agentRunActionsRef.current?.flushDeferredSessionSnapshot()
  }, [sessionId, isSessionIdle])

  return {
    messages: visibleMessages,
    sendMessage: async (payload: AgentSendPayload) =>
      withDeferredSnapshotRefresh(async () => {
        await sendUserPayload(payload, null)
      }),
    sendWaggleMessage: async (payload: AgentSendPayload, config: WaggleConfig) =>
      withDeferredSnapshotRefresh(async () => {
        await sendUserPayload(payload, config)
      }),
    isLoading,
    status: backgroundStreaming ? 'streaming' : status,
    stop: () => {
      if (sessionId) {
        api.cancelAgent(sessionId)
      }
      foregroundStreamActiveRef.current = false
      foregroundSessionIdRef.current = null
      terminalRunErrorRef.current = undefined
      settlePendingRun()
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectSessionIdRef.current = null
      setCompactionStatus(null)
      setStatus('ready')
    },
    steer: async () => {
      if (sessionId) {
        await api.steerAgent(sessionId)
      }
      foregroundStreamActiveRef.current = false
      foregroundSessionIdRef.current = null
      terminalRunErrorRef.current = undefined
      settlePendingRun()
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectSessionIdRef.current = null
      setCompactionStatus(null)
      setStatus('ready')
    },
    error,
    withDeferredSnapshotRefresh,
    previewSteeredUserTurn,
    backgroundStreaming,
    streamSignalVersion: streamSignalVersionRef.current,
    compactionStatus,
  }
}

async function reconnectToBackgroundRun(
  sessionId: SessionId,
  session: SessionDetail,
  optimisticUserMessages: readonly UIMessage[],
): Promise<UIMessage[] | null> {
  const [snapshot, latestSession] = await Promise.all([
    api.getBackgroundRun(sessionId),
    api.getSessionDetail(sessionId),
  ])
  const historicalMessages = mergeSessionAndOptimisticMessages(
    latestSession ?? session,
    optimisticUserMessages,
  )
  if (!snapshot) {
    return historicalMessages
  }

  const partialAssistant = buildPartialAssistantMessage(snapshot.parts)
  return partialAssistant ? [...historicalMessages, partialAssistant] : historicalMessages
}

function buildClientUserMessage(payload: AgentSendPayload): string {
  const chunks: string[] = []
  const text = payload.text.trim()
  if (text) {
    chunks.push(text)
  }
  for (const attachment of payload.attachments) {
    chunks.push(formatAttachmentPreview(attachment))
  }
  return chunks.join('\n\n')
}

function createOptimisticUserMessage(payload: AgentSendPayload): UIMessage {
  return {
    id: `optimistic-user-${Date.now()}`,
    role: 'user',
    parts: [
      {
        type: 'text',
        content: buildClientUserMessage(payload),
      },
    ],
    createdAt: new Date(),
  }
}
