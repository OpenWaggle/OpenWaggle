import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionInterruptedRun } from '@shared/types/session'
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
  sessionId: SessionId | null
  model: SupportedModelId
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>
  phase: ReturnType<typeof useStreamingPhase>
  interruptedRun?: SessionInterruptedRun
}): ChatRow[] {
  return buildChatRows({
    messages: inputs.messages,
    isLoading: inputs.isLoading,
    error: inputs.error,
    lastUserMessage: inputs.lastUserMessage,
    dismissedError: inputs.dismissedError,
    sessionId: inputs.sessionId,
    waggleMetadataLookup: inputs.waggleMetadataLookup,
    phase: inputs.phase,
    interruptedRun: inputs.interruptedRun,
  })
}
