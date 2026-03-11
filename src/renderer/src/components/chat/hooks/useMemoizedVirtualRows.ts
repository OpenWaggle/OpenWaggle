import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useRef } from 'react'
import type { useStreamingPhase } from '@/hooks/useStreamingPhase'
import type { VirtualRow } from '../types-virtual'
import { buildVirtualRows } from '../useVirtualRows'

/**
 * Ref-based memoization for virtual rows. Recomputes only when
 * any of the 10 input values change by reference.
 */
export function useMemoizedVirtualRows(inputs: {
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
}): VirtualRow[] {
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
    rows: VirtualRow[]
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

  const rows = buildVirtualRows({
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
