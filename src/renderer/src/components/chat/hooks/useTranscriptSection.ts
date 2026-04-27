import type { ConversationId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { WaggleCollaborationStatus } from '@shared/types/waggle'
import { useState } from 'react'
import type { useStreamingPhase } from '@/hooks/useStreamingPhase'
import { useWaggleMetadataLookup } from '@/hooks/useWaggleMetadataLookup'
import { useSessionStore } from '@/stores/session-store'
import { resolveTranscriptMessages } from '../session-workspace-transcript'
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
  readonly streamSignalVersion: number
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
  readonly openSettings: () => void
  readonly handleBranchFromMessage: (messageId: string) => void
  readonly userDidSend: boolean
  readonly onUserDidSendConsumed: () => void
}

export function useTranscriptSection(params: TranscriptSectionParams): ChatTranscriptSectionState {
  const {
    messages,
    isLoading,
    isSteering,
    error,
    streamSignalVersion,
    projectPath,
    recentProjects,
    activeConversationId,
    activeConversation,
    model,
    phase,
    handleOpenProject,
    handleSelectProjectPath,
    handleSendText,
    openSettings,
    handleBranchFromMessage,
    userDidSend,
    onUserDidSendConsumed,
  } = params

  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const draftBranchSourceNodeId =
    activeConversationId &&
    draftBranch?.sessionId &&
    String(draftBranch.sessionId) === String(activeConversationId)
      ? draftBranch.sourceNodeId
      : null

  const transcriptLoading = isLoading || isSteering
  const transcriptMessages = resolveTranscriptMessages({
    activeConversationId,
    activeWorkspace,
    isRunning: transcriptLoading,
    messages,
    draftBranchSourceNodeId,
  })
  const waggleMetadataLookup = useWaggleMetadataLookup(activeConversation, transcriptMessages)

  const lastUserMessage = resolveLastUserMessage(transcriptMessages)

  const chatRows = useChatRows({
    messages: transcriptMessages,
    isLoading: transcriptLoading,
    error,
    lastUserMessage,
    dismissedError,
    conversationId: activeConversationId,
    model,
    waggleMetadataLookup,
    phase,
  })

  // Compute lastUserMessageId for session-restore identity gating, not send anchoring.
  const lastUserMessageId = (() => {
    for (let i = transcriptMessages.length - 1; i >= 0; i -= 1) {
      if (transcriptMessages[i]?.role === 'user') return transcriptMessages[i]?.id ?? null
    }
    return null
  })()

  return {
    messages: transcriptMessages,
    isLoading: transcriptLoading,
    projectPath,
    recentProjects,
    activeConversationId,
    chatRows,
    onOpenProject: handleOpenProject,
    onSelectProjectPath: handleSelectProjectPath,
    onRetryText: handleSendText,
    onOpenSettings: openSettings,
    onDismissError: setDismissedError,
    onBranchFromMessage: handleBranchFromMessage,
    lastUserMessageId,
    streamSignalVersion,
    userDidSend,
    onUserDidSendConsumed,
  }
}
