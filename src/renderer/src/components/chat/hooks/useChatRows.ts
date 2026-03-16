import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useRef } from 'react'
import type { useStreamingPhase } from '@/hooks/useStreamingPhase'
import type { ChatRow } from '../types-chat-row'
import { buildChatRows } from '../useBuildChatRows'

/**
 * Ref-based memoization for virtual rows. Recomputes only when
 * any of the 10 input values change by reference.
 */
export function useChatRows(inputs: {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | undefined
  lastUserMessage: string | null
  dismissedError: string | null
  conversationId: ConversationId | null
  model: SupportedModelId
  messageModelLookup: Readonly<Record<string, SupportedModelId>>
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>
  phase: ReturnType<typeof useStreamingPhase>
}): ChatRow[] {
  const cacheRef = useRef<{
    messages: UIMessage[]
    isLoading: boolean
    error: Error | undefined
    lastUserMessage: string | null
    dismissedError: string | null
    conversationId: ConversationId | null
    model: SupportedModelId
    messageModelLookup: Readonly<Record<string, SupportedModelId>>
    waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>
    phase: ReturnType<typeof useStreamingPhase>
    rows: ChatRow[]
  } | null>(null)

  const {
    messages,
    isLoading,
    error,
    lastUserMessage,
    dismissedError,
    conversationId,
    model,
    messageModelLookup,
    waggleMetadataLookup,
    phase,
  } = inputs

  if (
    cacheRef.current?.messages === messages &&
    cacheRef.current.isLoading === isLoading &&
    cacheRef.current.error === error &&
    cacheRef.current.lastUserMessage === lastUserMessage &&
    cacheRef.current.dismissedError === dismissedError &&
    cacheRef.current.conversationId === conversationId &&
    cacheRef.current.model === model &&
    cacheRef.current.messageModelLookup === messageModelLookup &&
    cacheRef.current.waggleMetadataLookup === waggleMetadataLookup &&
    cacheRef.current.phase === phase
  ) {
    return cacheRef.current.rows
  }

  const rows = buildChatRows({
    messages,
    isLoading,
    error,
    lastUserMessage,
    dismissedError,
    conversationId,
    model,
    messageModelLookup,
    waggleMetadataLookup,
    phase,
  })
  cacheRef.current = {
    messages,
    isLoading,
    error,
    lastUserMessage,
    dismissedError,
    conversationId,
    model,
    messageModelLookup,
    waggleMetadataLookup,
    phase,
    rows,
  }
  return rows
}
