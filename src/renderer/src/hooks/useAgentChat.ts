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
import {
  buildPersistedToolCallLookup,
  type PersistedToolCallLookup,
} from '@/lib/persisted-tool-call-reconciliation'
import { useBackgroundRunStore } from '@/stores/background-run-store'
import { useChatStore } from '@/stores/chat-store'
import {
  applyStreamDelta,
  buildPartialAssistantMessage,
  conversationToUIMessages,
  formatAttachmentPreview,
  restorePersistedToolCallMetadataWithLookup,
} from './useAgentChat.utils'

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

interface PersistedToolCallLookupCacheEntry {
  readonly conversation: Conversation | null
  readonly lookup: PersistedToolCallLookup
}

interface HydratedMessagesCacheEntry {
  readonly messages: UIMessage[]
  readonly lookup: PersistedToolCallLookup
  readonly result: UIMessage[]
}

interface OptimisticSteeredUserTurn {
  readonly id: string
  readonly content: string
  readonly baselineLength: number
  readonly message: UIMessage
}

interface ForegroundMessageSnapshot {
  readonly conversationId: ConversationId
  readonly messages: UIMessage[]
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
  const [optimisticSteeredUserTurn, setOptimisticSteeredUserTurn] =
    useState<OptimisticSteeredUserTurn | null>(null)
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

  // TanStack's useChat keeps internal stream/client state keyed by the
  // connection object identity, so we must keep the adapter stable across
  // ordinary rerenders and only recreate it when the conversation/model
  // configuration actually changes.
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
    // Recreate the ChatClient when conversation/model/preset changes.
    // useChat does not live-update the connection object after construction.
    id: conversationId ? `${conversationId}:${model}:${qualityPreset}` : undefined,
  })
  const persistedToolCallLookupCacheRef = useRef<PersistedToolCallLookupCacheEntry | null>(null)
  const persistedToolCalls =
    persistedToolCallLookupCacheRef.current?.conversation === conversation
      ? persistedToolCallLookupCacheRef.current.lookup
      : (() => {
          const lookup = buildPersistedToolCallLookup(conversation)
          persistedToolCallLookupCacheRef.current = {
            conversation,
            lookup,
          }
          return lookup
        })()

  const hydratedMessagesCacheRef = useRef<HydratedMessagesCacheEntry | null>(null)
  const hydratedMessages =
    hydratedMessagesCacheRef.current?.messages === messages &&
    hydratedMessagesCacheRef.current.lookup === persistedToolCalls
      ? hydratedMessagesCacheRef.current.result
      : (() => {
          const result = restorePersistedToolCallMetadataWithLookup(messages, persistedToolCalls)
          hydratedMessagesCacheRef.current = {
            messages,
            lookup: persistedToolCalls,
            result,
          }
          return result
        })()
  const visibleMessages = insertOptimisticSteeredUserTurn(
    hydratedMessages,
    optimisticSteeredUserTurn,
  )
  const currentConversationIdRef = useRef(conversationId)
  currentConversationIdRef.current = conversationId
  const previousConversationIdRef = useRef(conversationId)
  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading
  const backgroundStreamingRef = useRef(backgroundStreaming)
  backgroundStreamingRef.current = backgroundStreaming
  const deferredRefreshConversationIdRef = useRef<ConversationId | null>(null)
  const deferredSnapshotRefreshCountRef = useRef(0)
  const foregroundMessageSnapshotRef = useRef<ForegroundMessageSnapshot | null>(null)
  const restoredForegroundSnapshotRef = useRef(false)
  const isConversationIdle = !isLoading && !backgroundStreaming
  // Derived boolean avoids putting the full `messages` array in the sync
  // effect's deps (which would cause an infinite setMessages→re-fire loop).
  const messagesEmpty = messages.length === 0

  // When a foreground stream just completed, the TanStack UIMessages are
  // already the most up-to-date representation. Calling setMessages() with
  // the persisted conversation would wipe streaming content that wasn't
  // fully persisted (e.g. after stall retries where each retry creates a
  // new collector, losing earlier retry content).
  const foregroundStreamActiveRef = useRef(false)

  // Reset foreground stream flag synchronously during render when the
  // conversation changes. This MUST happen before the sync effect runs,
  // otherwise the foregroundStreamActive guard prevents loading the new
  // conversation's persisted messages.
  const prevConversationForStreamRef = useRef(conversationId)
  if (prevConversationForStreamRef.current !== conversationId) {
    prevConversationForStreamRef.current = conversationId
    foregroundStreamActiveRef.current = false
  }

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

      // Skip message replacement while a foreground stream is active — the
      // streaming UIMessages are already correct and more complete than the
      // persisted snapshot (stall retries only persist the last collector's
      // content). The flag stays true until conversation switch or background
      // reconnection to handle multiple run completions (e.g. steer flow
      // where both the aborted and new run emit onRunCompleted).
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
  // This covers normal thread switches and any late store hydration after the
  // TanStack client recreates itself for a new `id`.
  useEffect(() => {
    setBackgroundStreaming(false)

    if (!conversationId) {
      foregroundStreamActiveRef.current = false
      foregroundMessageSnapshotRef.current = null
      restoredForegroundSnapshotRef.current = false
      setMessages([])
      return
    }

    if (!conversation) {
      foregroundStreamActiveRef.current = false
      foregroundMessageSnapshotRef.current = null
      restoredForegroundSnapshotRef.current = false
      setMessages([])
      return
    }

    if (hasActiveRun(conversationId)) {
      foregroundStreamActiveRef.current = false
      foregroundMessageSnapshotRef.current = null
      restoredForegroundSnapshotRef.current = false
      // Reconnect to background run
      const capturedId = conversationId
      void reconnectToBackgroundRun(capturedId, conversation, setMessages).then((reconnected) => {
        // Only apply if we're still on the same conversation
        if (reconnected && currentConversationIdRef.current === capturedId) {
          setBackgroundStreaming(true)
        }
      })
      return
    }

    // When a foreground stream is active, the TanStack UIMessages are the
    // source of truth. Skip replacing them with persisted state — the
    // persisted conversation may be missing stall-retry content. This
    // effect also fires when refreshConversationSnapshot updates the store
    // metadata (activeConversation), which would otherwise wipe streaming
    // content via setMessages.
    if (foregroundStreamActiveRef.current) {
      const cachedForegroundMessages = foregroundMessageSnapshotRef.current
      if (
        messagesEmpty &&
        cachedForegroundMessages?.conversationId === conversationId &&
        cachedForegroundMessages.messages.length > 0
      ) {
        restoredForegroundSnapshotRef.current = true
        foregroundStreamActiveRef.current = false
        setMessages(cachedForegroundMessages.messages)
      }
      return
    }

    if (restoredForegroundSnapshotRef.current) {
      restoredForegroundSnapshotRef.current = false
      return
    }

    setMessages(conversationToUIMessages(conversation))
  }, [conversationId, conversation, hasActiveRun, messagesEmpty, setMessages])

  // Keep a ref to the latest messages so stream chunk listeners can
  // read current state without needing a functional updater.
  const messagesRef = useRef(hydratedMessages)
  messagesRef.current = hydratedMessages

  // While background-streaming, subscribe to live chunk updates
  // and update messages on each text/tool chunk.
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

  useEffect(() => {
    if (!conversationId || !foregroundStreamActiveRef.current || !isConversationIdle) {
      return
    }
    if (hydratedMessages.length === 0) {
      return
    }

    foregroundMessageSnapshotRef.current = {
      conversationId,
      messages: hydratedMessages,
    }
  }, [conversationId, hydratedMessages, isConversationIdle])

  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) {
      return
    }
    previousConversationIdRef.current = conversationId
    foregroundMessageSnapshotRef.current = null
    restoredForegroundSnapshotRef.current = false
    setOptimisticSteeredUserTurn(null)
  }, [conversationId])

  useEffect(() => {
    if (!optimisticSteeredUserTurn) {
      return
    }
    if (!isConversationIdle) {
      return
    }
    if (hasMatchingSteeredUserTurn(hydratedMessages, optimisticSteeredUserTurn)) {
      setOptimisticSteeredUserTurn(null)
    }
  }, [hydratedMessages, isConversationIdle, optimisticSteeredUserTurn])

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
      }),
    sendWaggleMessage: async (payload: AgentSendPayload, config: WaggleConfig) =>
      withDeferredSnapshotRefresh(async () => {
        setBackgroundStreaming(false)
        foregroundStreamActiveRef.current = true
        pendingPayloadRef.current = payload
        pendingWaggleConfigRef.current = config
        await sendMessage(buildClientUserMessage(payload))
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
    previewSteeredUserTurn: (payload: AgentSendPayload) => {
      const content = buildClientUserMessage(payload)
      const optimisticTurnId = createOptimisticTurnId()
      setOptimisticSteeredUserTurn({
        id: optimisticTurnId,
        content,
        baselineLength: messagesRef.current.length,
        message: createOptimisticUserMessage(content, optimisticTurnId),
      })
      return () => {
        setOptimisticSteeredUserTurn((current) =>
          current?.id === optimisticTurnId ? null : current,
        )
      }
    },
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
    // No active run — just load historical messages
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

function createOptimisticTurnId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') {
    return randomUUID.call(globalThis.crypto)
  }
  return `optimistic-steer-${Date.now()}`
}

