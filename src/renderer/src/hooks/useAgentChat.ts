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
  restorePersistedToolCallMetadata,
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

  const hydratedMessages = restorePersistedToolCallMetadata(messages, conversation)
  const currentConversationIdRef = useRef(conversationId)
  currentConversationIdRef.current = conversationId

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

      setMessages(conversationToUIMessages(conv))
    },
    [setMessages],
  )

  // Sync historical messages whenever the active conversation snapshot changes.
  // This covers normal thread switches and any late store hydration after the
  // TanStack client recreates itself for a new `id`.
  useEffect(() => {
    setBackgroundStreaming(false)

    if (!conversationId) {
      setMessages([])
      return
    }

    if (!conversation) {
      setMessages([])
      return
    }

    if (hasActiveRun(conversationId)) {
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

    setMessages(conversationToUIMessages(conversation))
  }, [conversationId, conversation, setMessages, hasActiveRun])

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
      void refreshConversationSnapshot(conversationId)
    })

    return () => {
      unsubCompleted()
    }
  }, [conversationId, refreshConversationSnapshot])

  const respondToolApprovalStable = useCallback(
    async (approvalId: string, approved: boolean) => {
      await addToolApprovalResponse({ id: approvalId, approved })
    },
    [addToolApprovalResponse],
  )

  return {
    messages: hydratedMessages,
    sendMessage: async (payload: AgentSendPayload) => {
      setBackgroundStreaming(false)
      pendingPayloadRef.current = payload
      await sendMessage(buildClientUserMessage(payload))
    },
    sendWaggleMessage: async (payload: AgentSendPayload, config: WaggleConfig) => {
      setBackgroundStreaming(false)
      pendingPayloadRef.current = payload
      pendingWaggleConfigRef.current = config
      await sendMessage(buildClientUserMessage(payload))
    },
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

async function* emptyAsyncIterable() {
  // yields nothing — used when no conversation is active
}
