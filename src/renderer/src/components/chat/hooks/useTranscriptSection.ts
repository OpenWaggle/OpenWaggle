import { isCompactionEventPart } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { WaggleCollaborationStatus } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useState } from 'react'
import type { useAgentChat } from '@/hooks/useAgentChat'
import type { useStreamingPhase } from '@/hooks/useStreamingPhase'
import { useWaggleMetadataLookup } from '@/hooks/useWaggleMetadataLookup'
import type { ChatRow } from '../types-chat-row'
import type { ChatTranscriptSectionState } from '../use-chat-panel-controller'
import { useChatRows } from './useChatRows'

function resolveLastUserMessage(messages: UIMessage[]): string | null {
  let lastUserMessage: UIMessage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && message.role === 'user') {
      lastUserMessage = message
      break
    }
  }
  if (!lastUserMessage) {
    return null
  }

  const content = lastUserMessage.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.content)
    .join('\n')

  return content || null
}

export interface TranscriptSectionParams {
  readonly messages: UIMessage[]
  readonly isLoading: boolean
  readonly isSteering: boolean
  readonly error: Error | undefined
  readonly projectPath: string | null
  readonly recentProjects: readonly string[]
  readonly activeConversationId: ConversationId | null
  readonly activeConversation: Conversation | null
  readonly model: SupportedModelId
  readonly waggleStatus: WaggleCollaborationStatus
  readonly phase: ReturnType<typeof useStreamingPhase>
  readonly handleOpenProject: () => Promise<void>
  readonly handleSelectProjectPath: (path: string) => void
  readonly handleSendText: (content: string) => Promise<void>
  readonly answerQuestion: ReturnType<typeof useAgentChat>['answerQuestion']
  readonly respondToPlan: ReturnType<typeof useAgentChat>['respondToPlan']
  readonly openSettings: () => void
}

export function useTranscriptSection(params: TranscriptSectionParams): ChatTranscriptSectionState {
  const {
    messages,
    isLoading,
    isSteering,
    error,
    projectPath,
    recentProjects,
    activeConversationId,
    activeConversation,
    model,
    waggleStatus,
    phase,
    handleOpenProject,
    handleSelectProjectPath,
    handleSendText,
    answerQuestion,
    respondToPlan,
    openSettings,
  } = params

  const [dismissedError, setDismissedError] = useState<string | null>(null)

  const waggleMetadataLookup = useWaggleMetadataLookup(activeConversation, messages)

  const lastUserMessage = resolveLastUserMessage(messages)
  const transcriptLoading = isLoading || isSteering

  const baseChatRows = useChatRows({
    messages,
    isLoading: transcriptLoading,
    error,
    lastUserMessage,
    dismissedError,
    conversationId: activeConversationId,
    model,
    waggleMetadataLookup,
    phase,
  })

  // Inject compaction event rows from persisted system messages
  const chatRows = injectCompactionEvents(baseChatRows, activeConversation)

  // Build set of compacted message IDs for collapse rendering
  const compactedMessageIds = new Set<string>()
  if (activeConversation) {
    for (const msg of activeConversation.messages) {
      if (msg.metadata?.compacted) {
        compactedMessageIds.add(String(msg.id))
      }
    }
  }

  return {
    messages,
    isLoading: transcriptLoading,
    disableAutoFollowDuringWaggleStreaming: waggleStatus === 'running',
    projectPath,
    recentProjects,
    activeConversationId,
    chatRows,
    compactedMessageIds,
    onOpenProject: handleOpenProject,
    onSelectProjectPath: handleSelectProjectPath,
    onRetryText: handleSendText,
    onAnswerQuestion: answerQuestion,
    onRespondToPlan: respondToPlan,
    onOpenSettings: openSettings,
    onDismissError: setDismissedError,
    lastUserMessageId: (() => {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === 'user') return messages[i]?.id ?? null
      }
      return null
    })(),
  }
}

/**
 * Extract compaction events from persisted system messages and append them
 * to the chat rows. In the timeline, compaction events appear as lightweight
 * inline rows between user/assistant message bubbles.
 */
function injectCompactionEvents(rows: ChatRow[], conversation: Conversation | null): ChatRow[] {
  if (!conversation) return rows

  const compactionRows: ChatRow[] = []
  for (const msg of conversation.messages) {
    if (msg.role !== 'system') continue
    for (const part of msg.parts) {
      if (isCompactionEventPart(part)) {
        compactionRows.push({
          type: 'compaction-event',
          data: part.data,
          messageId: msg.id,
        })
      }
    }
  }

  if (compactionRows.length === 0) return rows

  // Append compaction events before error/phase rows at the end
  const result = [...rows, ...compactionRows]
  return result
}