function createOptimisticUserMessage(content: string, id: string): UIMessage {
  return {
    id: `optimistic-steer-${id}`,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(),
  }
}

function getUIMessageText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.content)
    .join('\n\n')
}

function hasMatchingSteeredUserTurn(
  messages: UIMessage[],
  optimisticSteeredUserTurn: OptimisticSteeredUserTurn,
): boolean {
  const suffix = messages.slice(optimisticSteeredUserTurn.baselineLength)
  return suffix.some(
    (message) =>
      message.role === 'user' && getUIMessageText(message) === optimisticSteeredUserTurn.content,
  )
}

function insertOptimisticSteeredUserTurn(
  messages: UIMessage[],
  optimisticSteeredUserTurn: OptimisticSteeredUserTurn | null,
): UIMessage[] {
  if (!optimisticSteeredUserTurn) {
    return messages
  }
  if (hasMatchingSteeredUserTurn(messages, optimisticSteeredUserTurn)) {
    return messages
  }

  const prefix = messages.slice(0, optimisticSteeredUserTurn.baselineLength)
  const suffix = messages.slice(optimisticSteeredUserTurn.baselineLength)
  return [...prefix, optimisticSteeredUserTurn.message, ...suffix]
}

async function* emptyAsyncIterable() {
  // yields nothing — used when no conversation is active
}
