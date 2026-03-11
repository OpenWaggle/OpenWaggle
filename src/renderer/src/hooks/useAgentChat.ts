import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import type { QualityPreset } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useChat } from '@tanstack/ai-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/ipc'
import { createIpcConnectionAdapter } from '@/lib/ipc-connection-adapter'
import { useBackgroundRunStore } from '@/stores/background-run-store'
import { useChatStore } from '@/stores/chat-store'
import {
  applyStreamDelta,
  buildPartialAssistantMessage,
  conversationToUIMessages,
  formatAttachmentPreview,
} from './useAgentChat.utils'
import { useHydratedConversationMessages } from './useHydratedConversationMessages'
import { useOptimisticSteeredTurn } from './useOptimisticSteeredTurn'

interface AgentChatReturn {
  messages: UIMessage[]
  sendMessage: (payload: AgentSendPayload) => Promise<void>
  sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
  isLoading: boolean
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  stop: () => void
  steer: () => Promise<void>
  error: Error | undefined
  respondToolApproval: (approvalId: string, approved: boolean) => Promise<void>
  answerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  respondToPlan: (conversationId: ConversationId, response: PlanResponse) => Promise<void>
  withDeferredSnapshotRefresh: <T>(operation: () => Promise<T>) => Promise<T>
  previewSteeredUserTurn: (payload: AgentSendPayload) => () => void
  /** True when we're showing a reconnected background stream (not via TanStack) */
  backgroundStreaming: boolean
}

const EMPTY_CONNECTION = {
  connect: () => emptyAsyncIterable(),
}

/**
 * Wraps TanStack AI's useChat with an Electron IPC connection adapter.
 *
 * This replaces the custom Zustand streaming logic (streamingText, streamingParts,
 * handleAgentEvent) with TanStack's built-in stream processing. useChat handles:
 * - Message state (messages array with text + tool call parts)
 * - Streaming state (isLoading, status)
 * - Stream processing (StreamChunk → UIMessage)
 * - Cancellation (stop)
 *
 * What we still manage externally:
 * - Conversation list / switching (Zustand store)
 * - Persistence (main process saves to disk)
 * - Loading historical messages into useChat via setMessages()
 * - Background stream reconnection when switching back to an active run
 */
