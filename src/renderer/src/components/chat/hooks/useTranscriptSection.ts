import type { SessionBranchId, SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
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
  readonly activeSessionId: SessionId | null
  readonly activeSession: SessionDetail | null
  readonly model: SupportedModelId
  readonly waggleStatus: WaggleCollaborationStatus
  readonly phase: ReturnType<typeof useStreamingPhase>
  readonly handleOpenProject: () => Promise<void>
  readonly handleSelectProjectPath: (path: string) => void
  readonly handleSendText: (content: string) => Promise<void>
  readonly openSettings: () => void
  readonly handleDismissInterruptedRun: (runId: string, branchId: SessionBranchId) => void
  readonly handleBranchFromMessage: (messageId: string) => void
  readonly handleForkFromMessage: (messageId: string) => void
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
    activeSessionId,
    activeSession,
    model,
    phase,
    handleOpenProject,
    handleSelectProjectPath,
    handleSendText,
    openSettings,
    handleDismissInterruptedRun,
    handleBranchFromMessage,
    handleForkFromMessage,
    userDidSend,
    onUserDidSendConsumed,
  } = params

  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const draftBranchSourceNodeId =
    activeSessionId &&
    draftBranch?.sessionId &&
    String(draftBranch.sessionId) === String(activeSessionId)
      ? draftBranch.sourceNodeId
      : null

  const transcriptLoading = isLoading || isSteering
  const transcriptMessages = resolveTranscriptMessages({
    activeSessionId,
    activeWorkspace,
    isRunning: transcriptLoading,
    messages,
    draftBranchSourceNodeId,
  })
  const waggleMetadataLookup = useWaggleMetadataLookup(activeSession, transcriptMessages)

  const lastUserMessage = resolveLastUserMessage(transcriptMessages)
  const interruptedRun =
    activeWorkspace?.tree.session.id === activeSessionId
      ? activeWorkspace.tree.branches.find((branch) => branch.id === activeWorkspace.activeBranchId)
          ?.interruptedRun
      : undefined

  const chatRows = useChatRows({
    messages: transcriptMessages,
    isLoading: transcriptLoading,
    error,
    lastUserMessage,
    dismissedError,
    sessionId: activeSessionId,
    model,
    waggleMetadataLookup,
    phase,
    interruptedRun,
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
    activeSessionId,
    chatRows,
    onOpenProject: handleOpenProject,
    onSelectProjectPath: handleSelectProjectPath,
    onRetryText: handleSendText,
    onOpenSettings: openSettings,
    onDismissError: setDismissedError,
    onDismissInterruptedRun: handleDismissInterruptedRun,
    onBranchFromMessage: handleBranchFromMessage,
    onForkFromMessage: handleForkFromMessage,
    lastUserMessageId,
    streamSignalVersion,
    userDidSend,
    onUserDidSendConsumed,
  }
}
