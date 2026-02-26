import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { QuestionAnswer } from '@shared/types/question'
import type { QualityPreset } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import type { UIMessage } from '@tanstack/ai-react'
import { useChat } from '@tanstack/ai-react'
import { useEffect, useRef } from 'react'
import { api } from '@/lib/ipc'
import { createIpcConnectionAdapter } from '@/lib/ipc-connection-adapter'

interface AgentChatReturn {
  messages: UIMessage[]
  sendMessage: (payload: AgentSendPayload) => Promise<void>
  sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
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
  const pendingWaggleConfigRef = useRef<WaggleConfig | null>(null)

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
        () => {
          const config = pendingWaggleConfigRef.current
          pendingWaggleConfigRef.current = null
          return config
        },
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
    // Recreate the ChatClient when conversation/model/preset changes.
    // useChat does not live-update the connection object after construction.
    id: conversationId ? `${conversationId}:${model}:${qualityPreset}` : undefined,
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
    sendWaggleMessage: async (payload: AgentSendPayload, config: WaggleConfig) => {
      pendingPayloadRef.current = payload
      pendingWaggleConfigRef.current = config
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
      return chooseBy(part, 'type')
        .case('text', (value): UIMessage['parts'] => [{ type: 'text', content: value.text }])
        .case('tool-call', (value): UIMessage['parts'] => [
          {
            type: 'tool-call',
            id: String(value.toolCall.id),
            name: value.toolCall.name,
            arguments: JSON.stringify(value.toolCall.args),
            state: 'input-complete',
          },
        ])
        .case('tool-result', (value): UIMessage['parts'] => [
          {
            type: 'tool-result',
            toolCallId: String(value.toolResult.id),
            content: value.toolResult.result,
            state: value.toolResult.isError ? 'error' : 'complete',
          },
        ])
        .case('attachment', (value): UIMessage['parts'] => [
          {
            type: 'text',
            content: formatAttachmentPreview(value.attachment.name, value.attachment.extractedText),
          },
        ])
        .case('reasoning', (): UIMessage['parts'] => [])
        .assertComplete()
    }),
    createdAt: new Date(msg.createdAt),
  }))
}

async function* emptyAsyncIterable() {
  // yields nothing — used when no conversation is active
}