export function useAgentChat(
  conversationId: ConversationId | null,
  conversation: Conversation | null,
  model: SupportedModelId,
  qualityPreset: QualityPreset,
): AgentChatReturn {
  const pendingPayloadRef = useRef<AgentSendPayload | null>(null)
  const pendingWaggleConfigRef = useRef<WaggleConfig | null>(null)
  const [backgroundStreaming, setBackgroundStreaming] = useState(false)
  const hasActiveRun = useBackgroundRunStore((s) => s.hasActiveRun)

  const consumePendingPayload = useCallback(() => {
    const payload = pendingPayloadRef.current
    pendingPayloadRef.current = null
    return payload
  }, [])

  const consumePendingWaggleConfig = useCallback(() => {
    const config = pendingWaggleConfigRef.current
    pendingWaggleConfigRef.current = null
    return config
  }, [])

  const connection = useMemo(
    () =>
      conversationId
        ? createIpcConnectionAdapter(
            conversationId,
            model,
            consumePendingPayload,
            qualityPreset,
            consumePendingWaggleConfig,
          )
        : EMPTY_CONNECTION,
    [conversationId, consumePendingPayload, consumePendingWaggleConfig, model, qualityPreset],
  )

  const {
    messages,
    sendMessage,
    isLoading,
    status,
    stop,
    setMessages,
    error,
    addToolApprovalResponse,
  } = useChat({
    connection,
    id: conversationId ? `${conversationId}:${model}:${qualityPreset}` : undefined,
  })

  const hydratedMessages = useHydratedConversationMessages(messages, conversation)

  const currentConversationIdRef = useRef(conversationId)
  currentConversationIdRef.current = conversationId
  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading
  const backgroundStreamingRef = useRef(backgroundStreaming)
  backgroundStreamingRef.current = backgroundStreaming
  const deferredRefreshConversationIdRef = useRef<ConversationId | null>(null)
  const deferredSnapshotRefreshCountRef = useRef(0)
  const isConversationIdle = !isLoading && !backgroundStreaming

  // While a foreground stream is active (sendMessage in progress), TanStack owns
  // the UIMessages. Persisted-snapshot refreshes must not overwrite them — the
  // persisted state lags behind the live stream, especially during continuations
  // where multiple runs complete before the overall sendMessage resolves.
  const foregroundStreamActiveRef = useRef(false)

  const messagesRef = useRef(hydratedMessages)
  messagesRef.current = hydratedMessages

  const { visibleMessages, previewSteeredUserTurn } = useOptimisticSteeredTurn(
    hydratedMessages,
    conversationId,
    isConversationIdle,
    buildClientUserMessage,
    messagesRef,
  )

  const refreshConversationSnapshot = useCallback(
    async (targetConversationId: ConversationId) => {
      const conv = await api.getConversation(targetConversationId)
      if (!conv || currentConversationIdRef.current !== targetConversationId) {
        return
      }

      useChatStore.setState((state) => {
        if (state.activeConversationId !== targetConversationId) {
          return state
        }

        return {
          activeConversation: conv,
          conversations: state.conversations.map((item) =>
            item.id === targetConversationId
              ? {
                  ...item,
                  title: conv.title,
                  projectPath: conv.projectPath,
                  messageCount: conv.messages.length,
                  updatedAt: conv.updatedAt,
                }
              : item,
          ),
        }
      })

      if (!foregroundStreamActiveRef.current) {
        setMessages(conversationToUIMessages(conv))
      }
    },
    [setMessages],
  )

  const flushDeferredConversationSnapshot = useCallback(() => {
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
    if (isLoadingRef.current || backgroundStreamingRef.current) {
      return
    }

    deferredRefreshConversationIdRef.current = null
    void refreshConversationSnapshot(targetConversationId)
  }, [refreshConversationSnapshot])

  const withDeferredSnapshotRefresh = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
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
    },
    [flushDeferredConversationSnapshot],
  )

  // Sync historical messages whenever the active conversation snapshot changes.
  useEffect(() => {
    setBackgroundStreaming(false)

    if (!conversationId || !conversation) {
      foregroundStreamActiveRef.current = false
      setMessages([])
      return
    }

    if (hasActiveRun(conversationId)) {
      foregroundStreamActiveRef.current = false
      const capturedId = conversationId
      void reconnectToBackgroundRun(capturedId, conversation, setMessages).then((reconnected) => {
        if (reconnected && currentConversationIdRef.current === capturedId) {
          setBackgroundStreaming(true)
        }
      })
      return
    }

    // While TanStack owns the stream (sendMessage in progress), skip overwriting
    // with the persisted snapshot — it lags behind the live UIMessages.
    if (foregroundStreamActiveRef.current) {
      return
    }

    setMessages(conversationToUIMessages(conversation))
  }, [conversationId, conversation, hasActiveRun, setMessages])

  // While background-streaming, subscribe to live chunk updates.
  useEffect(() => {
    if (!backgroundStreaming || !conversationId) return

    const unsubChunk = api.onStreamChunk((payload) => {
      if (payload.conversationId !== conversationId) return
      if (payload.chunk.type === 'RUN_ERROR') {
        setBackgroundStreaming(false)
        return
      }
      const prev = messagesRef.current
      const next = applyStreamDelta(payload.chunk, prev)
      if (next !== prev) {
        setMessages(next)
      }
    })

    return () => {
      unsubChunk()
    }
  }, [backgroundStreaming, conversationId, setMessages])

  useEffect(() => {
    if (!conversationId) return

    const unsubCompleted = api.onRunCompleted((payload) => {
      if (payload.conversationId !== conversationId) return
      setBackgroundStreaming(false)
      if (
        deferredSnapshotRefreshCountRef.current > 0 ||
        isLoadingRef.current ||
        backgroundStreamingRef.current
      ) {
        deferredRefreshConversationIdRef.current = conversationId
        return
      }
      void refreshConversationSnapshot(conversationId)
    })

    return () => {
      unsubCompleted()
    }
  }, [conversationId, refreshConversationSnapshot])

  useEffect(() => {
    if (!conversationId) return
    if (!isConversationIdle) return
    if (deferredRefreshConversationIdRef.current !== conversationId) return
    flushDeferredConversationSnapshot()
  }, [conversationId, flushDeferredConversationSnapshot, isConversationIdle])

  const respondToolApprovalStable = useCallback(
    async (approvalId: string, approved: boolean) => {
      await addToolApprovalResponse({ id: approvalId, approved })
    },
    [addToolApprovalResponse],
  )

  return {
    messages: visibleMessages,
    sendMessage: async (payload: AgentSendPayload) =>
      withDeferredSnapshotRefresh(async () => {
        setBackgroundStreaming(false)
        foregroundStreamActiveRef.current = true
        pendingPayloadRef.current = payload
        await sendMessage(buildClientUserMessage(payload))
        foregroundStreamActiveRef.current = false
      }),
    sendWaggleMessage: async (payload: AgentSendPayload, config: WaggleConfig) =>
      withDeferredSnapshotRefresh(async () => {
        setBackgroundStreaming(false)
        foregroundStreamActiveRef.current = true
        pendingPayloadRef.current = payload
        pendingWaggleConfigRef.current = config
        await sendMessage(buildClientUserMessage(payload))
        foregroundStreamActiveRef.current = false
      }),
    isLoading: isLoading || backgroundStreaming,
    status: backgroundStreaming ? 'streaming' : status,
    stop: () => {
      if (conversationId) {
        api.cancelAgent(conversationId)
      }
      setBackgroundStreaming(false)
      stop()
    },
    steer: async () => {
      if (conversationId) {
        await api.steerAgent(conversationId)
      }
      setBackgroundStreaming(false)
      stop()
    },
    error,
    respondToolApproval: respondToolApprovalStable,
    answerQuestion: async (cid: ConversationId, answers: QuestionAnswer[]) => {
      await api.answerQuestion(cid, answers)
    },
    respondToPlan: async (cid: ConversationId, response: PlanResponse) => {
      await api.respondToPlan(cid, response)
    },
    withDeferredSnapshotRefresh,
    previewSteeredUserTurn,
    backgroundStreaming,
  }
}

// ─── Background Run Reconnection ─────────────────────────────

async function reconnectToBackgroundRun(
  conversationId: ConversationId,
  conversation: Conversation,
  setMessages: (msgs: UIMessage[]) => void,
): Promise<boolean> {
  const snapshot = await api.getBackgroundRun(conversationId)
  if (!snapshot) {
    setMessages(conversationToUIMessages(conversation))
    return false
  }

  const historicalMessages = conversationToUIMessages(conversation)
  const partialAssistant = buildPartialAssistantMessage(snapshot.parts)
  setMessages([...historicalMessages, partialAssistant])
  return true
}

// ─── Helpers ─────────────────────────────────────────────────

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

async function* emptyAsyncIterable() {
  // yields nothing — used when no conversation is active
}
