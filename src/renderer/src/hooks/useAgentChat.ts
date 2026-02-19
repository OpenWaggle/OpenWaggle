import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { QuestionAnswer } from '@shared/types/question'
import type { QualityPreset } from '@shared/types/settings'
import type { UIMessage } from '@tanstack/ai-react'
import { useChat } from '@tanstack/ai-react'
import { useEffect, useRef } from 'react'
import { api } from '@/lib/ipc'
import { createIpcConnectionAdapter } from '@/lib/ipc-connection-adapter'

interface AgentChatReturn {
  messages: UIMessage[]
  sendMessage: (payload: AgentSendPayload) => Promise<void>
  isLoading: boolean
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  stop: () => void
  error: Error | undefined
  respondToolApproval: (approvalId: string, approved: boolean) => Promise<void>
  answerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
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
 */
export function useAgentChat(
  conversationId: ConversationId | null,
  conversation: Conversation | null,
  model: SupportedModelId,
  qualityPreset: QualityPreset,
): AgentChatReturn {
  const pendingPayloadRef = useRef<AgentSendPayload | null>(null)

  // React Compiler handles memoization — no manual useMemo needed.
  const connection = conversationId
    ? createIpcConnectionAdapter(
        conversationId,
        model,
        () => {
          const payload = pendingPayloadRef.current
          pendingPayloadRef.current = null
          return payload
        },
        qualityPreset,
      )
    : { connect: () => emptyAsyncIterable() }

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
    // Changing `id` recreates the ChatClient (it's in useChat's useMemo deps).
    // This is necessary because useChat does NOT sync connection changes to an
    // existing ChatClient — it only reads connection at construction time.
    id: conversationId ?? undefined,
  })

  // Sync historical messages when switching conversations.
  // Convert our Message[] → UIMessage[] for useChat's state.
  const prevConvId = useRef<ConversationId | null>(null)
  useEffect(() => {
    if (conversationId !== prevConvId.current) {
      prevConvId.current = conversationId
      if (conversation) {
        setMessages(conversationToUIMessages(conversation))
      } else {
        setMessages([])
      }
    }
  }, [conversationId, conversation, setMessages])

  return {
    messages,
    sendMessage: async (payload: AgentSendPayload) => {
      pendingPayloadRef.current = payload
      await sendMessage(buildClientUserMessage(payload))
    },
    isLoading,
    status,
    stop: () => {
      if (conversationId) {
        api.cancelAgent(conversationId)
      }
      stop()
    },
    error,
    respondToolApproval: async (approvalId: string, approved: boolean) => {
      await addToolApprovalResponse({ id: approvalId, approved })
    },
    answerQuestion: async (cid: ConversationId, answers: QuestionAnswer[]) => {
      await api.answerQuestion(cid, answers)
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────

const MAX_ATTACHMENT_PREVIEW_CHARS = 320

function formatAttachmentPreview(name: string, extractedText: string): string {
  const preview = extractedText.trim()
  if (!preview) {
    return `[Attachment] ${name}`
  }
  const clipped =
    preview.length > MAX_ATTACHMENT_PREVIEW_CHARS
      ? `${preview.slice(0, MAX_ATTACHMENT_PREVIEW_CHARS)}...`
      : preview
  return `[Attachment] ${name}\n${clipped}`
}

function buildClientUserMessage(payload: AgentSendPayload): string {
  const chunks: string[] = []
  const text = payload.text.trim()
  if (text) {
    chunks.push(text)
  }
  for (const attachment of payload.attachments) {
    chunks.push(formatAttachmentPreview(attachment.name, attachment.extractedText))
  }
  return chunks.join('\n\n')
}

function conversationToUIMessages(conv: Conversation): UIMessage[] {
  return conv.messages.map((msg) => ({
    id: String(msg.id),
    role: msg.role,
    parts: msg.parts.flatMap((part): UIMessage['parts'] => {
      switch (part.type) {
        case 'text':
          return [{ type: 'text', content: part.text }]
        case 'tool-call':
          return [
            {
              type: 'tool-call',
              id: String(part.toolCall.id),
              name: part.toolCall.name,
              arguments: JSON.stringify(part.toolCall.args),
              state: 'input-complete',
            },
          ]
        case 'tool-result':
          return [
            {
              type: 'tool-result',
              toolCallId: String(part.toolResult.id),
              content: part.toolResult.result,
              state: part.toolResult.isError ? 'error' : 'complete',
            },
          ]
        case 'attachment':
          return [
            {
              type: 'text',
              content: formatAttachmentPreview(part.attachment.name, part.attachment.extractedText),
            },
          ]
        default:
          return []
      }
    }),
    createdAt: new Date(msg.createdAt),
  }))
}

async function* emptyAsyncIterable() {
  // yields nothing — used when no conversation is active
}
