import type { ConversationId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { useStreamingPhase } from '@/hooks/useStreamingPhase'
import type { ChatRow } from '../types-chat-row'
import { buildChatRows } from '../useBuildChatRows'

export function useChatRows(inputs: {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | undefined
  lastUserMessage: string | null
  dismissedError: string | null
  conversationId: ConversationId | null
  model: SupportedModelId
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>
  phase: ReturnType<typeof useStreamingPhase>
}): ChatRow[] {
  return buildChatRows({
    messages: inputs.messages,
    isLoading: inputs.isLoading,
    error: inputs.error,
    lastUserMessage: inputs.lastUserMessage,
    dismissedError: inputs.dismissedError,
    conversationId: inputs.conversationId,
    waggleMetadataLookup: inputs.waggleMetadataLookup,
    phase: inputs.phase,
  })
}
