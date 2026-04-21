import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import type { QualityPreset } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useChat } from '@tanstack/ai-react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/ipc'
import { createIpcConnectionAdapter } from '@/lib/ipc-connection-adapter'
import { fromAgentStreamChunk } from '@/lib/stream-chunk-mapper'
import { queryKeys } from '@/queries/query-keys'
import { useBackgroundRunStore } from '@/stores/background-run-store'
import {
  applyStreamDelta,
  buildPartialAssistantMessage,
  conversationToUIMessages,
  formatAttachmentPreview,
  reconcileSnapshotUserMessages,
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
  const queryClient = useQueryClient()
  const pendingPayloadRef = useRef<AgentSendPayload | null>(null)
  const pendingWaggleConfigRef = useRef<WaggleConfig | null>(null)
  const [backgroundStreaming, setBackgroundStreaming] = useState(false)
  const hasActiveRun = useBackgroundRunStore((s) => s.hasActiveRun)

  // useCallback required: used as useMemo dependencies for the connection adapter.
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

  // useMemo required: the ChatClient captures the connection at creation time.
  // Recreating it on every render wastes resources and the test suite verifies
  // connection stability across rerenders for the same conversation config.
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

  const initialMessages = conversation ? conversationToUIMessages(conversation) : []

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
    initialMessages,
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
  const lastHydratedConversationIdRef = useRef<ConversationId | null>(null)
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

  // useCallback required: used as effect dependency in useEffect blocks below.
  // Without stable identity, effects restart on every render.
  const refreshConversationSnapshot = useCallback(
    async (targetConversationId: ConversationId) => {
      const conv = await api.getConversation(targetConversationId)
      if (!conv || currentConversationIdRef.current !== targetConversationId) {
        return
      }

      // Update TanStack Query cache — both the individual conversation and the list
      queryClient.setQueryData<Conversation>(queryKeys.conversation(targetConversationId), conv)
      queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (old) =>
        old
          ? old.map((item) =>
              item.id === targetConversationId
                ? {
                    ...item,
                    title: conv.title,
                    projectPath: conv.projectPath,
                    messageCount: conv.messages.length,
                    updatedAt: conv.updatedAt,
                  }
                : item,
            )
          : old,
      )

      // Intentionally do not rewrite the active TanStack chat transcript here.
      // Completion-time snapshot refreshes should update the Query cache only,
      // otherwise the final phase/run-summary render competes with a full
      // message-array replacement and causes scroll jumps.
    },
    [queryClient],
  )

  // useCallback required: used as effect dependency below and calls refreshConversationSnapshot.
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

  // useCallback required: used as effect dependency and calls flushDeferredConversationSnapshot.
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
      lastHydratedConversationIdRef.current = null
      setMessages([])
      return
    }

    // While this hook owns an in-flight foreground send, never swap in the
    // background reconnection snapshot. Doing so can overwrite optimistic
    // user messages and make the initiating prompt disappear mid-stream.
    if (foregroundStreamActiveRef.current) {
      return
    }

    if (hasActiveRun(conversationId)) {
      const capturedId = conversationId
      void reconnectToBackgroundRun(capturedId, conversation, setMessages).then((reconnected) => {
        if (reconnected && currentConversationIdRef.current === capturedId) {
          lastHydratedConversationIdRef.current = capturedId
          setBackgroundStreaming(true)
        }
      })
      return
    }

    const shouldHydrateTranscript =
      lastHydratedConversationIdRef.current !== conversationId || messagesRef.current.length === 0
    if (!shouldHydrateTranscript) {
      return
    }

    const snapshotMessages = conversationToUIMessages(conversation)
    setMessages(reconcileSnapshotUserMessages(snapshotMessages, messagesRef.current))
    lastHydratedConversationIdRef.current = conversationId
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
      const next = applyStreamDelta(fromAgentStreamChunk(payload.chunk), prev)
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
      deferredRefreshConversationIdRef.current = conversationId
      if (
        deferredSnapshotRefreshCountRef.current > 0 ||
        isLoadingRef.current ||
        backgroundStreamingRef.current
      ) {
        return
      }
    })

    return () => {
      unsubCompleted()
    }
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) return
    if (!isConversationIdle) return
    if (deferredRefreshConversationIdRef.current !== conversationId) return
    flushDeferredConversationSnapshot()
  }, [conversationId, flushDeferredConversationSnapshot, isConversationIdle])

  // useCallback required: this function is used as an effect dependency in
  // usePendingApprovalTrustCheck. Without stable identity, the trust-check
  // effect restarts on every render, cancelling in-flight auto-approvals.
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
        return sendMessage(buildClientUserMessage(payload)).then(
          () => {
            foregroundStreamActiveRef.current = false
          },
          (error: unknown) => {
            foregroundStreamActiveRef.current = false
            throw error
          },
        )
      }),
    sendWaggleMessage: async (payload: AgentSendPayload, config: WaggleConfig) =>
      withDeferredSnapshotRefresh(async () => {
        setBackgroundStreaming(false)
        foregroundStreamActiveRef.current = true
        pendingPayloadRef.current = payload
        pendingWaggleConfigRef.current = config
        return sendMessage(buildClientUserMessage(payload)).then(
          () => {
            foregroundStreamActiveRef.current = false
          },
          (error: unknown) => {
            foregroundStreamActiveRef.current = false
            throw error
          },
        )
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
