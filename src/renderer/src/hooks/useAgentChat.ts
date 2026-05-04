import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
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
  conversationToUIMessages,
  formatAttachmentPreview,
  reconcileSnapshotUserMessages,
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
  readonly flushDeferredConversationSnapshot: () => void
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

function buildConversationSnapshotKey(conversation: Conversation): string {
  const lastMessage = conversation.messages[conversation.messages.length - 1]
  return `${String(conversation.updatedAt)}:${String(conversation.messages.length)}:${lastMessage ? String(lastMessage.id) : 'none'}`
}

function buildOptimisticMessagesKey(messages: readonly UIMessage[]): string {
  return messages.map((message) => message.id).join(':')
}

function mergeConversationAndOptimisticMessages(
  conversation: Conversation,
  optimisticUserMessages: readonly UIMessage[],
): UIMessage[] {
  return appendMissingOptimisticUserMessages(
    conversationToUIMessages(conversation),
    optimisticUserMessages,
  )
}

export function useAgentChat(
  conversationId: ConversationId | null,
  conversation: Conversation | null,
  model: SupportedModelId,
  _thinkingLevel: ThinkingLevel,
): AgentChatReturn {
  const upsertConversation = useChatStore((state) => state.upsertConversation)
  const hasActiveRun = useBackgroundRunStore((state) => state.hasActiveRun)
  const optimisticUserMessages = useOptimisticUserMessageStore(
    selectOptimisticUserMessages(conversationId),
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
  const isConversationIdle = !isLoading

  const currentConversationIdRef = useRef(conversationId)
  currentConversationIdRef.current = conversationId
  const statusRef = useRef(status)
  statusRef.current = status
  const backgroundStreamingRef = useRef(backgroundStreaming)
  backgroundStreamingRef.current = backgroundStreaming
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const foregroundStreamActiveRef = useRef(false)
  const foregroundConversationIdRef = useRef<ConversationId | null>(null)
  const terminalRunErrorRef = useRef<Error | undefined>(undefined)
  const backgroundReconnectConversationIdRef = useRef<ConversationId | null>(null)
  const streamSignalVersionRef = useRef(0)
  const deferredRefreshConversationIdRef = useRef<ConversationId | null>(null)
  const deferredSnapshotRefreshCountRef = useRef(0)
  const lastHydratedConversationIdRef = useRef<ConversationId | null>(null)
  const lastHydratedSnapshotKeyRef = useRef<string | null>(null)
  const lastHydratedOptimisticKeyRef = useRef<string | null>(null)
  const pendingRunWaiterRef = useRef<PendingRunWaiter | null>(null)
  const agentRunActionsRef = useRef<AgentRunActions | null>(null)

  const { visibleMessages, previewSteeredUserTurn } = useOptimisticSteeredTurn(
    messages,
    conversationId,
    isConversationIdle,
    buildClientUserMessage,
    messagesRef,
  )

  async function refreshConversationSnapshot(targetConversationId: ConversationId): Promise<void> {
    const nextConversation = await api.getConversation(targetConversationId)
    if (!nextConversation || currentConversationIdRef.current !== targetConversationId) {
      return
    }
    upsertConversation(nextConversation)
  }

  function flushDeferredConversationSnapshot(): void {
    if (deferredSnapshotRefreshCountRef.current > 0) {
      return
    }

    const targetConversationId = deferredRefreshConversationIdRef.current
    if (!targetConversationId) {
      return
    }
    if (currentConversationIdRef.current !== targetConversationId) {
      deferredRefreshConversationIdRef.current = null
      return
    }
    if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
      return
    }
    if (backgroundStreamingRef.current) {
      return
    }

    deferredRefreshConversationIdRef.current = null
    void refreshConversationSnapshot(targetConversationId)
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
      flushDeferredConversationSnapshot()
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

  function startForegroundRun(targetConversationId: ConversationId): Promise<void> {
    const { promise, waiter } = createPendingRunWaiter()
    pendingRunWaiterRef.current = waiter
    foregroundStreamActiveRef.current = true
    foregroundConversationIdRef.current = targetConversationId
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
    if (!conversationId) {
      return
    }

    const runPromise = startForegroundRun(conversationId)
    const sendPromise = waggleConfig
      ? api.sendWaggleMessage(conversationId, payload, waggleConfig)
      : api.sendMessage(conversationId, payload, model)

    try {
      await sendPromise
      await runPromise
    } catch (runError) {
      const normalizedError = runError instanceof Error ? runError : new Error(String(runError))
      setError(normalizedError)
      setStatus('error')
      foregroundStreamActiveRef.current = false
      foregroundConversationIdRef.current = null
      terminalRunErrorRef.current = normalizedError
      throw normalizedError
    }
  }

  async function sendUserPayload(
    payload: AgentSendPayload,
    waggleConfig: WaggleConfig | null,
  ): Promise<void> {
    const optimisticUserMessage = createOptimisticUserMessage(payload)
    if (conversationId) {
      addOptimisticUserMessage(conversationId, optimisticUserMessage)
    }
    setMessages((currentMessages) => [...currentMessages, optimisticUserMessage])
    await dispatchAgentSend(payload, waggleConfig)
  }

  agentRunActionsRef.current = {
    flushDeferredConversationSnapshot,
    settlePendingRun,
  }

  useEffect(() => {
    if (!conversationId || !conversation) {
      foregroundStreamActiveRef.current = false
      foregroundConversationIdRef.current = null
      terminalRunErrorRef.current = undefined
      streamSignalVersionRef.current = 0
      lastHydratedConversationIdRef.current = null
      lastHydratedSnapshotKeyRef.current = null
      lastHydratedOptimisticKeyRef.current = null
      pendingRunWaiterRef.current = null
      setMessages([])
      setStatus('ready')
      setCompactionStatus(null)
      setError(undefined)
      return
    }

    const snapshotKey = buildConversationSnapshotKey(conversation)
    const optimisticKey = buildOptimisticMessagesKey(optimisticUserMessages)

    if (foregroundStreamActiveRef.current) {
      if (foregroundConversationIdRef.current === conversationId) {
        lastHydratedOptimisticKeyRef.current = optimisticKey
        return
      }
      const pending = pendingRunWaiterRef.current
      pendingRunWaiterRef.current = null
      pending?.reject(new Error('Conversation changed before the run completed.'))
      foregroundStreamActiveRef.current = false
      foregroundConversationIdRef.current = null
      terminalRunErrorRef.current = undefined
    }

    const conversationChanged = lastHydratedConversationIdRef.current !== conversationId
    if (conversationChanged) {
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectConversationIdRef.current = null
      setCompactionStatus(null)
    }
    const snapshotChanged = lastHydratedSnapshotKeyRef.current !== snapshotKey
    const optimisticChanged = lastHydratedOptimisticKeyRef.current !== optimisticKey

    if (hasActiveRun(conversationId)) {
      if (
        backgroundReconnectConversationIdRef.current === conversationId &&
        !conversationChanged &&
        !snapshotChanged &&
        !optimisticChanged
      ) {
        return
      }

      const capturedConversationId = conversationId
      const startingStreamVersion = streamSignalVersionRef.current
      const snapshotMessages = mergeConversationAndOptimisticMessages(
        conversation,
        optimisticUserMessages,
      )
      setMessages(reconcileSnapshotUserMessages(snapshotMessages, messagesRef.current))
      lastHydratedConversationIdRef.current = capturedConversationId
      lastHydratedSnapshotKeyRef.current = snapshotKey
      lastHydratedOptimisticKeyRef.current = optimisticKey
      backgroundStreamingRef.current = true
      backgroundReconnectConversationIdRef.current = capturedConversationId
      setBackgroundStreaming(true)
      setStatus('streaming')
      void reconnectToBackgroundRun(capturedConversationId, conversation, optimisticUserMessages)
        .then((nextMessages) => {
          if (
            !nextMessages ||
            currentConversationIdRef.current !== capturedConversationId ||
            backgroundReconnectConversationIdRef.current !== capturedConversationId ||
            streamSignalVersionRef.current !== startingStreamVersion
          ) {
            return
          }
          setMessages(nextMessages)
        })
        .catch((reconnectError: unknown) => {
          if (currentConversationIdRef.current !== capturedConversationId) {
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
    backgroundReconnectConversationIdRef.current = null

    if (!conversationChanged && !snapshotChanged && !optimisticChanged) {
      return
    }

    const persistedSnapshotMessages = conversationToUIMessages(conversation)
    const snapshotMessages = appendMissingOptimisticUserMessages(
      persistedSnapshotMessages,
      optimisticUserMessages,
    )
    setMessages(reconcileSnapshotUserMessages(snapshotMessages, messagesRef.current))
    lastHydratedConversationIdRef.current = conversationId
    lastHydratedSnapshotKeyRef.current = snapshotKey
    lastHydratedOptimisticKeyRef.current = optimisticKey

    if (conversationChanged) {
      setStatus('ready')
      setError(undefined)
    }
  }, [conversationId, conversation, hasActiveRun, optimisticUserMessages])

  useEffect(() => {
    if (!conversationId || !conversation || !isConversationIdle) {
      return
    }

    removeMatchedOptimisticUserMessages(conversationId, conversationToUIMessages(conversation))
  }, [conversationId, conversation, isConversationIdle, removeMatchedOptimisticUserMessages])

  useEffect(() => {
    if (!conversationId) {
      return
    }

    const unsubscribeStream = api.onAgentEvent((payload) => {
      if (payload.conversationId !== conversationId) {
        return
      }

      matchBy(payload.event, 'type')
        .with('agent_start', () => {
          streamSignalVersionRef.current += 1
          clearLastAgentErrorInfo(conversationId)
          setError(undefined)
          setStatus('streaming')
          if (!foregroundStreamActiveRef.current) {
            backgroundStreamingRef.current = true
            backgroundReconnectConversationIdRef.current = conversationId
            setBackgroundStreaming(true)
          }
        })
        .with('compaction_start', (event) => {
          streamSignalVersionRef.current += 1
          setError(undefined)
          setStatus('compacting')
          setCompactionStatus({ type: 'compacting', reason: event.reason })
        })
        .with('compaction_end', (event) => {
          streamSignalVersionRef.current += 1
          setCompactionStatus(null)
          const hasCompactionError = event.errorMessage && !event.aborted
          if (hasCompactionError) {
            const nextError = new Error(event.errorMessage)
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
        })
        .with('auto_retry_start', (event) => {
          streamSignalVersionRef.current += 1
          setStatus('retrying')
          setCompactionStatus({
            type: 'retrying',
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            errorMessage: event.errorMessage,
          })
        })
        .with('auto_retry_end', (event) => {
          streamSignalVersionRef.current += 1
          setCompactionStatus(null)
          const hasRetryError = !event.success && event.finalError
          if (hasRetryError) {
            const nextError = new Error(event.finalError)
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
        })
        .with('agent_end', (event) => {
          if (event.reason !== 'error' || !event.error) {
            return
          }
          streamSignalVersionRef.current += 1
          const nextError = new Error(event.error.message)
          terminalRunErrorRef.current = nextError
          setLastAgentErrorInfo(conversationId, event.error)
          setError(nextError)
          setStatus('error')
        })
        .otherwise(() => {})

      if (foregroundStreamActiveRef.current || backgroundStreamingRef.current) {
        streamSignalVersionRef.current += 1
        setMessages((currentMessages) => applyAgentTransportEvent(currentMessages, payload.event))
      }
    })

    const unsubscribeCompleted = api.onRunCompleted((payload) => {
      if (payload.conversationId !== conversationId) {
        return
      }

      const terminalError = terminalRunErrorRef.current
      foregroundStreamActiveRef.current = false
      foregroundConversationIdRef.current = null
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectConversationIdRef.current = null
      setCompactionStatus(null)
      if (!terminalError) {
        setStatus('ready')
      }
      agentRunActionsRef.current?.settlePendingRun(terminalError)
      terminalRunErrorRef.current = undefined
      deferredRefreshConversationIdRef.current = conversationId
      if (
        deferredSnapshotRefreshCountRef.current > 0 ||
        statusRef.current === 'submitted' ||
        statusRef.current === 'streaming' ||
        backgroundStreamingRef.current
      ) {
        return
      }
      agentRunActionsRef.current?.flushDeferredConversationSnapshot()
    })

    return () => {
      unsubscribeStream()
      unsubscribeCompleted()
    }
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) {
      return
    }
    if (!isConversationIdle) {
      return
    }
    if (deferredRefreshConversationIdRef.current !== conversationId) {
      return
    }
    agentRunActionsRef.current?.flushDeferredConversationSnapshot()
  }, [conversationId, isConversationIdle])

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
      if (conversationId) {
        api.cancelAgent(conversationId)
      }
      foregroundStreamActiveRef.current = false
      foregroundConversationIdRef.current = null
      terminalRunErrorRef.current = undefined
      settlePendingRun()
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectConversationIdRef.current = null
      setCompactionStatus(null)
      setStatus('ready')
    },
    steer: async () => {
      if (conversationId) {
        await api.steerAgent(conversationId)
      }
      foregroundStreamActiveRef.current = false
      foregroundConversationIdRef.current = null
      terminalRunErrorRef.current = undefined
      settlePendingRun()
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectConversationIdRef.current = null
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
  conversationId: ConversationId,
  conversation: Conversation,
  optimisticUserMessages: readonly UIMessage[],
): Promise<UIMessage[] | null> {
  const [snapshot, latestConversation] = await Promise.all([
    api.getBackgroundRun(conversationId),
    api.getConversation(conversationId),
  ])
  const historicalMessages = mergeConversationAndOptimisticMessages(
    latestConversation ?? conversation,
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
